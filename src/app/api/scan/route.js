import tickers from '../../../data/tickers.json';
import { calcScore } from '../../../lib/scoring';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const BATCH = 50;
const THRESHOLD = 0.95; // within 5% of 52-week high

async function getCrumb() {
  const r1 = await fetch('https://fc.yahoo.com/', {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });
  const setCookies = r1.headers.getSetCookie?.() ?? [];
  const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr },
  });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length < 3) throw new Error('crumb empty');
  return { crumb, cookie: cookieStr };
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

async function fetchBatchQuotes(symbols, crumb, cookie) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}&crumb=${encodeURIComponent(crumb)}`;
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

export const maxDuration = 60;

export async function POST() {
  try {
    const { crumb, cookie } = await getCrumbWithRetry();

    const allSymbols = tickers.map(t => t.ticker);
    const batches = [];
    for (let i = 0; i < allSymbols.length; i += BATCH) {
      batches.push(allSymbols.slice(i, i + BATCH));
    }

    const allQuotes = (await Promise.all(
      batches.map(b => fetchBatchQuotes(b, crumb, cookie))
    )).flat();

    if (allQuotes.length === 0) {
      return Response.json({ error: 'Yahoo Finance に接続できませんでした。しばらくしてから再試行してください。' }, { status: 503 });
    }

    const tickerMap = Object.fromEntries(tickers.map(t => [t.ticker, t]));

    const candidates = allQuotes
      .filter(q => {
        if (!q.regularMarketPrice || !q.fiftyTwoWeekHigh) return false;
        return q.regularMarketPrice / q.fiftyTwoWeekHigh >= THRESHOLD;
      })
      .map(q => {
        const price      = q.regularMarketPrice;
        const week52High = q.fiftyTwoWeekHigh;
        const volume     = q.regularMarketVolume || 0;
        const volAvg     = q.averageDailyVolume10Day || 0;
        const volRatio   = volAvg > 0 ? Math.round((volume / volAvg) * 10) / 10 : 0;
        const ma50Dev    = q.fiftyDayAverage > 0
          ? Math.round((price / q.fiftyDayAverage - 1) * 1000) / 10
          : null;
        const meta = tickerMap[q.symbol] || {};

        const row = {
          ticker:       q.symbol,
          name:         q.shortName || q.longName || q.symbol,
          sector:       meta.sector || '—',
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
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    return Response.json({ rows: candidates, scannedAt: new Date().toISOString() });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
