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

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const tickers = (body.tickers || []).slice(0, 50);
    if (tickers.length === 0) return Response.json({ rows: [] });

    const { crumb, cookie } = await getCrumb();
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${tickers.join(',')}&crumb=${encodeURIComponent(crumb)}`;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie }, signal: ctrl.signal });
    if (!res.ok) return Response.json({ error: 'fetch failed' }, { status: 502 });
    const data = await res.json();
    const quotes = data.quoteResponse?.result || [];

    const rows = quotes.map(q => {
      const price    = q.regularMarketPrice;
      const week52High = q.fiftyTwoWeekHigh;
      const volume   = q.regularMarketVolume || 0;
      const volAvg   = q.averageDailyVolume10Day || 0;
      const row = {
        ticker:       q.symbol,
        price,
        week52High,
        high52Pct:    week52High > 0 ? ((price / week52High - 1) * 100).toFixed(1) : null,
        volume,
        volAvg,
        volRatio:     volAvg > 0 ? Math.round((volume / volAvg) * 10) / 10 : 0,
        dayChangePct: Math.round((q.regularMarketChangePercent || 0) * 100) / 100,
        marketCap:    q.marketCap || 0,
        pe:           q.trailingPE || null,
        dividendYield: q.trailingAnnualDividendYield
          ? Math.round(q.trailingAnnualDividendYield * 1000) / 10 : 0,
        ma50Dev:      q.fiftyDayAverage > 0
          ? Math.round((price / q.fiftyDayAverage - 1) * 1000) / 10 : null,
        earningsDate: q.earningsTimestamp
          ? new Date(q.earningsTimestamp * 1000).toISOString().slice(0, 10) : null,
      };
      row.score = calcScore(row);
      return row;
    });

    return Response.json({ rows });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
