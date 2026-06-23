// =============================================================================
// 指标 → 数据源映射表  (config/sources.mjs)
// -----------------------------------------------------------------------------
// 看板每一个指标格子都在这里登记。fetch.mjs 据此自动取数、算同比/环比、打分。
//
// 字段说明：
//   nm        指标名（与看板显示一致）
//   rel       用钢相关性：'高' | '中' | '低'   → 决定综合评分权重 (高3/中2/低1)
//   dir       评分方向：1=正向(越升越好) | -1=反向(如库存、实际利率，越升越差)
//   calc      'pct'=按同比百分比分档 | 'pt'=按点差分档(PMI/利率水平)
//   provider  'fred' | 'eurostat' | 'comtrade' | 'aisi' | 'manual'
//   code      该 provider 下的序列代码 / 参数
//   unit      显示单位
//   freq      'M'月 | 'W'周 | 'Q'季 | 'D'日
//   note      备注（口径/代理说明）
//   manual    当 provider==='manual' 时的人工种子 {value, score, source}
//
// 自动源现状（best-effort）：
//   · FRED      美国宏观/驱动几乎全列（需免费 API key，存 GitHub Secret）
//   · Eurostat  德国/欧盟 工业生产指数（免费无 key）
//   · Comtrade  各地区「自华钢材进口」HS72（免费 preview 端点，无 key）
//   · AISI      美国周度粗钢产量/产能利用率（尽力解析，失败回退人工）
//   其余无免费 API 的格子标记 manual，沿用上一期人工读数，看板照常渲染。
// =============================================================================

// 评分分档规则（来源：Excel「使用说明」R28/R29）
export const SCORE_RULES = {
  pct: [ [5, 2], [1, 1], [-1, 0], [-5, -1], [-Infinity, -2] ],   // 同比% 阈值
  pt:  [ [2, 2], [0.5, 1], [-0.5, 0], [-2, -1], [-Infinity, -2] ] // 点差 阈值
};

// Comtrade reporter 代码（M49）
const M49 = { US: 842, DE: 276, IN: 699, VN: 704 };

export const REGIONS = [
  // ===========================================================================
  {
    key: 'US', name: '美国', en: 'UNITED STATES', tier: '一线',
    china: '本土供应为主、贸易壁垒高，对华直接出钢拉动有限；间接用钢随设备与汽车进口小幅承压。',
    // 「自华钢材进口」用 Comtrade 实算，喂给对华含义脚注
    chinaImport: { provider: 'comtrade', reporter: M49.US, hs: '72', unit: '吨' },

    industry: [
      { nm: '粗钢产量', rel: '高', dir: 1, calc: 'pct', freq: 'M',
        provider: 'fred', code: 'IPG331S', unit: '指数',
        note: 'FRED 初级金属工业生产指数(NAICS 331)，作粗钢产量代理；周度真值见 AISI' },
      { nm: '第二产业用电', rel: '高', dir: 1, calc: 'pct', freq: 'M',
        provider: 'manual', unit: '亿千瓦时',
        note: 'EIA 工业用电，暂无稳定免费 JSON，人工',
        manual: { value: null, score: 1, source: 'EIA(人工)' } },
      { nm: '制造业出口', rel: '高', dir: 1, calc: 'pct', freq: 'M',
        provider: 'fred', code: 'BOPGEXP', unit: '百万美元',
        note: 'BOP 商品出口额，作制造业外需代理' },
    ],
    macro: [
      { nm: '制造业PMI', rel: '中', dir: 1, calc: 'pt', freq: 'M',
        provider: 'manual', unit: '指数',
        note: 'ISM 受许可限制，FRED 已下架，人工录标题值',
        manual: { value: null, score: 0, source: 'ISM(人工)' } },
      { nm: '工业增加值', rel: '中', dir: 1, calc: 'pct', freq: 'M',
        provider: 'fred', code: 'INDPRO', unit: '指数', note: '美联储 G.17 工业生产总指数' },
      { nm: '实际利率', rel: '高', dir: -1, calc: 'pt', freq: 'D',
        provider: 'fred', code: 'DFII10', unit: '%',
        note: '10年期 TIPS 实际收益率；按 12 个月点差打分，升=融资收紧(反向)' },
      { nm: '库存', rel: '中', dir: -1, calc: 'pct', freq: 'M',
        provider: 'fred', code: 'BUSINV', unit: '百万美元',
        note: '全口径企业库存；升=偏空(反向)，也用作相位库存轴' },
    ],
    driver: [
      { nm: '居民消费', dir: 1, calc: 'pct', freq: 'M', provider: 'fred', code: 'RSAFS', unit: '百万美元', note: '广义零售销售额' },
      { nm: '固投·私人', dir: 1, calc: 'pct', freq: 'M', provider: 'fred', code: 'DGORDER', unit: '百万美元', note: '耐用品新订单，作私人固投代理' },
      { nm: '固投·财政', dir: 1, calc: 'pct', freq: 'M', provider: 'fred', code: 'TLPUBCONS', unit: '百万美元', note: '公共部门建造支出，作财政投资代理' },
      { nm: '出口外需', dir: 1, calc: 'pct', freq: 'M', provider: 'fred', code: 'BOPGEXP', unit: '百万美元', note: 'BOP 商品出口额' },
      { nm: '实际利率', dir: -1, calc: 'pt', freq: 'D', provider: 'fred', code: 'DFII10', unit: '%', note: '10年期 TIPS' },
    ],
    // 库存方向（相位纵轴）：复用 BUSINV，dir -1 已在 macro 里；此处单独取号
    invFrom: { provider: 'fred', code: 'BUSINV' },
  },

  // ===========================================================================
  {
    key: 'DE', name: '德国 / 欧盟', en: 'GERMANY / EU', tier: '一线',
    china: '需求疲弱叠加中国成品（尤其汽车）竞争加剧，对华间接用钢偏空（替代型）。',
    chinaImport: { provider: 'comtrade', reporter: M49.DE, hs: '72', unit: '吨' },

    industry: [
      { nm: '粗钢产量', rel: '高', dir: 1, calc: 'pct', freq: 'M',
        provider: 'eurostat', code: 'sts_inpr_m|DE|C24', unit: '指数',
        note: 'Eurostat 基本金属(NACE C24)生产指数' },
      { nm: '第二产业用电', rel: '高', dir: 1, calc: 'pct', freq: 'M',
        provider: 'manual', unit: 'GWh', manual: { value: null, score: -1, source: 'Eurostat(人工)' } },
      { nm: '制造业出口', rel: '高', dir: 1, calc: 'pct', freq: 'M',
        provider: 'manual', unit: '十亿欧元', manual: { value: null, score: -1, source: 'Destatis(人工)' } },
    ],
    macro: [
      { nm: '制造业PMI', rel: '中', dir: 1, calc: 'pt', freq: 'M',
        provider: 'manual', unit: '指数', manual: { value: null, score: -1, source: 'S&P Global(人工)' } },
      { nm: '工业增加值', rel: '中', dir: 1, calc: 'pct', freq: 'M',
        provider: 'eurostat', code: 'sts_inpr_m|DE|B-D', unit: '指数',
        note: 'Eurostat 工业(B-D)生产指数，经季调' },
      { nm: '实际利率', rel: '高', dir: -1, calc: 'pt', freq: 'M',
        provider: 'manual', unit: '%', manual: { value: null, score: 0, source: 'ECB(人工)' } },
      { nm: '库存', rel: '中', dir: -1, calc: 'pct', freq: 'M',
        provider: 'manual', unit: '指数', manual: { value: null, score: -1, source: '(人工)' } },
    ],
    driver: [
      { nm: '居民消费', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: -1, source: 'Eurostat(人工)' } },
      { nm: '固投·私人', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: -1, source: '(人工)' } },
      { nm: '固投·财政', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: 0, source: '(人工)' } },
      { nm: '出口外需', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '十亿欧元', manual: { value: null, score: -2, source: 'Eurostat(人工)' } },
      { nm: '实际利率', dir: -1, calc: 'pt', freq: 'M', provider: 'manual', unit: '%', manual: { value: null, score: 0, source: 'ECB(人工)' } },
    ],
    invFrom: null, // 无自动库存源，相位库存轴用人工 invSeed
    invSeed: -1,
  },

  // ===========================================================================
  {
    key: 'IN', name: '印度', en: 'INDIA', tier: '一线',
    china: '需求旺盛对自华（直接+间接）用钢形成实质拉动；但本土高炉与 PLI 产能扩张中期形成替代。',
    chinaImport: { provider: 'comtrade', reporter: M49.IN, hs: '72', unit: '吨' },

    industry: [
      { nm: '粗钢产量', rel: '高', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '万吨', manual: { value: null, score: 2, source: 'worldsteel/JPC(人工)' } },
      { nm: '第二产业用电', rel: '高', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: 'GWh', manual: { value: null, score: 1, source: 'CEA(人工)' } },
      { nm: '制造业出口', rel: '高', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '亿美元', manual: { value: null, score: 1, source: '商工部(人工)' } },
    ],
    macro: [
      { nm: '制造业PMI', rel: '中', dir: 1, calc: 'pt', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: 2, source: 'S&P Global(人工)' } },
      { nm: '工业增加值', rel: '中', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: 1, source: 'MOSPI IIP(人工)' } },
      { nm: '实际利率', rel: '高', dir: -1, calc: 'pt', freq: 'M', provider: 'manual', unit: '%', manual: { value: null, score: 0, source: 'RBI(人工)' } },
      { nm: '库存', rel: '中', dir: -1, calc: 'pct', freq: 'M', provider: 'manual', unit: '万吨', manual: { value: null, score: 1, source: '(人工)' } },
    ],
    driver: [
      { nm: '居民消费', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: 1, source: '(人工)' } },
      { nm: '固投·私人', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: 1, source: '(人工)' } },
      { nm: '固投·财政', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '亿卢比', manual: { value: null, score: 2, source: '财政部(人工)' } },
      { nm: '出口外需', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '亿美元', manual: { value: null, score: 1, source: '商工部(人工)' } },
      { nm: '实际利率', dir: -1, calc: 'pt', freq: 'M', provider: 'manual', unit: '%', manual: { value: null, score: 0, source: 'RBI(人工)' } },
    ],
    invFrom: null, invSeed: 1,
  },

  // ===========================================================================
  {
    key: 'VN', name: '越南', en: 'VIETNAM', tier: '一线',
    china: '高度依赖自华钢材与中间品，对中国用钢形成直接拉动（依赖型，利多）。',
    chinaImport: { provider: 'comtrade', reporter: M49.VN, hs: '72', unit: '吨' },

    industry: [
      { nm: '粗钢产量', rel: '高', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '万吨', manual: { value: null, score: 1, source: 'VSA(人工)' } },
      { nm: '第二产业用电', rel: '高', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: 'GWh', manual: { value: null, score: 1, source: 'EVN(人工)' } },
      { nm: '制造业出口', rel: '高', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '亿美元', manual: { value: null, score: 2, source: 'GSO(人工)' } },
    ],
    macro: [
      { nm: '制造业PMI', rel: '中', dir: 1, calc: 'pt', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: 1, source: 'S&P Global(人工)' } },
      { nm: '工业增加值', rel: '中', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: 1, source: 'GSO IIP(人工)' } },
      { nm: '实际利率', rel: '高', dir: -1, calc: 'pt', freq: 'M', provider: 'manual', unit: '%', manual: { value: null, score: 0, source: 'SBV(人工)' } },
      { nm: '库存', rel: '中', dir: -1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: -1, source: 'GSO(人工)' } },
    ],
    driver: [
      { nm: '居民消费', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '万亿盾', manual: { value: null, score: 0, source: 'GSO(人工)' } },
      { nm: '固投·私人', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '指数', manual: { value: null, score: 1, source: '(人工)' } },
      { nm: '固投·财政', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '万亿盾', manual: { value: null, score: 1, source: 'MPI(人工)' } },
      { nm: '出口外需', dir: 1, calc: 'pct', freq: 'M', provider: 'manual', unit: '亿美元', manual: { value: null, score: 2, source: 'GSO(人工)' } },
      { nm: '实际利率', dir: -1, calc: 'pt', freq: 'M', provider: 'manual', unit: '%', manual: { value: null, score: 0, source: 'SBV(人工)' } },
    ],
    invFrom: null, invSeed: -1,
  },
];
