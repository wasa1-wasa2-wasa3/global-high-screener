'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import AuthButton from '../../components/AuthButton';
import NavBar from '../../components/NavBar';

const NAVY  = '#0A1628';
const NAVY2 = '#1E3A5F';
const GOLD  = '#C9A84C';
const GOLD2 = '#F0C040';

const PORTFOLIO_KEY = 'us_portfolio_v1';
const LAST_SCAN_KEY = 'us_scan_last_v1';
const LIST_TYPE     = 'us_portfolio';

function navStyle(active) {
  return {
    fontSize: 13, padding: '6px 14px', borderRadius: 7,
    textDecoration: 'none',
    background: active ? '#fff' : 'transparent',
    color: active ? NAVY : '#888',
    fontWeight: active ? 600 : 400,
    boxShadow: active ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
    whiteSpace: 'nowrap',
  };
}

function calcStopPrice(avgCost, atr14Pct, ma50) {
  if (!avgCost) return null;
  if (atr14Pct != null && atr14Pct > 0) {
    const atrStop = avgCost * (1 - 2.5 * atr14Pct / 100);
    return ma50 != null && ma50 > 0 ? Math.max(atrStop, ma50) : atrStop;
  }
  return avgCost * (1 - 15 / 100);
}

function calcTakeProfit(avgCost, atr14Pct, fallbackPct = 20) {
  if (!avgCost) return null;
  if (atr14Pct != null && atr14Pct > 0) {
    return avgCost + 3 * (avgCost * atr14Pct / 100);
  }
  return avgCost * (1 + fallbackPct / 100);
}

function fmtUSD(v) {
  if (v == null) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtJPY(usd, rate) {
  if (!usd || !rate) return '';
  return '≈ ¥' + Math.round(usd * rate).toLocaleString('ja-JP');
}
function yahooUrl(ticker) {
  return `https://finance.yahoo.com/quote/${ticker}`;
}

export default function PortfolioPage() {
  const [items, setItems]             = useState({});
  const [tickerInput, setTickerInput] = useState('');
  const [scanning, setScanning]       = useState(false);
  const [stopLoss, setStopLoss]       = useState(-15);
  const [takeProfit, setTakeProfit]   = useState(20);
  const [usdJpy, setUsdJpy]           = useState(null);
  const [isMobile, setIsMobile]       = useState(false);
  const [copiedTicker, setCopiedTicker] = useState(null);
  const [scrolled, setScrolled]         = useState(false);
  const [breakoutAlerts, setBreakoutAlerts] = useState([]);
  const [entryPopup, setEntryPopup]   = useState(null);
  const [popupShares, setPopupShares] = useState('');
  const [popupCost, setPopupCost]     = useState('');
  const [accountSize, setAccountSize] = useState(() => {
    try { return localStorage.getItem('us_account_size_v1') || ''; } catch { return ''; }
  });
  const [riskPct, setRiskPct] = useState('2');
  const userRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    fetch('/api/fx').then(r => r.json()).then(d => { if (d.rate) setUsdJpy(d.rate); }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PORTFOLIO_KEY);
      if (stored) setItems(JSON.parse(stored));
    } catch {}
    try {
      const scanData = localStorage.getItem(LAST_SCAN_KEY);
      if (scanData) {
        const { rows } = JSON.parse(scanData);
        const alerts = (rows || []).filter(r =>
          (r.volRatio ?? 0) >= 3 &&
          parseFloat(r.high52Pct ?? '-99') >= -1 &&
          (r.dayChangePct ?? 0) > 0
        );
        setBreakoutAlerts(alerts);
      }
    } catch {}
  }, []);

  useEffect(() => {
    async function loadFromDb(uid) {
      const { data } = await supabase.from('watchlist')
        .select('ticker, name, data, saved_at')
        .eq('user_id', uid).eq('list_type', LIST_TYPE);
      const obj = {};
      for (const item of (data || [])) {
        obj[item.ticker] = { ...item.data, ticker: item.ticker, name: item.name, savedAt: new Date(item.saved_at).getTime() };
      }
      setItems(obj);
    }

    async function migrateAndLoad(uid) {
      try {
        const stored = localStorage.getItem(PORTFOLIO_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const rows = Object.entries(parsed).map(([ticker, d]) => {
            const { ticker: _t, name, savedAt, ...data } = d;
            return { user_id: uid, list_type: LIST_TYPE, ticker, name: name ?? null, data, saved_at: savedAt ? new Date(savedAt).toISOString() : new Date().toISOString() };
          });
          if (rows.length) {
            await supabase.from('watchlist').upsert(rows, { onConflict: 'user_id,list_type,ticker', ignoreDuplicates: true });
            localStorage.removeItem(PORTFOLIO_KEY);
          }
        }
      } catch {}
      await loadFromDb(uid);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      userRef.current = u;
      if (u) migrateAndLoad(u.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      const prev = userRef.current;
      userRef.current = u;
      if (u && !prev) migrateAndLoad(u.id);
      else if (!u) {
        try { const stored = localStorage.getItem(PORTFOLIO_KEY); setItems(stored ? JSON.parse(stored) : {}); } catch { setItems({}); }
      }
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  function persistLocal(next) {
    setItems(next);
    if (!userRef.current) try { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(next)); } catch {}
  }

  async function addTicker() {
    const t = tickerInput.trim().toUpperCase();
    if (!t || items[t]) return;
    const entry = { ticker: t, name: null, holdingShares: null, avgCost: null, savedAt: Date.now() };
    const next = { ...items, [t]: entry };
    persistLocal(next);
    setTickerInput('');
    const u = userRef.current;
    if (u) {
      const { ticker, name, savedAt: _s, ...data } = entry;
      await supabase.from('watchlist').upsert(
        { user_id: u.id, list_type: LIST_TYPE, ticker, name, data, saved_at: new Date().toISOString() },
        { onConflict: 'user_id,list_type,ticker' }
      );
    }
  }

  async function removeTicker(ticker) {
    const next = { ...items };
    delete next[ticker];
    persistLocal(next);
    const u = userRef.current;
    if (u) await supabase.from('watchlist').delete().eq('user_id', u.id).eq('list_type', LIST_TYPE).eq('ticker', ticker);
  }

  async function saveEdit(ticker, holdingShares, avgCost) {
    const entry = items[ticker];
    if (!entry) return;
    const updated = { ...entry, holdingShares, avgCost };
    const next = { ...items, [ticker]: updated };
    persistLocal(next);
    const u = userRef.current;
    if (u) {
      const { ticker: _t, name, savedAt: _s, ...data } = updated;
      await supabase.from('watchlist').update({ data }).eq('user_id', u.id).eq('list_type', LIST_TYPE).eq('ticker', ticker);
    }
  }

  async function toggleOtokoKabu(ticker) {
    const entry = items[ticker];
    if (!entry) return;
    const updated = { ...entry, is_otoko_kabu: !entry.is_otoko_kabu };
    const next = { ...items, [ticker]: updated };
    persistLocal(next);
    const u = userRef.current;
    if (u) {
      const { ticker: _t, name, savedAt: _s, ...data } = updated;
      await supabase.from('watchlist').update({ data }).eq('user_id', u.id).eq('list_type', LIST_TYPE).eq('ticker', ticker);
    }
  }

  async function scanAll() {
    const tickers = Object.keys(items);
    if (!tickers.length) return;
    setScanning(true);
    try {
      const res = await fetch('/api/watchlist-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      const data = await res.json();
      const resultsMap = Object.fromEntries((data.rows || []).map(r => [r.ticker, r]));
      const u = userRef.current;
      const next = { ...items };
      for (const [ticker, fresh] of Object.entries(resultsMap)) {
        if (!next[ticker]) continue;
        next[ticker] = { ...next[ticker], ...fresh };
        if (u) {
          const { ticker: _t, name, savedAt: _s, ...rowData } = next[ticker];
          await supabase.from('watchlist').upsert(
            { user_id: u.id, list_type: LIST_TYPE, ticker, name: fresh.name ?? next[ticker].name ?? null, data: rowData },
            { onConflict: 'user_id,list_type,ticker' }
          );
        }
      }
      setItems(next);
      if (!u) try { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(next)); } catch {}
    } catch {}
    setScanning(false);
  }

  function openEntryPopup(item) {
    setEntryPopup(item);
    setPopupShares('');
    setPopupCost(item.price != null ? String(item.price) : '');
  }

  async function addFromBreakout(item, holdingShares, avgCost) {
    const t = item.ticker;
    if (items[t]) return;
    const entry = {
      ticker: t,
      name: item.name ?? null,
      holdingShares: holdingShares || null,
      avgCost: avgCost || null,
      price: item.price ?? null,
      week52High: item.week52High ?? null,
      high52Pct: item.high52Pct ?? null,
      volRatio: item.volRatio ?? null,
      dayChangePct: item.dayChangePct ?? null,
      marketCap: item.marketCap ?? null,
      score: item.score ?? null,
      savedAt: Date.now(),
    };
    const next = { ...items, [t]: entry };
    persistLocal(next);
    setEntryPopup(null);
    const u = userRef.current;
    if (u) {
      const { ticker, name, savedAt: _s, ...data } = entry;
      await supabase.from('watchlist').upsert(
        { user_id: u.id, list_type: LIST_TYPE, ticker, name, data, saved_at: new Date().toISOString() },
        { onConflict: 'user_id,list_type,ticker' }
      );
    }
  }

  function copyStopOrder(ticker, shares, stopPrice, isOtokoKabu) {
    const priceStr = isOtokoKabu ? 'OTOKO-KABU (no stop)' : fmtUSD(stopPrice);
    navigator.clipboard.writeText(`${ticker} / ${shares} shares / Stop @ ${priceStr}`).catch(() => {});
    setCopiedTicker(ticker);
    setTimeout(() => setCopiedTicker(t => t === ticker ? null : t), 2000);
  }

  const itemList = Object.values(items).sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
  const totalCostUSD  = itemList.reduce((s, r) => s + (r.holdingShares != null && r.avgCost != null ? r.holdingShares * r.avgCost : 0), 0);
  const totalValueUSD = itemList.reduce((s, r) => s + (r.holdingShares != null && r.price != null ? r.holdingShares * r.price : 0), 0);
  const totalPnlUSD   = totalValueUSD - totalCostUSD;
  const otokoKabuCount = itemList.filter(r => r.is_otoko_kabu).length;
  const otokoKabuValueUSD = itemList
    .filter(r => r.is_otoko_kabu && r.holdingShares != null && r.price != null)
    .reduce((s, r) => s + r.holdingShares * r.price, 0);

  const todayActions = (() => {
    const scanned = itemList.filter(r => r.price != null);
    if (!scanned.length) return [];
    const actions = [];
    const withPnl = scanned
      .filter(r => !r.is_otoko_kabu && r.avgCost != null)
      .map(r => ({ ...r, pnlPct: (r.price / r.avgCost - 1) * 100 }));
    withPnl.filter(r => {
      const sp = calcStopPrice(r.avgCost, r.atr14Pct, r.ma50);
      return sp != null ? r.price <= sp : r.pnlPct <= -15;
    }).sort((a, b) => a.pnlPct - b.pnlPct)
      .forEach(t => actions.push({ icon: '🚨', color: '#DC2626', border: '#FCA5A5', bg: 'linear-gradient(135deg,#FEF2F2,#FEE2E2)',
        msg: `${t.ticker} が ${t.pnlPct.toFixed(1)}%。損切り実行を検討してください。` }));
    withPnl.filter(r => {
      if (!r.earningsDate) return false;
      const daysTo = (new Date(r.earningsDate) - Date.now()) / 86400000;
      return daysTo >= 0 && daysTo < 3 && r.pnlPct > 0 && !r.is_otoko_kabu;
    }).sort((a, b) => {
      const dA = (new Date(a.earningsDate) - Date.now()) / 86400000;
      const dB = (new Date(b.earningsDate) - Date.now()) / 86400000;
      return dA - dB;
    }).forEach(t => {
      const daysTo = Math.ceil((new Date(t.earningsDate) - Date.now()) / 86400000);
      actions.push({
        icon: '⏳', color: '#92400E', border: '#FDE68A',
        bg: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)',
        msg: `${t.ticker} 決算${daysTo}日前。含み益 +${t.pnlPct.toFixed(1)}%。建値ストップへの引き上げを確認してください。`,
      });
    });
    withPnl.filter(r => {
      const tp = calcTakeProfit(r.avgCost, r.atr14Pct);
      return tp != null && r.price != null && r.price >= tp && !r.is_otoko_kabu
        && r.ma50 != null && r.price < r.ma50 && (r.volRatio ?? 0) >= 1.5;
    }).sort((a, b) => b.pnlPct - a.pnlPct)
      .forEach(t => actions.push({ icon: '💰', color: '#065F46', border: '#6EE7B7', bg: 'linear-gradient(135deg,#ECFDF5,#D1FAE5)',
        msg: `${t.ticker} が +${t.pnlPct.toFixed(0)}%。MA50割れ、利益を確定してください。` }));
    withPnl.filter(r => {
      const tp = calcTakeProfit(r.avgCost, r.atr14Pct);
      return tp != null && r.price != null && r.price >= tp && !r.is_otoko_kabu
        && !(r.ma50 != null && r.price < r.ma50 && (r.volRatio ?? 0) >= 1.5);
    }).sort((a, b) => b.pnlPct - a.pnlPct)
      .forEach(t => actions.push({ icon: '🛡️', color: '#1D4ED8', border: '#93C5FD', bg: 'linear-gradient(135deg,#EFF6FF,#DBEAFE)',
        msg: `${t.ticker} が +${t.pnlPct.toFixed(0)}%。ストップを建値 ${fmtUSD(t.avgCost)} に引き上げてください。` }));
    const pipeline = scanned.filter(r => !r.is_otoko_kabu && r.avgCost != null)
      .map(r => ({ ...r, pnlPct: (r.price / r.avgCost - 1) * 100 }))
      .filter(r => (r.volRatio ?? 0) > 2.0 && (r.dayChangePct ?? 0) > 3.0);
    pipeline.forEach(t => actions.push({ icon: '🔥', color: '#15803D', border: '#86EFAC', bg: 'linear-gradient(135deg,#ECFDF5,#D1FAE5)',
      msg: `${t.ticker} が出来高 ${t.volRatio?.toFixed(1)}x・前日比 +${t.dayChangePct?.toFixed(1)}%。買い増しを検討してください。` }));
    if (otokoKabuCount) actions.push({ icon: '💰', color: '#92400E', border: '#F59E0B', bg: 'linear-gradient(135deg,#FEF9C3,#FFFDE7)',
      msg: `恩株 ${otokoKabuCount}銘柄（総額 ${fmtUSD(otokoKabuValueUSD)}）がリスクフリーで育っています。引き続きホールドしましょう。` });
    return actions;
  })();

  return (
    <main className="tb-main" style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 1rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', overflowX: 'hidden' }}>

      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: '#0F172A', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', gap: 8, marginBottom: '1.5rem', marginLeft: '-1rem', marginRight: '-1rem', width: 'calc(100% + 2rem)' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>📊 ポートフォリオ</span>
        <nav style={{ display: 'flex', gap: 2, overflowX: 'auto', flexShrink: 1, minWidth: 0 }}>
          {[
            { href: '/',          label: 'USスキャン', active: false },
            { href: '/portfolio', label: 'PF',         active: true  },
            { href: '/guide',     label: 'ガイド',     active: false },
          ].map(({ href, label, active }) => (
            <a key={href} href={href} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap', background: active ? 'rgba(255,255,255,0.12)' : 'transparent', color: active ? '#fff' : '#94A3B8', fontWeight: active ? 600 : 400 }}>{label}</a>
          ))}
          <a href="https://new-high-screener.vercel.app" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, textDecoration: 'none', background: '#1D4ED8', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 4 }}>🗾 JP ↗</a>
        </nav>
        <AuthButton />
      </div>

      {/* Breakout alert banner */}
      {breakoutAlerts.length > 0 && (
        <div style={{ marginBottom: 14, padding: '14px 16px', background: 'linear-gradient(135deg,#0A1628,#1E3A5F)', border: `2px solid ${GOLD}`, borderRadius: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: GOLD, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            🚨 ブレイクアウト発生 — 最新スキャンより
            <span style={{ fontSize: 11, fontWeight: 500, color: '#C9A84C', background: 'rgba(201,168,76,0.15)', padding: '1px 8px', borderRadius: 10, border: `1px solid ${GOLD}` }}>
              {breakoutAlerts.length}件
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {breakoutAlerts.map(item => {
              const alreadyIn = !!items[item.ticker];
              const pct52 = parseFloat(item.high52Pct ?? '0');
              return (
                <button key={item.ticker}
                  onClick={() => !alreadyIn && openEntryPopup(item)}
                  style={{
                    padding: '7px 14px', borderRadius: 8, border: 'none', cursor: alreadyIn ? 'default' : 'pointer',
                    background: alreadyIn ? 'rgba(255,255,255,0.08)' : `linear-gradient(135deg,${GOLD},${GOLD2})`,
                    color: alreadyIn ? '#64748B' : NAVY,
                    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
                  }}>
                  {item.ticker}
                  <span style={{ marginLeft: 5, fontWeight: 400 }}>
                    {item.name?.slice(0, 10)}
                  </span>
                  <span style={{ marginLeft: 6, opacity: 0.85 }}>
                    🔥{item.volRatio?.toFixed(1)}x
                  </span>
                  <span style={{ marginLeft: 4, opacity: 0.85 }}>
                    {pct52 >= 0 ? '+' : ''}{pct52.toFixed(1)}%
                  </span>
                  {alreadyIn
                    ? <span style={{ marginLeft: 6, fontSize: 11 }}>✓ 保有中</span>
                    : <span style={{ marginLeft: 6, fontSize: 11 }}>→ エントリー</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Entry popup */}
      {entryPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', maxWidth: 380, width: '100%', boxShadow: '0 12px 50px rgba(0,0,0,0.3)' }}>
            <div style={{ background: NAVY, padding: '18px 22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, color: GOLD, fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>BREAKOUT ENTRY</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{entryPopup.ticker}</div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{entryPopup.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: GOLD }}>{fmtUSD(entryPopup.price)}</div>
                <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                  🔥 出来高 {entryPopup.volRatio?.toFixed(1)}x ·
                  52W {parseFloat(entryPopup.high52Pct ?? '0') >= 0 ? '+' : ''}{parseFloat(entryPopup.high52Pct ?? '0').toFixed(1)}%
                </div>
              </div>
            </div>
            <div style={{ padding: '20px 22px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                <label style={{ fontSize: 12, color: '#64748B' }}>保有数量（株）
                  <input type="number" min="0" value={popupShares} onChange={e => setPopupShares(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 15, boxSizing: 'border-box' }} />
                </label>
                <label style={{ fontSize: 12, color: '#64748B' }}>取得単価 (USD)
                  <input type="number" min="0" step="0.01" value={popupCost} onChange={e => setPopupCost(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 15, boxSizing: 'border-box' }} />
                </label>
                <label style={{ fontSize: 12, color: '#64748B' }}>口座残高 (USD)
                  <input type="number" min="0" value={accountSize}
                    onChange={e => { setAccountSize(e.target.value); try { localStorage.setItem('us_account_size_v1', e.target.value); } catch {} }}
                    placeholder="例: 10000"
                    style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 15, boxSizing: 'border-box' }} />
                </label>
                <label style={{ fontSize: 12, color: '#64748B', marginTop: 8, display: 'block' }}>リスク許容率 (%)
                  <input type="number" min="0.1" max="10" step="0.1" value={riskPct}
                    onChange={e => setRiskPct(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 5, padding: '10px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 15, boxSizing: 'border-box' }} />
                </label>
              </div>
              <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#64748B' }}>
                <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>エントリー後の損切り・回収ライン（目安）</div>
                {popupCost ? (
                  <>
                    <div>損切り <strong style={{ color: '#DC2626' }}>{fmtUSD(calcStopPrice(Number(popupCost), entryPopup?.atr14Pct, entryPopup?.ma50))}</strong></div>
                    <div>利確目安 <strong style={{ color: '#059669' }}>{fmtUSD(calcTakeProfit(Number(popupCost), entryPopup?.atr14Pct))}</strong> <span style={{ color: '#94A3B8' }}>(3×ATR)</span></div>
                    {(() => {
                      const cost = Number(popupCost);
                      const acct = Number(accountSize);
                      const rpct = Number(riskPct);
                      if (!cost || !acct || !rpct) return null;
                      const sp = calcStopPrice(cost, entryPopup?.atr14Pct, entryPopup?.ma50);
                      const riskPerShare = sp != null ? cost - sp : cost * 0.15;
                      if (riskPerShare <= 0) return null;
                      const suggestedShares = Math.floor(acct * rpct / 100 / riskPerShare);
                      return (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #E2E8F0' }}>
                          推奨株数 <strong style={{ color: '#1D4ED8', fontSize: 16 }}>{suggestedShares} 株</strong>
                          <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 4 }}>
                            ({fmtUSD(acct)} × {rpct}% ÷ {fmtUSD(riskPerShare)}/株)
                          </span>
                        </div>
                      );
                    })()}
                  </>
                ) : <span>取得単価を入力すると表示されます</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEntryPopup(null)}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#64748B' }}>
                  キャンセル
                </button>
                <button onClick={() => addFromBreakout(entryPopup, Number(popupShares) || null, Number(popupCost) || null)}
                  style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${GOLD},${GOLD2})`, color: NAVY, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  ⚡ エントリー確定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Today's action banners */}
      {todayActions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {todayActions.map((a, i) => (
            <div key={i} style={{ padding: '13px 18px', background: a.bg, border: `1.5px solid ${a.border}`, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{a.icon}</span>
              <div style={{ fontSize: 14, fontWeight: 700, color: a.color, lineHeight: 1.5 }}>{a.msg}</div>
            </div>
          ))}
        </div>
      )}

      {/* Hero */}
      <div style={{ background: `linear-gradient(160deg,${NAVY} 0%,${NAVY2} 100%)`, borderRadius: 16, padding: isMobile ? '20px 18px' : '24px 28px', marginBottom: 20, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: 'rgba(201,168,76,0.1)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, position: 'relative' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, color: GOLD, fontWeight: 700, marginBottom: 4 }}>PORTFOLIO</div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 24, fontWeight: 700 }}>US株ポートフォリオ</h1>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>ティッカーを登録して損益・シグナルを一括管理</p>
          </div>
          {totalCostUSD > 0 && (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>評価額</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{fmtUSD(totalValueUSD)}</div>
                {usdJpy && <div style={{ fontSize: 11, color: '#64748B' }}>{fmtJPY(totalValueUSD, usdJpy)}</div>}
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>含み損益</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: totalPnlUSD >= 0 ? '#34D399' : '#F87171' }}>
                  {totalPnlUSD >= 0 ? '+' : ''}{fmtUSD(totalPnlUSD)}
                </div>
              </div>
              {otokoKabuCount > 0 && (
                <div>
                  <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>恩株総額</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: GOLD }}>{fmtUSD(otokoKabuValueUSD)}</div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>{otokoKabuCount}銘柄 Risk Free</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          ref={inputRef}
          type="text"
          value={tickerInput}
          onChange={e => setTickerInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && addTicker()}
          placeholder="ティッカー (例: NVDA)"
          style={{ fontSize: 14, padding: '9px 14px', borderRadius: 8, border: '1px solid #E2E8F0', minWidth: 180, minHeight: 44 }}
        />
        <button onClick={addTicker} disabled={!tickerInput.trim()}
          style={{ padding: '9px 20px', borderRadius: 8, border: 'none', minHeight: 44,
            background: tickerInput.trim() ? `linear-gradient(135deg,${GOLD},${GOLD2})` : '#E2E8F0',
            color: tickerInput.trim() ? NAVY : '#94A3B8', fontWeight: 700,
            cursor: tickerInput.trim() ? 'pointer' : 'not-allowed' }}>
          ＋ 追加
        </button>
        <label style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          損切り
          <input type="number" value={stopLoss} onChange={e => setStopLoss(Number(e.target.value))}
            style={{ width: 52, fontSize: 13, padding: '4px 6px', borderRadius: 6, border: '1px solid #E2E8F0', textAlign: 'right' }} />
          %
        </label>
        <label style={{ fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          利確
          <input type="number" value={takeProfit} onChange={e => setTakeProfit(Number(e.target.value))}
            style={{ width: 52, fontSize: 13, padding: '4px 6px', borderRadius: 6, border: '1px solid #E2E8F0', textAlign: 'right' }} />
          %
        </label>
        <button onClick={scanAll} disabled={scanning || !itemList.length}
          style={{ padding: '9px 20px', borderRadius: 8, border: 'none', minHeight: 44,
            background: scanning || !itemList.length ? '#E2E8F0' : NAVY,
            color: scanning || !itemList.length ? '#94A3B8' : '#fff',
            fontWeight: 700, cursor: scanning || !itemList.length ? 'not-allowed' : 'pointer' }}>
          {scanning ? '⏳ 取得中...' : '🔄 価格更新'}
        </button>
      </div>

      {/* Empty state */}
      {itemList.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94A3B8', border: '1px solid #E2E8F0', borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <p style={{ fontSize: 14 }}>ティッカーを入力して「＋ 追加」→「🔄 価格更新」を押してください</p>
          <p style={{ fontSize: 12, color: '#CBD5E1', marginTop: 4 }}>例: NVDA, AAPL, MSFT, TSLA</p>
        </div>
      ) : isMobile ? (

        /* ===== Mobile cards ===== */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {itemList.map(r => {
            const price = r.price;
            const holdingShares = r.holdingShares ?? null;
            const avgCost = r.avgCost ?? null;
            const pnlPct = (avgCost && price) ? (price / avgCost - 1) * 100 : null;
            const pnlUSD = (holdingShares != null && avgCost != null && price) ? (price - avgCost) * holdingShares : null;
            const costBasis = (holdingShares != null && avgCost != null) ? holdingShares * avgCost : null;
            const sharesToSell = (costBasis != null && price) ? Math.ceil(costBasis / price) : null;
            const stopPrice = calcStopPrice(avgCost, r.atr14Pct, r.ma50);
            const takeProfitPrice = calcTakeProfit(avgCost, r.atr14Pct);
            const showBreakeven  = !r.is_otoko_kabu && pnlPct != null && price != null && takeProfitPrice != null && price >= takeProfitPrice;
            const showProfitExit = !r.is_otoko_kabu
              && pnlPct != null && pnlPct > 0
              && r.price != null && r.ma50 != null && r.price < r.ma50
              && (r.volRatio ?? 0) >= 1.5;
            const isCopied = copiedTicker === r.ticker;

            let cardBg = '#fff', cardBorder = '1px solid #E2E8F0';
            if (r.is_otoko_kabu) { cardBg = '#FFFBEB'; cardBorder = '1px solid #F59E0B'; }
            else if (pnlPct != null) {
              const isStopTriggered = stopPrice != null ? r.price <= stopPrice : pnlPct <= -15;
              if (isStopTriggered) { cardBg = '#FEF2F2'; cardBorder = '1px solid #FCA5A5'; }
              else if (pnlPct >= takeProfit) { cardBg = '#F0FDF4'; cardBorder = '1px solid #86EFAC'; }
            }

            const actionBadge = (() => {
              if (r.is_otoko_kabu)   return { icon: '💰', label: '元本回収済・ガチホ',      color: '#92400E', bg: '#FEF9C3', border: '#F59E0B' };
              if (pnlPct == null)    return null;
              const isStopTriggered = stopPrice != null ? r.price <= stopPrice : pnlPct <= -15;
              if (isStopTriggered)   return { icon: '🚨', label: '損切り実行',              color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5' };
              if (showProfitExit)    return { icon: '💰', label: '利確実行',                color: '#065F46', bg: '#DCFCE7', border: '#6EE7B7' };
              if (showBreakeven)     return { icon: '🛡️', label: 'ストップを建値に引き上げ', color: '#1D4ED8', bg: '#EFF6FF', border: '#93C5FD' };
              if ((r.volRatio ?? 0) > 2.0 && (r.dayChangePct ?? 0) > 3.0)
                                     return { icon: '🔥', label: '買い増し',                color: '#15803D', bg: '#DCFCE7', border: '#86EFAC' };
              if (pnlPct > 0)        return { icon: '🟢', label: 'ガチホ継続',              color: '#15803D', bg: '#F0FDF4', border: '#86EFAC' };
              return                        { icon: '🟡', label: '調整中・様子見',          color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
            })();

            return (
              <div key={r.ticker} style={{ borderRadius: 14, border: cardBorder, overflow: 'hidden', background: cardBg }}>
                <div style={{ background: NAVY, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <a href={yahooUrl(r.ticker)} target="_blank" rel="noopener noreferrer"
                        style={{ color: GOLD, fontWeight: 700, fontSize: 20, textDecoration: 'none' }}>{r.ticker}</a>
                      {actionBadge && (
                        <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: actionBadge.bg, color: actionBadge.color, fontWeight: 700, border: `1px solid ${actionBadge.border}`, whiteSpace: 'nowrap' }}>
                          {actionBadge.icon} {actionBadge.label}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#94A3B8' }}>{r.name?.slice(0, 28) || '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {pnlPct != null ? (
                      <div style={{ fontSize: 24, fontWeight: 900, color: pnlPct >= 0 ? '#34D399' : '#F87171', lineHeight: 1 }}>
                        {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                      </div>
                    ) : <div style={{ fontSize: 13, color: '#475569' }}>—</div>}
                    {pnlUSD != null && (
                      <div style={{ fontSize: 13, color: pnlUSD >= 0 ? '#34D399' : '#F87171', marginTop: 2, fontWeight: 600 }}>
                        {pnlUSD >= 0 ? '+' : ''}{fmtUSD(pnlUSD)}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ padding: '12px 14px' }}>
                  {showProfitExit && (
                    <div style={{ background: '#ECFDF5', border: '2px solid #059669', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#065F46' }}>💰 利確実行タイミング！</div>
                      <div style={{ fontSize: 13, color: '#065F46', fontWeight: 600, marginTop: 2 }}>
                        MA50割れ × 出来高{r.volRatio?.toFixed(1)}x — 利益確定を検討してください
                      </div>
                    </div>
                  )}
                  {showBreakeven && !showProfitExit && (
                    <div style={{ background: '#EFF6FF', border: '2px solid #3B82F6', borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#1D4ED8' }}>🛡️ 逆指値を建値に引き上げ</div>
                      <div style={{ fontSize: 13, color: '#1E40AF', fontWeight: 600, marginTop: 2 }}>
                        +{pnlPct?.toFixed(0)}% 到達 — 逆指値を取得単価 {fmtUSD(avgCost)} に引き上げてください
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    {[
                      { label: '現在値', value: price ? fmtUSD(price) : '—', sub: usdJpy && price ? fmtJPY(price, usdJpy) : null },
                      { label: '前日比', value: r.dayChangePct != null ? `${r.dayChangePct >= 0 ? '+' : ''}${r.dayChangePct.toFixed(2)}%` : '—',
                        color: r.dayChangePct >= 0 ? '#059669' : '#DC2626' },
                    ].map(cell => (
                      <div key={cell.label} style={{ background: '#F8FAFC', borderRadius: 8, padding: '7px 10px' }}>
                        <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>{cell.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: cell.color || NAVY }}>{cell.value}</div>
                        {cell.sub && <div style={{ fontSize: 10, color: '#64748B' }}>{cell.sub}</div>}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: '#64748B', display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                      保有数量（株）
                      <input type="number" defaultValue={holdingShares ?? ''} placeholder="0" min="0"
                        onBlur={e => saveEdit(r.ticker, e.target.value === '' ? null : Number(e.target.value), r.avgCost ?? null)}
                        style={{ fontSize: 16, padding: '8px', borderRadius: 7, border: '1px solid #E2E8F0', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
                    </label>
                    <label style={{ fontSize: 11, color: '#64748B', display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                      取得単価 (USD)
                      <input type="number" defaultValue={avgCost ?? ''} placeholder="0.00" min="0" step="0.01"
                        onBlur={e => saveEdit(r.ticker, r.holdingShares ?? null, e.target.value === '' ? null : Number(e.target.value))}
                        style={{ fontSize: 16, padding: '8px', borderRadius: 7, border: '1px solid #E2E8F0', textAlign: 'right', width: '100%', boxSizing: 'border-box' }} />
                    </label>
                  </div>

                  {avgCost != null && (
                    <div style={{ background: NAVY, borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{ padding: '6px 12px', fontSize: 10, color: '#93C5FD', fontWeight: 700, letterSpacing: 0.5 }}>
                        📋 発注情報
                      </div>
                      <div style={{ display: 'flex', padding: '6px 12px 10px', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>損切り価格</div>
                          {r.is_otoko_kabu
                            ? <div style={{ fontSize: 16, fontWeight: 700, color: '#475569' }}>─ 恩株</div>
                            : <div style={{ fontSize: 19, fontWeight: 900, color: '#F87171' }}>{fmtUSD(stopPrice)}</div>}
                          {!r.is_otoko_kabu && (
                            <div style={{ fontSize: 9, color: '#64748B' }}>
                              {r.atr14Pct != null ? `2.5×ATR (${r.atr14Pct.toFixed(1)}%)` : 'Fallback -15%'}
                            </div>
                          )}
                        </div>
                        <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>利確目安 (3×ATR)</div>
                          <div style={{ fontSize: 19, fontWeight: 900, color: '#34D399' }}>{fmtUSD(takeProfitPrice)}</div>
                          <div style={{ fontSize: 9, color: '#64748B' }}>{r.atr14Pct != null ? `3×ATR (${r.atr14Pct.toFixed(1)}%)` : 'Fallback +20%'}</div>
                        </div>
                      </div>
                      {holdingShares != null && (
                        <div style={{ padding: '0 12px 10px' }}>
                          <button onClick={() => copyStopOrder(r.ticker, holdingShares, stopPrice, r.is_otoko_kabu)}
                            style={{ width: '100%', minHeight: 40, borderRadius: 8, border: 'none', background: isCopied ? '#059669' : 'rgba(255,255,255,0.15)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                            {isCopied ? '✓ コピー済み' : `📋 ${r.ticker} / ${holdingShares}株 / Stop ${r.is_otoko_kabu ? '─' : fmtUSD(stopPrice)}`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    {r.is_otoko_kabu ? (
                      <>
                        <div style={{ flex: 1, textAlign: 'center', padding: '11px', borderRadius: 8, background: 'linear-gradient(135deg,#FEF9C3,#FDE68A)', color: '#92400E', fontWeight: 800, fontSize: 13, border: '1px solid #F59E0B' }}>
                          💰 恩株 Risk Free
                        </div>
                        <button onClick={() => toggleOtokoKabu(r.ticker)}
                          style={{ minHeight: 42, padding: '0 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#94A3B8', cursor: 'pointer', fontSize: 12 }}>解除</button>
                      </>
                    ) : showBreakeven ? (
                      <button onClick={() => toggleOtokoKabu(r.ticker)}
                        style={{ flex: 1, minHeight: 46, borderRadius: 10, border: 'none', background: '#F59E0B', color: '#fff', cursor: 'pointer', fontWeight: 800, fontSize: 15 }}>
                        ✨ 恩株化する
                      </button>
                    ) : holdingShares != null && avgCost != null ? (
                      <button onClick={() => toggleOtokoKabu(r.ticker)}
                        style={{ minHeight: 40, padding: '0 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#CBD5E1', cursor: 'pointer', fontSize: 12 }}>
                        恩株化
                      </button>
                    ) : null}
                    <button onClick={() => removeTicker(r.ticker)}
                      style={{ minHeight: 40, padding: '0 14px', borderRadius: 8, border: '1px solid #FEE2E2', background: '#fff', color: '#FCA5A5', cursor: 'pointer', fontSize: 14, marginLeft: 'auto' }}>
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      ) : (

        /* ===== Desktop table ===== */
        <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: NAVY }}>
                {['', 'ティッカー', '現在値 (USD)', '前日比', '損益%', '損益 (USD)', '保有数量', '取得単価', '損切り価格', '利確目安 (3×ATR)', '52W高値比', '恩株管理'].map(h => (
                  <th key={h} style={{ padding: '10px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemList.map((r, i) => {
                const price = r.price;
                const holdingShares = r.holdingShares ?? null;
                const avgCost = r.avgCost ?? null;
                const pnlPct = (avgCost && price) ? (price / avgCost - 1) * 100 : null;
                const pnlUSD = (holdingShares != null && avgCost != null && price) ? (price - avgCost) * holdingShares : null;
                const costBasis = (holdingShares != null && avgCost != null) ? holdingShares * avgCost : null;
                const stopPrice = calcStopPrice(avgCost, r.atr14Pct, r.ma50);
                const takeProfitPrice = calcTakeProfit(avgCost, r.atr14Pct);
                const showBreakeven  = !r.is_otoko_kabu && pnlPct != null && price != null && takeProfitPrice != null && price >= takeProfitPrice;
                const showProfitExit = !r.is_otoko_kabu
                  && pnlPct != null && pnlPct > 0
                  && r.price != null && r.ma50 != null && r.price < r.ma50
                  && (r.volRatio ?? 0) >= 1.5;
                const pct52 = r.high52Pct != null ? parseFloat(r.high52Pct) : null;

                let rowBg = i % 2 === 0 ? '#F8FAFC' : '#fff';
                if (r.is_otoko_kabu) rowBg = '#FFFBEB';
                else if (pnlPct != null) {
                  const isStopTriggered = stopPrice != null ? r.price <= stopPrice : pnlPct <= -15;
                  if (isStopTriggered) rowBg = '#FEF2F2';
                  else if (pnlPct >= takeProfit) rowBg = '#F0FDF4';
                }

                const actionBadge = (() => {
                  if (r.is_otoko_kabu)   return { icon: '💰', label: '元本回収済・ガチホ',      color: '#92400E', bg: '#FEF9C3', border: '#F59E0B' };
                  if (pnlPct == null)    return null;
                  const isStopTriggered = stopPrice != null ? r.price <= stopPrice : pnlPct <= -15;
                  if (isStopTriggered)   return { icon: '🚨', label: '損切り実行',              color: '#DC2626', bg: '#FEF2F2', border: '#FCA5A5' };
                  if (showProfitExit)    return { icon: '💰', label: '利確実行',                color: '#065F46', bg: '#DCFCE7', border: '#6EE7B7' };
                  if (showBreakeven)     return { icon: '🛡️', label: 'ストップを建値に引き上げ', color: '#1D4ED8', bg: '#EFF6FF', border: '#93C5FD' };
                  if ((r.volRatio ?? 0) > 2.0 && (r.dayChangePct ?? 0) > 3.0)
                                         return { icon: '🔥', label: '買い増し',                color: '#15803D', bg: '#DCFCE7', border: '#86EFAC' };
                  if (pnlPct > 0)        return { icon: '🟢', label: 'ガチホ継続',              color: '#15803D', bg: '#F0FDF4', border: '#86EFAC' };
                  return                        { icon: '🟡', label: '調整中・様子見',          color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
                })();

                const isCopied = copiedTicker === r.ticker;

                return (
                  <tr key={r.ticker} style={{ borderBottom: '1px solid #F1F5F9', background: rowBg }}>
                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                      <button onClick={() => removeTicker(r.ticker)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#CBD5E1', padding: 0 }}>✕</button>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <a href={yahooUrl(r.ticker)} target="_blank" rel="noopener noreferrer"
                        style={{ color: NAVY, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>{r.ticker}</a>
                      <div style={{ fontSize: 11, color: '#64748B' }}>{r.name?.slice(0, 22) || '—'}</div>
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                      {price ? fmtUSD(price) : '—'}
                      {usdJpy && price && <div style={{ fontSize: 10, color: '#94A3B8' }}>{fmtJPY(price, usdJpy)}</div>}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: (r.dayChangePct ?? 0) >= 0 ? '#059669' : '#DC2626' }}>
                      {r.dayChangePct != null ? `${r.dayChangePct >= 0 ? '+' : ''}${r.dayChangePct.toFixed(2)}%` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: pnlPct == null ? '#94A3B8' : pnlPct >= 0 ? '#059669' : '#DC2626' }}>
                      {pnlPct == null ? '—' : `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`}
                    </td>
                    <td style={{ padding: '8px 10px', color: pnlUSD == null ? '#94A3B8' : pnlUSD >= 0 ? '#059669' : '#DC2626' }}>
                      {pnlUSD == null ? '—' : `${pnlUSD >= 0 ? '+' : ''}${fmtUSD(pnlUSD)}`}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input type="number" defaultValue={holdingShares ?? ''} placeholder="保有数" min="0"
                        onBlur={e => saveEdit(r.ticker, e.target.value === '' ? null : Number(e.target.value), r.avgCost ?? null)}
                        style={{ width: 70, fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #E2E8F0', textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input type="number" defaultValue={avgCost ?? ''} placeholder="USD" min="0" step="0.01"
                        onBlur={e => saveEdit(r.ticker, r.holdingShares ?? null, e.target.value === '' ? null : Number(e.target.value))}
                        style={{ width: 80, fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #E2E8F0', textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {r.is_otoko_kabu
                        ? <span style={{ color: '#94A3B8' }}>─</span>
                        : stopPrice ? (
                          <>
                            <span style={{ color: '#DC2626' }}>{fmtUSD(stopPrice)}</span>
                            <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 1 }}>
                              {r.atr14Pct != null ? `2.5×ATR (${r.atr14Pct.toFixed(1)}%)` : 'Fallback -15%'}
                            </div>
                          </>
                        ) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#059669', whiteSpace: 'nowrap' }}>
                      {takeProfitPrice ? fmtUSD(takeProfitPrice) : '—'}
                      {showBreakeven && (
                        <div style={{ fontSize: 10, color: '#1D4ED8', fontWeight: 600, marginTop: 2 }}>🛡️ 建値に引上げ</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {pct52 != null ? (
                        <span style={{
                          background: pct52 >= 0 ? '#FEF3C7' : pct52 >= -3 ? '#ECFDF5' : '#F8FAFC',
                          color: pct52 >= 0 ? '#92400E' : pct52 >= -3 ? '#065F46' : '#64748B',
                          padding: '2px 7px', borderRadius: 6, fontSize: 12, fontWeight: 700
                        }}>
                          {pct52 >= 0 ? '+' : ''}{pct52.toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', minWidth: 140 }}>
                      {actionBadge && (
                        <div style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: actionBadge.bg, color: actionBadge.color, border: `1px solid ${actionBadge.border}`, marginBottom: 5, textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {actionBadge.icon} {actionBadge.label}
                        </div>
                      )}
                      {r.is_otoko_kabu ? (
                        <button onClick={() => toggleOtokoKabu(r.ticker)}
                          style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#94A3B8', cursor: 'pointer', display: 'block', width: '100%', marginBottom: 3 }}>恩株解除</button>
                      ) : showBreakeven ? (
                        <button onClick={() => toggleOtokoKabu(r.ticker)}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: 'none', background: '#F59E0B', color: '#fff', cursor: 'pointer', fontWeight: 600, width: '100%', marginBottom: 3 }}>
                          ✨ 恩株化する
                        </button>
                      ) : holdingShares != null && avgCost != null ? (
                        <button onClick={() => toggleOtokoKabu(r.ticker)}
                          style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#CBD5E1', cursor: 'pointer' }}>
                          恩株化
                        </button>
                      ) : null}
                      {holdingShares != null && avgCost != null && (
                        <button onClick={() => copyStopOrder(r.ticker, holdingShares, stopPrice, r.is_otoko_kabu)}
                          style={{ marginTop: 4, fontSize: 10, padding: '2px 6px', borderRadius: 4, border: 'none', background: isCopied ? '#059669' : NAVY, color: '#fff', cursor: 'pointer', fontWeight: 600, display: 'block', width: '100%' }}>
                          {isCopied ? '✓ コピー済み' : '📋 発注コピー'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action badge legend */}
      {itemList.length > 0 && (
        <details style={{ marginTop: 20 }}>
          <summary style={{ fontSize: 12, color: '#94A3B8', cursor: 'pointer', userSelect: 'none' }}>アクションバッジの凡例</summary>
          <div style={{ marginTop: 10, border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', fontSize: 12 }}>
            {[
              { icon: '🔥', label: '買い増し',              desc: '出来高2x超 × 前日比+3%超 — ブレイクアウト発生中。ポジション拡大を検討。' },
              { icon: '🛡️', label: 'ストップを建値に引き上げ', desc: `+${takeProfit}%到達。逆指値を取得単価に引き上げリスクをゼロに。` },
              { icon: '💰', label: '利確実行',              desc: 'MA50割れ×出来高1.5x超×含み益あり。利益を確定するタイミング。' },
              { icon: '💰', label: '元本回収済・ガチホ',    desc: '恩株化完了。コストゼロで無限に保有できる。売らずに夢を見る。' },
              { icon: '🚨', label: '損切り実行',            desc: `損切りライン(${stopLoss}%)到達。今すぐ損失を確定し、資金を次の機会へ。` },
              { icon: '🟡', label: '調整中・様子見',        desc: '損切りも利確もまだ。現在のトレンドが続くか監視。' },
              { icon: '🟢', label: 'ガチホ継続',            desc: 'ポジションは安全圏。長期保有継続。焦らず待つ。' },
            ].map((row, i) => (
              <div key={row.icon} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 14px', background: i % 2 === 0 ? '#F8FAFC' : '#fff', borderTop: i > 0 ? '1px solid #F1F5F9' : 'none' }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{row.icon}</span>
                <span style={{ fontWeight: 700, color: '#374151', minWidth: 130, flexShrink: 0 }}>{row.label}</span>
                <span style={{ color: '#64748B', lineHeight: 1.5 }}>{row.desc}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {scrolled && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ position: 'fixed', bottom: isMobile ? 88 : 28, right: 18, width: 44, height: 44, borderRadius: '50%', background: '#0A1628', color: '#C9A84C', border: 'none', cursor: 'pointer', fontSize: 18, zIndex: 200, boxShadow: '0 4px 14px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↑</button>
      )}
      <NavBar />
    </main>
  );
}
