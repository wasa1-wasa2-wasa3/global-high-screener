const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

async function getCrumb() {
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const cookies = (r1.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookies },
  });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length < 3) throw new Error('crumb empty');
  return { crumb, cookie: cookies };
}

export const maxDuration = 30;

export async function POST(request) {
  try {
    const { ticker } = await request.json();
    if (!ticker) return Response.json({ error: 'ticker required' }, { status: 400 });

    const { crumb, cookie } = await getCrumb();
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`
      + `?modules=financialData,majorHoldersBreakdown&crumb=${encodeURIComponent(crumb)}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie }, signal: ctrl.signal });
    clearTimeout(timer);

    if (!res.ok) return Response.json({ error: `fetch failed: ${res.status}` }, { status: 502 });

    const data = await res.json();
    const result = data.quoteSummary?.result?.[0];
    if (!result) return Response.json({ error: 'no data' }, { status: 404 });

    const fd = result.financialData;
    const mh = result.majorHoldersBreakdown;

    // ROE: returnOnEquity.raw is decimal (0.15 = 15%)
    const roe = fd?.returnOnEquity?.raw != null
      ? Math.round(fd.returnOnEquity.raw * 1000) / 10
      : null;

    // debtToEquity.raw is expressed as percentage (50 = 50% D/E)
    const debtToEquity = fd?.debtToEquity?.raw ?? null;

    // 自己資本比率 ≈ 100% / (1 + D/E%)  →  10000 / (100 + debtToEquity)
    const capitalRatio = debtToEquity != null && debtToEquity >= 0
      ? Math.round(10000 / (100 + debtToEquity))
      : null;

    // insidersPercentHeld.raw is decimal (0.15 = 15%)
    const insiderOwnership = mh?.insidersPercentHeld?.raw != null
      ? Math.round(mh.insidersPercentHeld.raw * 1000) / 10
      : null;

    const currentRatio = fd?.currentRatio?.raw ?? null;

    // revenueGrowth.raw は小数 (0.30 = 30%) → % 単位に変換
    const revenueGrowthYoy = fd?.revenueGrowth?.raw != null
      ? Math.round(fd.revenueGrowth.raw * 1000) / 10
      : null;

    // grossMargins.raw は小数 (0.70 = 70%)
    const grossMargin = fd?.grossMargins?.raw != null
      ? Math.round(fd.grossMargins.raw * 1000) / 10
      : null;

    return Response.json({ roe, debtToEquity, capitalRatio, insiderOwnership, currentRatio, revenueGrowthYoy, grossMargin });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
