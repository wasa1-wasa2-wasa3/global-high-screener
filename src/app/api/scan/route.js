import staticTickers from '../../../data/tickers.json';
import { calcScore } from '../../../lib/scoring';
import { getTrendMode } from '../../../lib/trend-analyzer';

const UA        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const BATCH     = 50;
const CONCURRENT = 6;
const THRESHOLD  = 0.95;
const MIN_CAP          = 1_000_000_000;  // $1B  — 下限
const MAX_CAP          = 50_000_000_000; // $50B — Mid-Cap 上限
const MIN_REV_YOY      = 15;   // Rev YoY +15% 未満は除外
const MAX_PSR          = 25;   // PSR 25倍超 = 投機バブル、除外
const MIN_VOL_AVG      = 200_000; // 日平均20万株未満 = 流動性不足、除外
const MIN_GROSS_MARGIN = 40;   // グロス利益率40%未満 = 低品質ビジネス、除外

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

// ─── Phase 1: Yahoo Finance スクリーナーで上位1,000銘柄を動的取得 ─────────

async function fetchScreenerPage(offset, crumb, cookie) {
  const url  = `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US&formatted=false`;
  const body = JSON.stringify({
    offset,
    size: 250,
    sortField: 'intradaymarketcap',
    sortType:  'DESC',
    quoteType: 'EQUITY',
    topOperator: 'AND',
    query: {
      operator: 'AND',
      operands: [
        { operator: 'gt', operands: ['intradaymarketcap', MIN_CAP] },
        { operator: 'or', operands: [
          { operator: 'EQ', operands: ['exchange', 'NMS'] },
          { operator: 'EQ', operands: ['exchange', 'NYQ'] },
        ]},
      ],
    },
  });
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Cookie': cookie, 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.finance?.result?.[0]?.quotes || [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

async function fetchTopStocksFromScreener(crumb, cookie) {
  // 4ページ並列 = 1,000銘柄
  const pages = await Promise.all(
    [0, 250, 500, 750].map(offset => fetchScreenerPage(offset, crumb, cookie))
  );
  return pages.flat();
}

// ─── Phase 2: v7/quote バッチ取得（最大6並列） ────────────────────────────

async function fetchBatchQuotes(symbols, crumb, cookie) {
  const url  = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&crumb=${encodeURIComponent(crumb)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Cookie': cookie },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    return data.quoteResponse?.result || [];
  } catch {
    clearTimeout(timer);
    return [];
  }
}

async function batchFetchWithConcurrency(symbols, crumb, cookie) {
  const batches = [];
  for (let i = 0; i < symbols.length; i += BATCH) {
    batches.push(symbols.slice(i, i + BATCH));
  }
  const results = [];
  for (let i = 0; i < batches.length; i += CONCURRENT) {
    const group = batches.slice(i, i + CONCURRENT);
    const chunk = await Promise.all(group.map(b => fetchBatchQuotes(b, crumb, cookie)));
    results.push(...chunk.flat());
  }
  return results;
}

// ─── Island Reversal 検知 ────────────────────────────────────────────────────

async function fetchChartOhlc(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result?.indicators?.quote?.[0]) return null;
    const { open, high, low, close } = result.indicators.quote[0];
    return open.map((o, i) => ({ open: o, high: high[i], low: low[i], close: close[i] }))
      .filter(r => r.open != null && r.high != null && r.low != null && r.close != null);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function isIslandReversal(ohlc) {
  if (!ohlc || ohlc.length < 4) return false;
  const n  = ohlc.at(-1);
  const p1 = ohlc.at(-2);
  const p2 = ohlc.at(-3);
  const p3 = ohlc.at(-4);
  // Gap Down: p2 opened ≥1.5% below p3's close
  const gapDown = p2.open < p3.close * 0.985;
  // Island: p1 stayed depressed (high didn't recover into pre-gap zone)
  const isolated = p1.high < p3.close * 0.99;
  // Gap Up: today opened above p1's high
  const gapUp = n.open > p1.high;
  return gapDown && isolated && gapUp;
}

// ─── セクター正規化 ────────────────────────────────────────────────────────

const SECTOR_NORM = {
  'Communication Services': 'Communication',
  'Consumer Discretionary': 'Consumer Cyclical',
  'Consumer Defensive':     'Consumer Staples',
  'Financial Services':     'Financial',
  'Finance':                'Financial',
  'Health Care':            'Healthcare',
  'Basic Materials':        'Materials',
  'Industrial':             'Industrials',
};

function normalizeSector(s) {
  if (!s || s === '—') return '—';
  return SECTOR_NORM[s] ?? s;
}

// ─── Quote マッピング ──────────────────────────────────────────────────────

function mapQuote(q, meta) {
  const price      = q.regularMarketPrice;
  const week52High = q.fiftyTwoWeekHigh;
  if (!price || !week52High) return null;

  const volume  = q.regularMarketVolume || 0;
  // screener は averageDailyVolume3Month、v7/quote は averageDailyVolume10Day
  const volAvg  = q.averageDailyVolume10Day || q.averageDailyVolume3Month || 0;
  const volRatio = volAvg > 0 ? Math.round((volume / volAvg) * 10) / 10 : 0;
  const ma50Dev  = q.fiftyDayAverage > 0
    ? Math.round((price / q.fiftyDayAverage - 1) * 1000) / 10
    : null;

  const row = {
    ticker:       q.symbol,
    name:         q.shortName || q.longName || q.symbol,
    sector:       normalizeSector(meta?.sector || q.sector),
    price,
    week52High,
    week52Low:    q.fiftyTwoWeekLow || 0,
    high52Pct:    ((price / week52High - 1) * 100).toFixed(1),
    volume,
    volAvg,
    volRatio,
    dayChangePct: Math.round((q.regularMarketChangePercent || 0) * 100) / 100,
    marketCap:    q.marketCap || 0,
    pe:           q.trailingPE || null,
    pbr:          q.priceToBook > 0 ? Math.round(q.priceToBook * 100) / 100 : null,
    // trailingAnnualDividendYield >25% = special dividend anomaly; suppress and flag
    dividendYield: (q.trailingAnnualDividendYield || 0) > 0.25
      ? 0
      : q.trailingAnnualDividendYield
        ? Math.round(q.trailingAnnualDividendYield * 1000) / 10
        : 0,
    specialDividend: (q.trailingAnnualDividendYield || 0) > 0.25,
    ma50:    q.fiftyDayAverage || null,
    ma50Dev,
    psr:     q.priceToSalesTrailing12Months > 0
      ? Math.round(q.priceToSalesTrailing12Months * 10) / 10
      : null,
    earningsDate: q.earningsTimestamp
      ? new Date(q.earningsTimestamp * 1000).toISOString().slice(0, 10)
      : null,
  };
  row.score     = calcScore(row);
  row.trendMode = getTrendMode(row);
  return row;
}

// ─── Phase 3: 上位25件の fundamentals を並列取得 ──────────────────────────

async function fetchOneFundamentals(ticker, crumb, cookie) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`
    + `?modules=financialData,incomeStatementHistory&crumb=${encodeURIComponent(crumb)}`;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ticker };
    const data = await res.json();
    const result = data.quoteSummary?.result?.[0];
    const fd = result?.financialData;
    if (!fd) return { ticker };

    const hist = result?.incomeStatementHistory?.incomeStatementHistory;
    let revCAGR3Y = null;
    if (hist && hist.length >= 2) {
      const revs = hist.map(y => y.totalRevenue?.raw).filter(r => r != null && r > 0);
      if (revs.length >= 2) {
        const n = revs.length - 1;
        revCAGR3Y = Math.round((Math.pow(revs[0] / revs[n], 1 / n) - 1) * 1000) / 10;
      }
    }

    return {
      ticker,
      revenueGrowthYoy: fd.revenueGrowth?.raw != null
        ? Math.round(fd.revenueGrowth.raw * 1000) / 10 : null,
      grossMargin: fd.grossMargins?.raw != null
        ? Math.round(fd.grossMargins.raw * 1000) / 10 : null,
      revCAGR3Y,
    };
  } catch {
    clearTimeout(timer);
    return { ticker };
  }
}

async function enrichCandidates(candidates, crumb, cookie) {
  const results = await Promise.allSettled(
    candidates.map(row => fetchOneFundamentals(row.ticker, crumb, cookie))
  );
  const map = {};
  results.forEach(r => { if (r.status === 'fulfilled') map[r.value.ticker] = r.value; });
  return map;
}

// ─── Main handler ─────────────────────────────────────────────────────────

export const maxDuration = 60;

export async function POST() {
  try {
    const { crumb, cookie } = await getCrumbWithRetry();
    const tickerMap = Object.fromEntries(staticTickers.map(t => [t.ticker, t]));

    // Phase 1: スクリーナーで上位1,000銘柄を動的取得
    const screenerQuotes = await fetchTopStocksFromScreener(crumb, cookie);
    const screenerOk = screenerQuotes.length >= 100;
    const screenerHasFull = screenerOk && screenerQuotes.some(q => q.fiftyTwoWeekHigh != null);

    let rawQuotes;

    if (screenerHasFull) {
      // スクリーナーに52週高値データあり → そのまま利用（追加API不要）
      rawQuotes = screenerQuotes;
    } else if (screenerOk) {
      // スクリーナー成功だが詳細データ不足 → v7/quote で補完
      const symbols = screenerQuotes.map(q => q.symbol);
      rawQuotes = await batchFetchWithConcurrency(symbols, crumb, cookie);
    } else {
      // スクリーナー失敗 → 静的リストにフォールバック
      const symbols = staticTickers.map(t => t.ticker);
      rawQuotes = await batchFetchWithConcurrency(symbols, crumb, cookie);
    }

    const scannedCount = rawQuotes.length;
    if (scannedCount === 0) {
      return Response.json(
        { error: 'Yahoo Finance に接続できませんでした。しばらくしてから再試行してください。' },
        { status: 503 }
      );
    }

    // フィルタ① (ハード): 52W高値圏 + 時価総額 + PSR + 流動性
    const candidates = rawQuotes
      .filter(q =>
        q.regularMarketPrice &&
        q.fiftyTwoWeekHigh &&
        (q.marketCap || 0) >= MIN_CAP &&
        (q.marketCap || 0) <= MAX_CAP &&
        q.regularMarketPrice / q.fiftyTwoWeekHigh >= THRESHOLD &&
        !(q.priceToSalesTrailing12Months > MAX_PSR) &&           // PSR 25倍超を除外
        (q.averageDailyVolume10Day || q.averageDailyVolume3Month || 0) >= MIN_VOL_AVG // 流動性フィルタ
      )
      .map(q => mapQuote(q, tickerMap[q.symbol]))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50); // Rev YoY フィルタ後も25件残るよう多めに取得

    // Phase 3: 上位50件の fundamentals (revenueGrowthYoy / grossMargin / revCAGR3Y) を並列取得
    const fundMap = await enrichCandidates(candidates, crumb, cookie);
    const enriched = candidates.map(row => {
      const f = fundMap[row.ticker];
      if (f?.revenueGrowthYoy != null || f?.grossMargin != null || f?.revCAGR3Y != null) {
        row.revenueGrowthYoy = f.revenueGrowthYoy ?? null;
        row.grossMargin      = f.grossMargin      ?? null;
        row.revCAGR3Y        = f.revCAGR3Y        ?? null;
        row.score = calcScore(row);
      }
      return row;
    });

    // フィルタ② (ハード): Rev YoY < 15% 除外 + Gross Margin < 40% 除外
    const rows = enriched
      .filter(row =>
        (row.revenueGrowthYoy == null || row.revenueGrowthYoy >= MIN_REV_YOY) &&
        (row.grossMargin      == null || row.grossMargin      >= MIN_GROSS_MARGIN)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    // Phase 4: Island Reversal 検知 + RS計算（QQQ含め並列フェッチ）
    const allCharts = await Promise.all([
      fetchChartOhlc('QQQ'),
      ...rows.map(row => fetchChartOhlc(row.ticker)),
    ]);
    const [qqqChart, ...stockCharts] = allCharts;
    const qqqFactor = qqqChart && qqqChart.length >= 2
      ? qqqChart.at(-1).close / qqqChart[0].close
      : null;

    rows.forEach((row, i) => {
      const ohlc = stockCharts[i];
      row.islandReversal = isIslandReversal(ohlc);
      if (ohlc && ohlc.length >= 2 && qqqFactor != null && qqqFactor > 0) {
        const stockFactor = ohlc.at(-1).close / ohlc[0].close;
        row.rs = Math.round((stockFactor / qqqFactor) * 100) / 100;
      }
      row.score = calcScore(row);
      if (row.islandReversal) row.score = Math.min(100, row.score + 5);
    });
    rows.sort((a, b) => b.score - a.score);

    return Response.json({
      rows,
      scannedCount,
      scannedAt: new Date().toISOString(),
      source: screenerHasFull ? 'screener' : screenerOk ? 'screener+v7' : 'static',
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
