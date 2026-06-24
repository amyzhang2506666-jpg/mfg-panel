// =============================================================================
// 指标 → 数据源映射表  (config/sources.mjs)
// -----------------------------------------------------------------------------
// 看板每个指标格都在这里登记。fetch.mjs 据此取真值、算同比/环比、打分。
//
// 自动源（均为免费）：
//   · FRED      美国宏观/驱动（需免费 key，存 GitHub Secret）
//   · Eurostat  德国/欧盟 工业生产、基本金属生产（无 key）
//   · DBnomics→OECD KEI/CLI  各国 工业生产·出口·景气先行(CLI)·利率·CPI（无 key）
//                覆盖 OECD 及主要伙伴国，唯越南不在其列
//   · UN Comtrade  各国「自华钢材 HS72 进口」（无 key，preview）
//
// 字段：
//   nm 指标名 · rel 用钢相关性(高3/中2/低1) · dir 评分方向(1正/-1反)
//   calc 'pct'同比百分比分档 | 'pt'点差分档 · kind 'level'数值/'growth'已是同比%
//   provider+code 自动源 · compute:'realrate' 实际利率=长端利率−CPI同比
//   manual {value,score,source} 无免费API时的人工种子（看板照常渲染）
//   maxLagMonths 数据滞后超过此月数即判为过期→回退人工（保证“切近”）
// =============================================================================

export const SCORE_RULES = {
  pct: [ [5, 2], [1, 1], [-1, 0], [-5, -1], [-Infinity, -2] ],   // 同比%
  pt:  [ [2, 2], [0.5, 1], [-0.5, 0], [-2, -1], [-Infinity, -2] ] // 点差
};

// ---- OECD KEI（经 DBnomics）单元构造器 -------------------------------------
const KEI = a => `OECD/DSD_KEI@DF_KEI/${a}`;
const cProd = a => ({ provider: 'dbnomics', code: `${KEI(a)}.M.PRVM.GR.BTE.Y.GY`, kind: 'growth', calc: 'pct', unit: '%', maxLagMonths: 5, note: 'OECD KEI 工业生产同比' });
const cEx   = a => ({ provider: 'dbnomics', code: `${KEI(a)}.M.EX.GR._T.Y.GY`,     kind: 'growth', calc: 'pct', unit: '%', maxLagMonths: 6, note: 'OECD KEI 商品出口同比（贸易聚合滞后较多，时点见右栏）' });
const cCli  = a => ({ provider: 'dbnomics', code: `${KEI(a)}.M.LI.IX._T.AA._Z`,     kind: 'level',  calc: 'pt',  unit: 'idx', maxLagMonths: 4, note: 'OECD 合成领先指标(CLI)，与制造业 PMI 同向先行；100=趋势' });
const cReal = a => ({ compute: 'realrate', rate: `${KEI(a)}.M.IRLT.PA._Z._Z._Z`, cpi: `${KEI(a)}.M.CP.GR._Z._Z.GY`, kind: 'level', calc: 'pt', unit: '%', maxLagMonths: 5, note: '实际利率=长端国债利率−CPI同比（OECD KEI）' });
const man = (score, source, unit, value = null) => ({ provider: 'manual', unit, manual: { value, score, source } });

// 制造业 PMI（macroview 聚合 NBS官方/ISM/S&P Global），值=PMI水平，按偏离50打分
const cPmi = key => ({ provider: 'macroview', code: key, kind: 'pmi', calc: 'pt', unit: 'idx', maxLagMonths: 3,
  note: '制造业PMI（macroview 聚合 中国统计局/美国ISM/标普全球）；过期则回退 OECD CLI' });

// 景气领先指标格：PMI 优先（真实读数）→ 过期/缺失回退 OECD CLI → 再回退人工
function leadCell(pmiKey, area) {
  const cliOrMan = area
    ? { nm: '景气先行CLI', ...cCli(area), fallback: man(0, 'PMI/景气(人工)', 'idx') }
    : man(0, 'PMI/景气(人工)', 'idx');
  if (pmiKey) return { nm: '制造业PMI', rel: '中', dir: 1, ...cPmi(pmiKey), fallback: cliOrMan };
  return area
    ? { nm: '景气先行CLI', rel: '中', dir: 1, ...cCli(area), fallback: man(0, 'PMI/景气(人工)', 'idx') }
    : { nm: '制造业PMI', rel: '中', dir: 1, ...man(0, 'PMI/景气(人工)', 'idx') };
}

// 组装一个地区卡（统一 11 个指标格 + 自华进口脚注）
function region({ key, name, en, tier, china, reporter, area, pmiKey, steel, ip, inv, consume, priv, fisc, weup }) {
  const A = area; // OECD 代码，null=不在 OECD（如越南）
  const auto = A != null;
  return {
    key, name, en, tier, china,
    chinaImport: { provider: 'comtrade', reporter, hs: '72', unit: '吨' },
    industry: [
      { nm: '粗钢产量',   rel: '高', dir: 1,  ...steel },
      { nm: '第二产业用电', rel: '高', dir: 1, ...(weup || man(0, '（人工）', 'GWh')) },
      { nm: '制造业出口', rel: '高', dir: 1,  ...(auto ? cEx(A) : man(0, '（人工）', '%')) },
    ],
    macro: [
      leadCell(pmiKey, A),
      { nm: '工业增加值', rel: '中', dir: 1, ...ip },
      { nm: '实际利率',   rel: '高', dir: -1, ...(auto ? cReal(A) : man(0, '央行(人工)', '%')) },
      { nm: '库存',       rel: '中', dir: -1, ...(inv || man(0, '（人工）', 'idx')) },
    ],
    driver: [
      { nm: '居民消费', dir: 1, ...(consume || man(0, '（人工）', 'idx')) },
      { nm: '固投·私人', dir: 1, ...(priv || man(0, '（人工）', 'idx')) },
      { nm: '固投·财政', dir: 1, ...(fisc || man(0, '（人工）', 'idx')) },
      { nm: '出口外需', dir: 1, ...(auto ? cEx(A) : man(0, '（人工）', '%')) },
      { nm: '实际利率', dir: -1, ...(auto ? cReal(A) : man(0, '央行(人工)', '%')) },
    ],
    invFrom: inv && inv.provider === 'fred' ? { provider: 'fred', code: inv.code } : null,
    invSeed: inv && inv.manual ? inv.manual.score : 0,
  };
}

// FRED 单元
const fredCell = (code, unit, note, extra = {}) => ({ provider: 'fred', code, unit, kind: 'level', calc: 'pct', note, maxLagMonths: 4, ...extra });

export const REGIONS = [
  region({
    key: 'US', name: '美国', en: 'UNITED STATES', tier: '一线', reporter: 842, area: 'USA', pmiKey: 'us_ism_pmi',
    china: '本土供应为主、贸易壁垒高，对华直接出钢拉动有限；间接用钢随设备与汽车进口小幅承压。',
    steel: fredCell('IPG331S', 'idx', 'FRED 初级金属生产指数(NAICS331)，作粗钢产量代理；周度真值见 AISI'),
    ip:    fredCell('INDPRO', 'idx', 'FRED 工业生产总指数'),
    inv:   fredCell('BUSINV', '$m', 'FRED 全口径企业库存；升=偏空（反向）', { dir: -1 }),
    consume: fredCell('RSAFS', '$m', 'FRED 广义零售销售'),
    priv:  fredCell('DGORDER', '$m', 'FRED 耐用品新订单，作私人固投代理'),
    fisc:  fredCell('TLPUBCONS', '$m', 'FRED 公共部门建造支出，作财政投资代理'),
    weup:  man(1, 'EIA(人工)', '亿kWh'),
  }),
  region({
    key: 'DE', name: '德国', en: 'GERMANY', tier: '一线', reporter: 276, area: 'DEU', pmiKey: 'de',
    china: '欧洲制造业风向标；需求疲弱叠加中国成品（尤其汽车）竞争加剧，对华间接用钢偏空（替代型）。',
    steel: { provider: 'eurostat', code: 'sts_inpr_m|DE|C24', unit: 'idx', kind: 'level', calc: 'pct', maxLagMonths: 4, note: 'Eurostat 德国 基本金属(NACE C24)生产指数' },
    ip:    { provider: 'eurostat', code: 'sts_inpr_m|DE|B-D', unit: 'idx', kind: 'level', calc: 'pct', maxLagMonths: 4, note: 'Eurostat 德国 工业(B-D)生产指数，季调' },
    inv:   man(-1, '（人工）', 'idx'),
    consume: man(-1, 'Eurostat(人工)', 'idx'),
    priv:  man(-1, '（人工）', 'idx'),
    fisc:  man(0, '（人工）', 'idx'),
    weup:  man(-1, 'Eurostat(人工)', 'GWh'),
  }),
  region({
    key: 'EU', name: '欧盟 / 欧元区', en: 'EUROPEAN UNION', tier: '一线', reporter: 97, area: 'EA20',
    china: '作为单一关税与政策区（CBAM、对华钢材保障配额/反倾销）；自华钢材进口看 EU27 整体方向，整体需求弱则替代压力为主。',
    // IP/基本金属取 EU27 整体；出口/实际利率取 OECD 欧元区；自华钢材进口 reporter=97(EU27)
    steel: { provider: 'eurostat', code: 'sts_inpr_m|EU27_2020|C24', unit: 'idx', kind: 'level', calc: 'pct', maxLagMonths: 4, note: 'Eurostat 欧盟27 基本金属(NACE C24)生产指数' },
    ip:    { provider: 'eurostat', code: 'sts_inpr_m|EU27_2020|B-D', unit: 'idx', kind: 'level', calc: 'pct', maxLagMonths: 4, note: 'Eurostat 欧盟27 工业(B-D)生产指数，季调' },
    inv:   man(-1, '（人工）', 'idx'),
    consume: man(-1, 'Eurostat(人工)', 'idx'),
    priv:  man(-1, '（人工）', 'idx'),
    fisc:  man(0, 'NGEU/各国财政(人工)', 'idx'),
    weup:  man(-1, 'Eurostat(人工)', 'GWh'),
  }),
  region({
    key: 'IN', name: '印度', en: 'INDIA', tier: '一线', reporter: 699, area: 'IND', pmiKey: 'in',
    china: '需求旺盛对自华（直接+间接）用钢形成实质拉动；但本土高炉与 PLI 产能扩张中期形成替代。',
    steel: man(2, 'worldsteel/JPC(人工)', '万吨'),
    ip:    cProd('IND'),
    inv:   man(1, '（人工）', '万吨'),
    consume: man(1, '（人工）', 'idx'),
    priv:  man(1, '（人工）', 'idx'),
    fisc:  man(2, '财政部(人工)', '亿卢比'),
    weup:  man(1, 'CEA(人工)', 'GWh'),
  }),
  region({
    key: 'JP', name: '日本', en: 'JAPAN', tier: '一线', reporter: 392, area: 'JPN', pmiKey: 'jp',
    china: '高端装备/汽车产业链发达，自华以中间品与原料为主；本土钢铁自给高，直接拉动有限。',
    steel: man(0, 'worldsteel/JISF(人工)', '万吨'),
    ip:    cProd('JPN'),
    inv:   man(0, '（人工）', 'idx'),
    consume: man(0, '（人工）', 'idx'),
    priv:  man(0, '（人工）', 'idx'),
    fisc:  man(0, '（人工）', '万亿日元'),
    weup:  man(0, '（人工）', 'GWh'),
  }),
  region({
    key: 'KR', name: '韩国', en: 'SOUTH KOREA', tier: '一线', reporter: 410, area: 'KOR', pmiKey: 'kr',
    china: '造船/汽车/电子用钢大国，与中国互为钢材与中间品贸易方；出口高频反映外需冷暖。',
    steel: man(0, 'worldsteel/KOSA(人工)', '万吨'),
    ip:    cProd('KOR'),
    inv:   man(0, '（人工）', 'idx'),
    consume: man(0, '（人工）', 'idx'),
    priv:  man(0, '（人工）', 'idx'),
    fisc:  man(0, '（人工）', '万亿韩元'),
    weup:  man(0, '（人工）', 'GWh'),
  }),
  region({
    key: 'MX', name: '墨西哥', en: 'MEXICO', tier: '一线', reporter: 484, area: 'MEX',
    china: '近岸外包热点，制造与建筑用钢扩张；自华钢材与中间品进口快速上升（依赖型，利多）。',
    steel: man(1, 'worldsteel/CANACERO(人工)', '万吨'),
    ip:    man(0, 'INEGI(人工)', 'idx'),   // OECD KEI 无墨西哥月度工业生产同比
    inv:   man(0, '（人工）', 'idx'),
    consume: man(1, '（人工）', 'idx'),
    priv:  man(1, '（人工）', 'idx'),
    fisc:  man(0, '（人工）', '亿比索'),
    weup:  man(0, '（人工）', 'GWh'),
  }),
  region({
    key: 'ID', name: '印尼', en: 'INDONESIA', tier: '一线', reporter: 360, area: 'IDN',
    china: '镍-不锈钢一体化与基建扩张，自华装备与钢材进口旺盛（依赖型，利多）。',
    steel: man(1, 'worldsteel/IISIA(人工)', '万吨'),
    ip:    man(1, 'BPS(人工)', 'idx'),     // OECD KEI 无印尼月度工业生产同比
    inv:   man(0, '（人工）', 'idx'),
    consume: man(1, '（人工）', 'idx'),
    priv:  man(1, '（人工）', 'idx'),
    fisc:  man(1, '（人工）', '万亿盾'),
    weup:  man(1, 'PLN(人工)', 'GWh'),
  }),
  region({
    key: 'VN', name: '越南', en: 'VIETNAM', tier: '一线', reporter: 704, area: null, // 不在 OECD
    china: '高度依赖自华钢材与中间品，对中国用钢形成直接拉动（依赖型，利多）。',
    steel: man(1, 'VSA(人工)', '万吨'),
    ip:    man(1, 'GSO IIP(人工)', 'idx'),
    inv:   man(-1, 'GSO(人工)', 'idx'),
    consume: man(0, 'GSO(人工)', '万亿盾'),
    priv:  man(1, '（人工）', 'idx'),
    fisc:  man(1, 'MPI(人工)', '万亿盾'),
    weup:  man(1, 'EVN(人工)', 'GWh'),
  }),
];
