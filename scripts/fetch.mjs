// =============================================================================
// 取数主程序 (scripts/fetch.mjs)
//   node scripts/fetch.mjs
// 流程：遍历 config/sources → 各 provider 取真值 → 算环比/同比 → 按分档打分
//       → 写 data/data.json（真实数值 + 来源 + 评分 + 时点）
// 自动格子取数失败时回退该指标的人工种子，看板始终可完整渲染。
// =============================================================================
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { REGIONS, SCORE_RULES } from '../config/sources.mjs';
import { fetchSeries, dbnomics } from '../lib/providers.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const env = process.env;

// ---- 序列工具 -------------------------------------------------------------
const lastOf = s => s[s.length - 1];
function nMonthsBack(series, anchorDate, months) {
  // 找最接近 anchor 前 `months` 个月的观测（容差 ±20 天）
  const a = new Date(anchorDate);
  const target = new Date(a.getFullYear(), a.getMonth() - months, a.getDate());
  let best = null, bestGap = Infinity;
  for (const o of series) {
    const gap = Math.abs(new Date(o.date) - target);
    if (gap < bestGap) { bestGap = gap; best = o; }
  }
  return bestGap <= 31 * 24 * 3600 * 1000 ? best : null;
}

function scoreFrom(value, calc, dir) {
  if (value == null || !Number.isFinite(value)) return null;
  const rules = SCORE_RULES[calc];
  let s = -2;
  for (const [thr, sc] of rules) { if (value >= thr) { s = sc; break; } }
  return s * dir;
}

// 数据切近性：最新观测滞后超过 maxLagMonths 个月即判为过期
const NOW = new Date();
function freshEnough(series, maxLagMonths) {
  if (!series || !series.length) return false;
  if (!maxLagMonths) return true;
  const ageM = (NOW - new Date(lastOf(series).date)) / (30.44 * 24 * 3600 * 1000);
  return ageM <= maxLagMonths + 0.6;
}

// 计算一个自动指标的 {value, asof, mom, yoy, score, kind}
function compute(series, spec) {
  if (!series || !series.length) return null;
  const latest = lastOf(series);

  // pmi 型：值=PMI水平，信号=偏离 50（>50 扩张）；按点差分档
  if (spec.kind === 'pmi') {
    const prev = series[series.length - 2] || null;
    return {
      value: round(latest.value, 1), asof: latest.date, kind: 'pmi',
      yoy: null,
      mom: prev ? round(latest.value - prev.value, 1) : null,
      score: scoreFrom(latest.value - 50, 'pt', spec.dir) ?? 0,
    };
  }

  // growth 型：序列值本身已是同比%，直接作信号
  if (spec.kind === 'growth') {
    const prev = series[series.length - 2] || null;
    return {
      value: round(latest.value, 1), asof: latest.date, kind: 'growth',
      yoy: round(latest.value, 1),
      mom: prev ? round(latest.value - prev.value, 1) : null,
      score: scoreFrom(latest.value, 'pct', spec.dir) ?? 0,
    };
  }

  // level 型：用 12 个月同比%（pct）或点差（pt）
  const prev = series[series.length - 2] || null;
  const yearAgo = nMonthsBack(series, latest.date, 12);
  const pct = (a, b) => (b && b.value) ? (a.value - b.value) / Math.abs(b.value) * 100 : null;
  const pt = (a, b) => b ? a.value - b.value : null;

  const yoyPct = yearAgo ? pct(latest, yearAgo) : null;
  const momPct = prev ? pct(latest, prev) : null;
  const yoyPt = yearAgo ? pt(latest, yearAgo) : null;

  const signal = spec.calc === 'pct' ? yoyPct : (yoyPt ?? (prev ? pt(latest, prev) : null));
  const score = scoreFrom(signal, spec.calc, spec.dir);

  return {
    value: round(latest.value), asof: latest.date, kind: 'level',
    mom: momPct == null ? null : round(momPct, 1),
    yoy: spec.calc === 'pct' ? (yoyPct == null ? null : round(yoyPct, 1))
                             : (yoyPt == null ? null : round(yoyPt, 2)),
    score: score == null ? 0 : score,
  };
}
const round = (x, d = 2) => Number.isFinite(x) ? +x.toFixed(d) : x;

// 实际利率序列 = 长端国债利率 − CPI同比，按月对齐
async function buildRealRate(spec) {
  const [rate, cpi] = await Promise.all([dbnomics(spec.rate), dbnomics(spec.cpi)]);
  if (!rate || !cpi) return null;
  const cpiMap = new Map(cpi.map(o => [o.date.slice(0, 7), o.value]));
  const out = rate
    .map(o => ({ date: o.date, value: cpiMap.has(o.date.slice(0, 7)) ? o.value - cpiMap.get(o.date.slice(0, 7)) : null }))
    .filter(o => o.value != null);
  return out.length ? out : null;
}

// ---- 处理单个指标格 -------------------------------------------------------
async function resolveCell(spec) {
  const base = { nm: spec.nm, rel: spec.rel, dir: spec.dir, unit: spec.unit,
                 note: spec.note || '', kind: spec.kind || 'level', calc: spec.calc || 'pct' };
  if (spec.provider === 'manual') {
    const m = spec.manual || {};
    return { ...base, auto: false, value: m.value, yoy: null, mom: null,
             score: m.score ?? 0, source: m.source || '人工', asof: null };
  }
  let series, label;
  if (spec.compute === 'realrate') { series = await buildRealRate(spec); label = 'OECD KEI'; }
  else { series = await fetchSeries(spec, env); label = PROVIDER_LABEL[spec.provider]; }

  if (!freshEnough(series, spec.maxLagMonths)) series = null;   // 过期→回退
  const c = series ? compute(series, spec) : null;
  if (!c) {
    // 取数失败/过期 → 先试备用源（如 PMI 过期回退 OECD CLI），再回退人工
    if (spec.fallback) {
      return resolveCell({ nm: spec.nm, rel: spec.rel, dir: spec.dir, ...spec.fallback });
    }
    const m = spec.manual || {};
    return { ...base, auto: false, value: m.value ?? null, yoy: null, mom: null,
             score: m.score ?? 0, source: (m.source || '无可用近期数据·人工'), asof: null,
             stale: true };
  }
  return { ...base, auto: true, ...c, source: label };
}
const PROVIDER_LABEL = { fred: 'FRED', eurostat: 'Eurostat', dbnomics: 'OECD', comtrade: 'UN Comtrade', macroview: 'macroview', aisi: 'AISI' };

// ---- 自华钢材进口（Comtrade，喂对华含义脚注）------------------------------
async function resolveChinaImport(ci) {
  if (!ci) return null;
  const series = await fetchSeries({ provider: 'comtrade', ...ci }, env);
  if (!series || series.length < 2) return null;
  const latest = lastOf(series);
  const ya = nMonthsBack(series, latest.date, 12);
  const yoy = ya && ya.value ? round((latest.value - ya.value) / Math.abs(ya.value) * 100, 1) : null;
  return { valueUSD: latest.value, asof: latest.date, yoy, source: 'UN Comtrade' };
}

// ---- 主流程 ---------------------------------------------------------------
async function main() {
  console.log('▶ 取数开始', new Date().toISOString());
  if (!env.FRED_API_KEY) console.warn('⚠ 未检测到 FRED_API_KEY —— 美国自动格子将回退人工种子');

  const regions = [];
  for (const R of REGIONS) {
    console.log(`· ${R.name}`);
    const industry = [], macro = [], driver = [];
    for (const s of R.industry) industry.push(await resolveCell(s));
    for (const s of R.macro)    macro.push(await resolveCell(s));
    for (const s of R.driver)   driver.push(await resolveCell(s));

    // 库存方向（相位纵轴）
    let inv = R.invSeed ?? 0;
    if (R.invFrom) {
      const series = await fetchSeries({ provider: R.invFrom.provider, code: R.invFrom.code }, env);
      const c = compute(series, { calc: 'pct', dir: -1, freq: 'M' });
      if (c) inv = c.score; // dir -1：库存升=负
    }

    const chinaImport = await resolveChinaImport(R.chinaImport);

    regions.push({
      key: R.key, name: R.name, en: R.en, tier: R.tier, china: R.china,
      industry, macro, driver, inv, chinaImport,
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    asofNote: '各指标时点见格子 asof；自动源=FRED/Eurostat/Comtrade，余为人工',
    fredEnabled: !!env.FRED_API_KEY,
    regions,
  };
  mkdirSync(resolve(ROOT, 'data'), { recursive: true });
  writeFileSync(resolve(ROOT, 'data/data.json'), JSON.stringify(out, null, 2));
  const autoN = regions.flatMap(r => [...r.industry, ...r.macro, ...r.driver]).filter(c => c.auto).length;
  console.log(`✔ 写出 data/data.json —— 自动取数 ${autoN} 格`);
}

main().catch(e => { console.error('✖ 失败', e); process.exit(1); });
