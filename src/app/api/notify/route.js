import { Resend } from 'resend';
import { getTrendMode } from '../../../lib/trend-analyzer';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const MIN_CAP  = 1_000_000_000;
const MAX_CAP  = 150_000_000_000;
const APP_URL  = 'https://global-high-screener.vercel.app';

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

async function fetchScreenerPage(offset, crumb, cookie) {
  const url  = `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}&lang=en-US&region=US&formatted=false`;
  const body = JSON.stringify({
    offset, size: 250,
    sortField: 'intradaymarketcap', sortType: 'DESC',
    quoteType: 'EQUITY', topOperator: 'AND',
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
      body, signal: ctrl.signal,
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

function fmtCap(v) {
  if (!v) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

export async function GET(req) {
  // Vercel Cron が付与する Bearer トークン、またはテスト用クエリパラメータで認証
  const authHeader = req.headers.get('authorization');
  const testKey = new URL(req.url).searchParams.get('key');
  const validToken = !process.env.CRON_SECRET
    || authHeader === `Bearer ${process.env.CRON_SECRET}`
    || testKey === process.env.CRON_SECRET;
  if (!validToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY || !process.env.NOTIFY_EMAIL) {
    return Response.json({ error: 'RESEND_API_KEY or NOTIFY_EMAIL not set' }, { status: 500 });
  }

  // テスト送信モード
  const isTest = new URL(req.url).searchParams.get('test') === 'true';
  if (isTest) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'US Screener <onboarding@resend.dev>',
      to:   process.env.NOTIFY_EMAIL,
      subject: '🧪 テスト送信 — US 52週高値スキャナー',
      text: 'テスト送信です。このメールが届いていれば通知設定は正常です。\n\nhttps://global-high-screener.vercel.app',
    });
    return Response.json({ sent: true, message: 'Test email sent' });
  }

  try {
    const { crumb, cookie } = await getCrumb();
    const pages = await Promise.all(
      [0, 250, 500, 750].map(offset => fetchScreenerPage(offset, crumb, cookie))
    );
    const quotes = pages.flat();

    const breakouts = quotes
      .filter(q => {
        if (!q.regularMarketPrice || !q.fiftyTwoWeekHigh) return false;
        const cap = q.marketCap || 0;
        if (cap < MIN_CAP || cap > MAX_CAP) return false;
        const volRatio = (q.regularMarketVolume || 0) / (q.averageDailyVolume10Day || 1);
        const mode = getTrendMode({
          price:        q.regularMarketPrice,
          week52High:   q.fiftyTwoWeekHigh,
          volRatio,
          dayChangePct: q.regularMarketChangePercent || 0,
          ma50Dev:      0,
        });
        return mode === 'breakout';
      })
      .map(q => ({
        ticker:    q.symbol,
        name:      q.shortName || q.longName || '',
        price:     q.regularMarketPrice,
        changePct: q.regularMarketChangePercent || 0,
        volRatio:  (q.regularMarketVolume || 0) / (q.averageDailyVolume10Day || 1),
        marketCap: q.marketCap,
      }));

    if (breakouts.length === 0) {
      return Response.json({ sent: false, message: 'No breakouts today' });
    }

    const subject = `🚀 ブレイクアウト検出 (${breakouts.length}件) — ${breakouts.map(b => b.ticker).join(', ')}`;

    const textBody = [
      'US 52週高値スキャナー — ブレイクアウト通知',
      '',
      `検出日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      ...breakouts.map(b => [
        `🚀 ${b.ticker}  ${b.name}`,
        `   価格: $${b.price.toFixed(2)}  前日比: +${b.changePct.toFixed(1)}%`,
        `   出来高: ${b.volRatio.toFixed(1)}x  時価総額: ${fmtCap(b.marketCap)}`,
      ].join('\n')),
      '━━━━━━━━━━━━━━━━━━━━━━',
      '',
      '▶ ウォッチリストを確認する',
      APP_URL,
    ].join('\n');

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'US Screener <onboarding@resend.dev>',
      to:   process.env.NOTIFY_EMAIL,
      subject,
      text: textBody,
    });

    return Response.json({ sent: true, count: breakouts.length, tickers: breakouts.map(b => b.ticker) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
