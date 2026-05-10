import staticTickers from '../../../data/tickers.json';
import { calcScore } from '../../../lib/scoring';

const UA        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const BATCH     = 50;
const CONCURRENT = 6;
const THRESHOLD  = 0.95;
const MIN_CAP    = 1_000_000_000; // $1B

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
    dividendYield: q.trailingAnnualDividendYield
      ? Math.round(q.trailingAnnualDividendYield * 1000) / 10
      : 0,
    ma50:    q.fiftyDayAverage || null,
    ma50Dev,
    earningsDate: q.earningsTimestamp
      ? new Date(q.earningsTimestamp * 1000).toISOString().slice(0, 10)
      : null,
  };
  row.score = calcScore(row);
  return row;
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

    // フィルタ → スコア → 上位25件
    const candidates = rawQuotes
      .filter(q =>
        q.regularMarketPrice &&
        q.fiftyTwoWeekHigh &&
        (q.marketCap || 0) >= MIN_CAP &&
        q.regularMarketPrice / q.fiftyTwoWeekHigh >= THRESHOLD
      )
      .map(q => mapQuote(q, tickerMap[q.symbol]))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    return Response.json({
      rows: candidates,
      scannedCount,
      scannedAt: new Date().toISOString(),
      source: screenerHasFull ? 'screener' : screenerOk ? 'screener+v7' : 'static',
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
