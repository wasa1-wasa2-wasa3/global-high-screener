import { calcScore } from '../../../lib/scoring';
import { getTrendMode } from '../../../lib/trend-analyzer';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

// Hidden Growth モード定数
const MIN_CAP_USD    = 500_000_000;   // $500M 以上
const MAX_CAP_USD    = 50_000_000_000; // $50B 以下
const MIN_REV_GROWTH = 25;            // 売上YoY 条件A: ≥25%
const MIN_REV_B      = 15;            // 売上YoY 条件B: ≥15%
const MIN_GM_B       = 50;            // 条件B: GM ≥50%
const MIN_GM_HARD    = 40;            // ハードフィルタ: GM ≥40%
const MAX_VOL_RATIO  = 1.2;           // 出来高静か
const MAX_MONTH_RET  = 5.0;           // 月次騰落 ±5%以内
const MIN_LIQUIDITY  = 500_000;       // 日次流動性 $500K/日
const UNIVERSE_SIZE  = 500;           // スクリーナーから取得する銘柄数

// ─── Crumb ─────────────────────────────────────────────────────────────────

async function getCrumb() {
  const r1 = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA }, redirect: 'follow',
  });
  const cookies = (r1.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookies },
  });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length < 3) throw new Error('crumb empty');
  return { crumb, cookie: cookies };
}

async function getCrumbWithRetry() {
  for (let i = 0; i < 3; i++) {
    try { return await getCrumb(); }
    catch (e) {
      if (i === 2) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// ─── Phase 1: スクリーナーで上位500銘柄を取得 ─────────────────────────────

async function fetchScreenerPage(offset, crumb, cookie) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US&formatted=false`;
  const body = JSON.stringify({
    offset, size: 250,
    sortField: 'intradaymarketcap',
    sortType: 'DESC',
    quoteType: 'EQUITY',
    topOperator: 'AND',
    query: {
      operator: 'AND',
      operands: [
        { operator: 'gt', operands: ['intradaymarketcap', MIN_CAP_USD] },
        { operator: 'or', operands: [
          { operator: 'EQ', operands: ['exchange', 'NMS'] },
          { operator: 'EQ', operands: ['exchange', 'NYQ'] },
        ]},
      ],
    },
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body, signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.finance?.result?.[0]?.quotes || [];
  } catch { clearTimeout(timer); return []; }
}

async function fetchUniverse(crumb, cookie) {
  // 500銘柄: 2ページ並列
  const pages = await Promise.all(
    [0, 250].map(offset => fetchScreenerPage(offset, crumb, cookie))
  );
  return pages.flat().slice(0, UNIVERSE_SIZE);
}

// ─── Phase 2: チャートデータ取得 + 月次フィルタ ───────────────────────────

async function fetchChart(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result?.indicators?.quote?.[0]) return null;
    const { close, volume, open } = result.indicators.quote[0];
    const timestamps = result.timestamp;
    const rows = close.map((c, i) => ({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close: c,
      open: open?.[i] ?? null,
      volume: volume[i],
    })).filter(r => r.close != null && !isNaN(r.close));
    return rows.length >= 25 ? rows : null;
  } catch { clearTimeout(timer); return null; }
}

function calcChartMetrics(rows, qqqFactor) {
  const latest = rows.at(-1);
  const latestIdx = rows.length - 1;

  // 月次騰落（21営業日）— 5日平均クローズで平滑化
  const close5arr = rows.slice(Math.max(0, latestIdx - 4), latestIdx + 1)
    .map(r => r.close).filter(v => v != null);
  const smoothClose = close5arr.length >= 2
    ? close5arr.reduce((a, b) => a + b, 0) / close5arr.length
    : latest.close;

  if (latestIdx < 21) return null;
  const monthAgo = rows[latestIdx - 21];
  const monthReturn = (smoothClose - monthAgo.close) / monthAgo.close * 100;
  if (Math.abs(monthReturn) > MAX_MONTH_RET) return null;

  // 出来高比（21日平均）
  const latestVol = latest.volume || 0;
  const recentVols = rows.slice(Math.max(0, latestIdx - 21), latestIdx)
    .map(r => r.volume).filter(v => v != null && v > 0);
  const avgVol = recentVols.length > 0
    ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : 0;
  const volRatio = avgVol > 0 ? Math.round(latestVol / avgVol * 10) / 10 : null;
  if (volRatio !== null && volRatio > MAX_VOL_RATIO) return null;

  // 流動性フィルタ
  if (avgVol > 0 && latest.close * avgVol < MIN_LIQUIDITY) return null;

  // 5日出来高比（シグナル用）
  const recentVols5 = rows.slice(Math.max(0, latestIdx - 5), latestIdx)
    .map(r => r.volume).filter(v => v != null && v > 0);
  const avgVol5 = recentVols5.length > 0
    ? recentVols5.reduce((a, b) => a + b, 0) / recentVols5.length : 0;
  const vol5Ratio = avgVol5 > 0 ? Math.round(latestVol / avgVol5 * 10) / 10 : null;

  // 前日比
  const prevClose = latestIdx > 0 ? rows[latestIdx - 1].close : null;
  const dayChangePct = prevClose
    ? Math.round((latest.close / prevClose - 1) * 10000) / 100 : null;

  // MA25乖離
  const closes25 = rows.slice(Math.max(0, latestIdx - 24), latestIdx + 1).map(r => r.close);
  const ma25 = closes25.length === 25
    ? closes25.reduce((a, b) => a + b, 0) / 25 : null;
  const ma25Dev = ma25 ? Math.round((smoothClose / ma25 - 1) * 1000) / 10 : null;

  // 潜伏日数（±12%バンド内の連続日数）
  const band = smoothClose * 0.12;
  let hiddenDays = 0;
  for (let j = latestIdx; j >= 0; j--) {
    if (Math.abs(rows[j].close - smoothClose) <= band) hiddenDays++;
    else break;
  }

  // 52週高値
  const week52High = Math.max(...rows.slice(Math.max(0, latestIdx - 251), latestIdx + 1).map(r => r.close));

  // RS vs QQQ
  let rs = null;
  if (qqqFactor != null && qqqFactor > 0 && rows.length >= 2) {
    const stockFactor = rows.at(-1).close / rows[0].close;
    rs = Math.round(stockFactor / qqqFactor * 100) / 100;
  }

  return {
    close: latest.close,
    date: latest.date,
    monthReturn: Math.round(monthReturn * 100) / 100,
    volRatio,
    vol5Ratio,
    volK: Math.round(latestVol / 1000),
    dayChangePct,
    ma25Dev,
    hiddenDays,
    week52High,
    high52Pct: ((latest.close / week52High - 1) * 100).toFixed(1),
    rs,
  };
}

// ─── Phase 3: v7/quote バッチ取得 ─────────────────────────────────────────

async function fetchBatchQuotes(symbols, crumb, cookie) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&crumb=${encodeURIComponent(crumb)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    return (await res.json()).quoteResponse?.result || [];
  } catch { clearTimeout(timer); return []; }
}

// ─── Phase 4: quoteSummary でファンダ取得 ─────────────────────────────────

async function fetchFundamentals(ticker, crumb, cookie) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`
    + `?modules=financialData,incomeStatementHistory,calendarEvents&crumb=${encodeURIComponent(crumb)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ticker };
    const result = (await res.json())?.quoteSummary?.result?.[0];
    const fd = result?.financialData;
    if (!fd) return { ticker };

    const revenueGrowthYoy = fd.revenueGrowth?.raw != null
      ? Math.round(fd.revenueGrowth.raw * 1000) / 10 : null;
    const grossMargin = fd.grossMargins?.raw != null
      ? Math.round(fd.grossMargins.raw * 1000) / 10 : null;
    const operatingMargin = fd.operatingMargins?.raw != null
      ? Math.round(fd.operatingMargins.raw * 1000) / 10 : null;
    const fcf = fd.freeCashflow?.raw;
    const rev = fd.totalRevenue?.raw;
    const fcfMargin = fcf != null && rev != null && rev > 0
      ? Math.round(fcf / rev * 1000) / 10 : null;
    const ruleOf40 = revenueGrowthYoy != null && fcfMargin != null
      ? Math.round(revenueGrowthYoy + fcfMargin) : null;
    const operatingIncome = fd.operatingCashflow?.raw ?? null;

    // 前期売上YoY（一過性チェック用）
    const isl = result?.incomeStatementHistory?.incomeStatementHistory;
    let prevRevenueGrowth = null;
    if (Array.isArray(isl) && isl.length >= 3) {
      const r1 = isl[1]?.totalRevenue?.raw;
      const r2 = isl[2]?.totalRevenue?.raw;
      if (r1 != null && r2 != null && r2 > 0) prevRevenueGrowth = (r1 - r2) / r2;
    }

    // 次回決算日
    let earningsDate = null;
    const edArr = result?.calendarEvents?.earnings?.earningsDate;
    if (Array.isArray(edArr)) {
      const nowSec = Date.now() / 1000;
      const next = edArr.find(e => e.raw > nowSec);
      if (next?.raw) earningsDate = new Date(next.raw * 1000).toISOString().slice(0, 10);
    }

    return { ticker, revenueGrowthYoy, grossMargin, operatingMargin, fcfMargin, ruleOf40, operatingIncome, prevRevenueGrowth, earningsDate };
  } catch { clearTimeout(timer); return { ticker }; }
}

// ─── セクター上限 ──────────────────────────────────────────────────────────

function applySectorCap(rows, max = 3) {
  const counts = {};
  return rows.filter(r => {
    const s = r.sector || 'Unknown';
    counts[s] = (counts[s] || 0) + 1;
    return counts[s] <= max;
  });
}

// ─── SaaS例外判定 ─────────────────────────────────────────────────────────

function isSaaSException(r) {
  return (
    (r.grossMargin ?? 0) >= 70 &&
    (r.revenueGrowthYoy ?? 0) >= 30 &&
    r.freeCashflow > 0 &&
    (r.marketCap ?? 0) >= 1_000_000_000
  );
}

// ─── Main handler ──────────────────────────────────────────────────────────

export const maxDuration = 300;

export async function POST() {
  try {
    const { crumb, cookie } = await getCrumbWithRetry();

    // Phase 0: QQQチャートを取得してRS計算のベースに
    const qqqRows = await fetchChart('QQQ');
    const qqqFactor = qqqRows && qqqRows.length >= 2
      ? qqqRows.at(-1).close / qqqRows[0].close : null;

    // Phase 1: スクリーナーで上位500銘柄
    const screenerQuotes = await fetchUniverse(crumb, cookie);
    if (screenerQuotes.length === 0) {
      return Response.json({ error: 'Yahoo Finance に接続できませんでした。しばらくしてから再試行してください。' }, { status: 503 });
    }

    const tickers = screenerQuotes.map(q => q.symbol);

    // Phase 2: 全銘柄のチャート取得 + 月次フィルタ（10並列）
    const CHART_CONCURRENT = 10;
    const candidates = [];
    for (let i = 0; i < tickers.length; i += CHART_CONCURRENT) {
      const batch = tickers.slice(i, i + CHART_CONCURRENT);
      const charts = await Promise.all(batch.map(t => fetchChart(t)));
      for (let j = 0; j < batch.length; j++) {
        const rows = charts[j];
        if (!rows) continue;
        const metrics = calcChartMetrics(rows, qqqFactor);
        if (!metrics) continue;
        const sq = screenerQuotes.find(q => q.symbol === batch[j]);
        candidates.push({
          ticker: batch[j],
          name: sq?.shortName || sq?.longName || batch[j],
          sector: sq?.sector || null,
          ...metrics,
        });
      }
    }

    if (candidates.length === 0) {
      return Response.json({ error: 'Hidden Growth 条件に該当する銘柄が見つかりませんでした。' }, { status: 200 });
    }

    // Phase 3: v7/quote で時価総額・PSRを取得、時価総額フィルタ
    const QBATCH = 100;
    for (let i = 0; i < candidates.length; i += QBATCH) {
      const syms = candidates.slice(i, i + QBATCH).map(r => r.ticker);
      const quotes = await fetchBatchQuotes(syms, crumb, cookie);
      for (const q of quotes) {
        const r = candidates.find(x => x.ticker === q.symbol);
        if (!r) continue;
        r.marketCap = q.marketCap || null;
        r.psr = q.priceToSalesTrailing12Months > 0
          ? Math.round(q.priceToSalesTrailing12Months * 10) / 10 : null;
        r.pe = q.trailingPE || null;
        if (!r.sector && q.sector) r.sector = q.sector;
      }
    }

    // 時価総額フィルタ: $500M〜$50B
    const capFiltered = candidates.filter(r =>
      r.marketCap == null ||
      (r.marketCap >= MIN_CAP_USD && r.marketCap <= MAX_CAP_USD)
    );

    // Phase 4: quoteSummary でファンダ取得（上位200件、30並列）
    const targets = capFiltered.slice(0, 200);
    const SBATCH = 30;
    for (let i = 0; i < targets.length; i += SBATCH) {
      await Promise.all(targets.slice(i, i + SBATCH).map(async r => {
        const f = await fetchFundamentals(r.ticker, crumb, cookie);
        if (f.revenueGrowthYoy != null) r.revenueGrowthYoy = f.revenueGrowthYoy;
        if (f.grossMargin      != null) r.grossMargin      = f.grossMargin;
        if (f.operatingMargin  != null) r.operatingMargin  = f.operatingMargin;
        if (f.fcfMargin        != null) r.fcfMargin        = f.fcfMargin;
        if (f.ruleOf40         != null) r.ruleOf40         = f.ruleOf40;
        if (f.operatingIncome  != null) r.operatingIncome  = f.operatingIncome;
        if (f.prevRevenueGrowth!= null) r.prevRevenueGrowth= f.prevRevenueGrowth;
        if (f.earningsDate     != null) r.earningsDate     = f.earningsDate;
      }));
    }

    // 最終フィルタ
    const filtered = targets.filter(r => {
      const rg = r.revenueGrowthYoy ?? null;
      const gm = r.grossMargin ?? null;

      // グロスマージン ハードフィルタ（データあれば）
      if (gm != null && gm < MIN_GM_HARD) return false;

      // 売上YoY フィルタ
      const passA = rg != null && rg >= MIN_REV_GROWTH;
      const passB = rg != null && rg >= MIN_REV_B
        && gm != null && gm >= MIN_GM_B
        && (r.prevRevenueGrowth == null || r.prevRevenueGrowth >= 0.05);
      if (rg != null && !passA && !passB) return false;

      // 営業赤字フィルタ（SaaS例外あり）
      if (r.operatingIncome != null && r.operatingIncome <= 0 && !isSaaSException(r)) return false;

      return true;
    });

    // スコアリング
    for (const r of filtered) {
      r.score = calcScore(r);
      r.trendMode = getTrendMode(r);
      if (isSaaSException(r) && (r.operatingIncome ?? 1) <= 0) r.isSaaSException = true;
    }

    // スコア降順ソート → セクター上限3件 → 上位25件
    filtered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const rows = applySectorCap(filtered).slice(0, 25);

    console.log(`[hidden-scan] 完了: universe=${tickers.length} candidates=${candidates.length} filtered=${filtered.length} result=${rows.length}`);

    return Response.json({
      rows,
      scannedCount: tickers.length,
      scannedAt: new Date().toISOString(),
      mode: 'hidden',
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
