const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

export async function GET() {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/USDJPY=X?range=1d&interval=5m';
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    const rate = closes?.filter(Boolean)?.at(-1);
    if (!rate) throw new Error('rate not found');
    return Response.json({ rate: Math.round(rate * 100) / 100 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
