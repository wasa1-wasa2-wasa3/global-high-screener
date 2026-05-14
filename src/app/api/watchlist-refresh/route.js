import { calcScore } from '../../../lib/scoring';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

async function getCrumb() {
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const setCookies = r1.headers.getSetCookie?.() ?? [];
  const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookieStr },
  });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length < 3) throw new Error('crumb empty');
  return { crumb, cookie: cookieStr };
}

async function fetchChartOhlc(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=7d`;
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
  const gapDown = p2.open < p3.close * 0.985;
  const isolated = p1.high < p3.close * 0.99;
  const gapUp = n.open > p1.high;
  return gapDown && isolated && gapUp;
}

async function fetchFundamentals(ticker, crumb, cookie) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`
    + `?modules=financialData&crumb=${encodeURIComponent(crumb)}`;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ticker };
    const data = await res.json();
    const fd = data.quoteSummary?.result?.[0]?.financialData;
    if (!fd) return { ticker };
    return {
      ticker,
      revenueGrowthYoy: fd.revenueGrowth?.raw != null
        ? Math.round(fd.revenueGrowth.raw * 1000) / 10 : null,
      grossMargin: fd.grossMargins?.raw != null
        ? Math.round(fd.grossMargins.raw * 1000) / 10 : null,
    };
  } catch {
    clearTimeout(timer);
    return { ticker };
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tickers = (body.tickers || []).slice(0, 50);
    if (tickers.length === 0) return Response.json({ rows: [] });

    const { crumb, cookie } = await getCrumb();

    // 相場データ・財務データ・チャートOHLCを並列取得
    const [quotesRes, fundResults, chartResults] = await Promise.all([
      fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${tickers.join(',')}&crumb=${encodeURIComponent(crumb)}`,
        { headers: { 'User-Agent': UA, 'Cookie': cookie }, signal: AbortSignal.timeout(8000) }
      ),
      Promise.allSettled(tickers.map(t => fetchFundamentals(t, crumb, cookie))),
      Promise.allSettled(tickers.map(t => fetchChartOhlc(t))),
    ]);

    if (!quotesRes.ok) return Response.json({ error: 'fetch failed' }, { status: 502 });
    const data = await quotesRes.json();
    const quotes = data.quoteResponse?.result || [];

    // ファンダメンタルズ・チャートを ticker → data のマップに変換
    const fundMap = {};
    fundResults.forEach(r => { if (r.status === 'fulfilled') fundMap[r.value.ticker] = r.value; });
    const chartMap = {};
    tickers.forEach((t, i) => {
      const r = chartResults[i];
      if (r.status === 'fulfilled') chartMap[t] = r.value;
    });

    const rows = quotes.map(q => {
      const price      = q.regularMarketPrice;
      const week52High = q.fiftyTwoWeekHigh;
      const volume     = q.regularMarketVolume || 0;
      const volAvg     = q.averageDailyVolume10Day || 0;
      const fund       = fundMap[q.symbol] || {};
      const row = {
        ticker:           q.symbol,
        price,
        week52High,
        high52Pct:        week52High > 0 ? ((price / week52High - 1) * 100).toFixed(1) : null,
        volume,
        volAvg,
        volRatio:         volAvg > 0 ? Math.round((volume / volAvg) * 10) / 10 : 0,
        dayChangePct:     Math.round((q.regularMarketChangePercent || 0) * 100) / 100,
        marketCap:        q.marketCap || 0,
        pe:               q.trailingPE || null,
        pbr:              q.priceToBook > 0 ? Math.round(q.priceToBook * 100) / 100 : null,
        dividendYield:    (q.trailingAnnualDividendYield || 0) > 0.25
          ? 0
          : q.trailingAnnualDividendYield
            ? Math.round(q.trailingAnnualDividendYield * 1000) / 10 : 0,
        specialDividend:  (q.trailingAnnualDividendYield || 0) > 0.25,
        ma50Dev:          q.fiftyDayAverage > 0
          ? Math.round((price / q.fiftyDayAverage - 1) * 1000) / 10 : null,
        earningsDate:     q.earningsTimestamp
          ? new Date(q.earningsTimestamp * 1000).toISOString().slice(0, 10) : null,
        psr:              q.priceToSalesTrailing12Months > 0
          ? Math.round(q.priceToSalesTrailing12Months * 10) / 10 : null,
        revenueGrowthYoy: fund.revenueGrowthYoy ?? null,
        grossMargin:      fund.grossMargin ?? null,
      };
      row.score = calcScore(row);
      row.islandReversal = isIslandReversal(chartMap[q.symbol] ?? null);
      if (row.islandReversal) row.score = Math.min(100, row.score + 5);
      return row;
    });

    return Response.json({ rows });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
