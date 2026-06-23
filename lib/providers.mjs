// =============================================================================
// 数据源适配器 (lib/providers.mjs)
// 每个 provider 返回归一化序列： [{ date:'YYYY-MM-DD', value:Number }, ...] 升序
// 取数失败一律返回 null（不抛错），由 orchestrator 回退人工种子。
// =============================================================================

const UA = { 'User-Agent': 'haiwai-mfg-panel/1.0 (+github actions)' };

async function getJSON(url, opt = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { ...UA, ...(opt.headers || {}) }, ...opt });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 80)}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ----------------------------------------------------------------------------
// FRED — 圣路易斯联储。需免费 api_key（环境变量 FRED_API_KEY）。
// ----------------------------------------------------------------------------
export async function fred(code, key) {
  if (!key) return null;
  const url = `https://api.stlouisfed.org/fred/series/observations`
    + `?series_id=${code}&api_key=${key}&file_type=json&sort_order=asc&observation_start=2018-01-01`;
  try {
    const j = await getJSON(url);
    const obs = (j.observations || [])
      .filter(o => o.value !== '.' && o.value !== '')
      .map(o => ({ date: o.date, value: +o.value }));
    return obs.length ? obs : null;
  } catch (e) { console.warn(`  [fred ${code}] ${e.message}`); return null; }
}

// ----------------------------------------------------------------------------
// Eurostat — 免费无 key。code 形如 'sts_inpr_m|DE|B-D'
// 数据集 sts_inpr_m = 工业生产指数(月)。默认季调、指数(2021=100)。
// ----------------------------------------------------------------------------
export async function eurostat(code) {
  const [dataset, geo, nace] = code.split('|');
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}`
    + `?geo=${geo}&nace_r2=${nace}&s_adj=SCA&unit=I21&sinceTimePeriod=2018-01&format=JSON&lang=EN`;
  try {
    const j = await getJSON(url);
    const timeIdx = j.dimension.time.category.index;   // {'2018-01':0,...}
    const posToTime = Object.fromEntries(Object.entries(timeIdx).map(([t, p]) => [p, t]));
    const out = Object.entries(j.value)
      .map(([pos, v]) => ({ date: posToTime[pos] + '-01', value: +v }))
      .filter(o => o.date && Number.isFinite(o.value))
      .sort((a, b) => a.date.localeCompare(b.date));
    return out.length ? out : null;
  } catch (e) { console.warn(`  [eurostat ${code}] ${e.message}`); return null; }
}

// ----------------------------------------------------------------------------
// UN Comtrade — 免费 preview 端点（无 key，限流）。
// 返回某 reporter 自中国(partner=156) 进口 HS 品类的月度序列（贸易额 USD）。
// ----------------------------------------------------------------------------
export async function comtrade({ reporter, hs }) {
  // 取最近 ~17 个月窗口（Comtrade 滞后约 2-3 月），用于算同比。
  // preview 端点单次最多 12 个 period，故分块请求再合并。
  const periods = [];
  const now = new Date();
  for (let i = 2; i < 19; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const chunks = [];
  for (let i = 0; i < periods.length; i += 12) chunks.push(periods.slice(i, i + 12));

  try {
    const rows = [];
    for (const ck of chunks) {
      const url = `https://comtradeapi.un.org/public/v1/preview/C/M/HS`
        + `?reporterCode=${reporter}&period=${ck.join(',')}`
        + `&cmdCode=${hs}&flowCode=M&partnerCode=156&partner2Code=0&customsCode=C00&motCode=0`;
      const j = await getJSON(url);
      rows.push(...(j.data || []));
    }
    const seen = new Set();
    const out = rows
      .filter(r => r.partnerCode === 156)
      .map(r => ({
        date: `${String(r.period).slice(0, 4)}-${String(r.period).slice(4, 6)}-01`,
        value: +(r.primaryValue ?? r.cifvalue ?? 0),         // 贸易额 USD
        wgt: r.netWgt != null ? +r.netWgt : null,             // 净重 kg（部分缺）
      }))
      .filter(o => Number.isFinite(o.value) && o.value > 0)
      .filter(o => (seen.has(o.date) ? false : seen.add(o.date)))
      .sort((a, b) => a.date.localeCompare(b.date));
    return out.length ? out : null;
  } catch (e) { console.warn(`  [comtrade r${reporter} hs${hs}] ${e.message}`); return null; }
}

// ----------------------------------------------------------------------------
// AISI — 美国钢协周度粗钢产量 / 产能利用率。
// 周报为新闻稿(HTML)，结构不稳定；尽力解析，失败返回 null 回退人工。
// ----------------------------------------------------------------------------
export async function aisi() {
  const url = 'https://www.steel.org/?s=raw+steel+production';
  try {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    // 形如 "capability utilization rate ... was 76.5 percent"
    const m = html.match(/utilization rate[^0-9]{0,40}?(\d{2}\.\d)\s*percent/i);
    if (!m) return null;
    return [{ date: new Date().toISOString().slice(0, 10), value: +m[1] }];
  } catch (e) { console.warn(`  [aisi] ${e.message}`); return null; }
}

export async function fetchSeries(spec, env = {}) {
  switch (spec.provider) {
    case 'fred':     return fred(spec.code, env.FRED_API_KEY);
    case 'eurostat': return eurostat(spec.code);
    case 'comtrade': return comtrade(spec);
    case 'aisi':     return aisi();
    default:         return null; // manual
  }
}
