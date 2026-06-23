# 海外制造业 Tracking Panel — 真实数据 · 自动更新

一个**自动从权威数据源抓取真实数据**的制造业看板。页面托管在 GitHub Pages，
数据由 GitHub Actions **每周自动刷新**——不依赖你的电脑，分享链接给别人也会自动更新。

看板每个指标格子显示的是**真实读数**（如工业生产指数 90.9、自华钢材进口 $47.1M）
及其**同比**，再据此自动生成 −2~+2 的动量评分、综合评分与周期相位。

```
config/sources.mjs   指标 → 数据源映射（每个格子登记在这里）
lib/providers.mjs    FRED / Eurostat / UN Comtrade / AISI 适配器
scripts/fetch.mjs    取数 + 算同比/环比 + 打分 → 写 data/data.json
index.html           看板前端（读 data/data.json 渲染真实值）
.github/workflows/   每周自动刷新 + 发布到 GitHub Pages
```

## 数据源现状

| 数据源 | 覆盖 | 密钥 | 状态 |
|---|---|---|---|
| **FRED** | 美国 宏观/驱动整列（工业增加值·实际利率·库存·零售·耐用品订单·公共建造·初级金属生产） | 免费密钥 | 配密钥后全自动 |
| **Eurostat** | 德国/欧盟 工业生产指数、基本金属(C24)生产 | 无 | ✅ 已自动 |
| **OECD CLI / KEI**（经 DBnomics） | 各国 **景气先行 CLI**、**工业生产同比**、**商品出口同比**、**实际利率**（长端利率−CPI同比） | 无 | ✅ 已自动 |
| **UN Comtrade** | 各区域「自华钢材 HS72 进口」额 + 同比 | 无 | ✅ 已自动 |
| AISI | 美国 周度产能利用率 | 无 | 尽力解析，失败回退人工 |
| 人工 | 粗钢产量(worldsteel)、第二产业用电、库存、居民消费等无免费 API 者 | — | 在 `config/sources.mjs` 录入种子 |

覆盖地区：美国 · 德国/欧盟 · 印度 · 日本 · 韩国 · 墨西哥 · 印尼 · 越南（共 8 张卡）。
> 注：**越南不在 OECD**，OECD 系列无覆盖，故仅 Comtrade 自动 + 人工；其余 7 国均有 CLI/出口/实际利率自动。

**关于「景气先行 CLI」**：各国 PMI（S&P Global/ISM）受版权限制，无干净免费 API。改用
OECD 合成领先指标 CLI（与制造业 PMI 同向、领先，且免费、跨国可比、月度更新）。若需 PMI
标题值，可在 `config/sources.mjs` 把该格改回 `manual` 人工录入。

**关于「切近性」**：取数带**过期保护**——某序列最新观测滞后超过 `maxLagMonths` 个月即判为
过期、回退人工种子，避免把过时数据当现值（如部分国家 CPI 落后则其实际利率自动回退）。

> 标 ● 的格子=自动真实序列；标 ○=暂无近期免费数据，沿用人工。看板始终完整渲染。
> growth 型格子（工业生产/出口）直接显示**同比%**，右侧小字为数据时点（如 ’26·04）。

---

## 一、获取免费 FRED 密钥（约 2 分钟）

FRED 覆盖美国卡片的宏观+驱动整列，是最值得自动化的源。

1. 打开 https://fredaccount.stlouisfed.org/login/secure/ ，点 **Register**（用邮箱注册，免费）。
2. 登录后进入 **My Account → API Keys**：https://fredaccount.stlouisfed.org/apikeys
3. 点 **Request API Key**，用途随便填（如 "manufacturing dashboard"），立即拿到一串
   32 位密钥，形如 `abcdef1234567890abcdef1234567890`。
4. 这串密钥**不要**写进任何会公开的文件，下面会放进 GitHub 的加密 Secret。

---

## 二、放到 GitHub，实现「每周自动 + 脱离本机 + 分享可看」

### 1. 新建仓库并上传
在 https://github.com/new 建一个仓库（如 `mfg-panel`，可设为 Public 或 Private 均可）。
然后在本项目文件夹里（已含 `.git`）执行：

```bash
git remote add origin https://github.com/<你的用户名>/mfg-panel.git
git branch -M main
git push -u origin main
```

### 2. 配置 FRED 密钥（加密，不会泄露）
仓库页面 → **Settings → Secrets and variables → Actions → New repository secret**
- Name：`FRED_API_KEY`
- Secret：粘贴第一步拿到的密钥 → **Add secret**

### 3. 打开 GitHub Pages
仓库 → **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

### 4. 跑一次
仓库 → **Actions** 标签 → 选 “刷新看板数据并发布” → **Run workflow**。
跑完后页面地址为：`https://<你的用户名>.github.io/mfg-panel/`
把这个链接分享给任何人，他们打开看到的就是最新数据。

之后**每周一自动刷新**（cron `0 5 * * 1`，北京时间周一 13:00），无需你做任何事，
你的电脑关机也照常更新。要改频率就编辑 `.github/workflows/update.yml` 里的 `cron`。

---

## 三、本地预览 / 调试

```bash
# 取一次数据（不带 FRED 密钥也能跑：Eurostat + Comtrade 真实，其余回退人工）
npm run fetch

# 带美国真实数据本地跑（把 xxx 换成你的 FRED 密钥）
FRED_API_KEY=xxxxxxxx npm run fetch      # Windows PowerShell: $env:FRED_API_KEY="xxxx"; npm run fetch

# 启本地预览服务器 → 浏览器开 http://localhost:4178
npm run serve
```

---

## 四、人工指标怎么维护

没有免费 API 的格子（如各国 PMI、印度/越南本土数据）在 `config/sources.mjs` 中
`provider:'manual'`，带一个种子：

```js
{ nm:'制造业PMI', rel:'中', dir:1, calc:'pt', provider:'manual', unit:'指数',
  manual:{ value:48.5, score:-1, source:'ISM(人工)' } }
```

- `value`：填真实读数（会显示在看板上）；`score`：该指标的 −2~+2 评分；`source`：标注来源。
- 改完 `git push`，Actions 会重新发布。

## 五、想加自动源 / 新地区

- 加 FRED 序列：在对应指标把 `provider:'manual'` 改成 `provider:'fred', code:'<序列ID>'`
  （序列 ID 在 https://fred.stlouisfed.org 搜索得到，如 `INDPRO`、`DGORDER`）。
- 加新地区：在 `config/sources.mjs` 的 `REGIONS` 复制一个区块改字段即可，前端自动多出一张卡。

## 评分口径（与原 Excel 一致）
- 百分比类：同比 ≥+5%→+2 / +1~+5%→+1 / −1~+1%→0 / −5~−1%→−1 / <−5%→−2
- 点差类（PMI/利率）：12 个月点差 ≥+2→+2 / +0.5~+2→+1 / ±0.5→0 / −2~−0.5→−1 / <−2→−2
- 库存、实际利率为**反向指标**，自动反号。
