'use client';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import AuthButton from '../components/AuthButton';
import { getSignals } from '../lib/signals';

const NAVY  = '#0A1628';
const NAVY2 = '#1E3A5F';
const GOLD  = '#C9A84C';
const GOLD2 = '#F0C040';

const WATCH_KEY     = 'us_watchlist_v1';
const LAST_SCAN_KEY = 'us_scan_last_v1';
const GUIDE_KEY     = 'guide_seen_us_v1';
const FILTER_KEY    = 'us_filter_v1';
const LIST_TYPE     = 'us_scan';

function fmtPrice(v) {
  if (v == null) return '—';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtJPY(usdPrice, rate) {
  if (!usdPrice || !rate) return '';
  return '≈ ¥' + Math.round(usdPrice * rate).toLocaleString('ja-JP');
}
function fmtMktCap(v) {
  if (!v) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return '$' + (v / 1e9).toFixed(1) + 'B';
  return '$' + (v / 1e6).toFixed(0) + 'M';
}
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
function high52Color(pct) {
  if (pct >= 0)   return { color: '#92400E', bg: '#FEF3C7' };
  if (pct >= -3)  return { color: '#065F46', bg: '#ECFDF5' };
  return { color: '#64748B', bg: '#F8FAFC' };
}
const RANK_DEFS = [
  { rank: 'S', range: '80–100', label: 'Strong Buy',   color: '#92400E', bg: '#FEF3C7', border: '#F59E0B', bar: '#F59E0B' },
  { rank: 'A', range: '70–79',  label: 'Buy / Entry',  color: '#15803D', bg: '#DCFCE7', border: '#86EFAC', bar: '#16A34A' },
  { rank: 'B', range: '60–69',  label: 'Watch / Hold', color: '#1D4ED8', bg: '#EFF6FF', border: '#93C5FD', bar: '#3B82F6' },
  { rank: 'C', range: '50–59',  label: 'Neutral',      color: '#475569', bg: '#F1F5F9', border: '#CBD5E1', bar: '#94A3B8' },
  { rank: 'D', range: '<50',    label: 'Ignore',       color: '#94A3B8', bg: '#F8FAFC', border: '#E2E8F0', bar: '#CBD5E1' },
];
const SCORE_BREAKDOWN = [
  { label: '52W高値近接',    max: 40, desc: '高値まで0% → +40pt' },
  { label: '出来高急増',     max: 30, desc: '4x以上 → +30pt'    },
  { label: '前日上昇モメンタム', max: 20, desc: '+7%以上 → +20pt'  },
  { label: '時価総額信頼度', max: 10, desc: '$1T超 → +10pt'     },
];
function scoreRank(score) {
  return RANK_DEFS.find(r => {
    if (r.rank === 'S') return score >= 80;
    if (r.rank === 'A') return score >= 70;
    if (r.rank === 'B') return score >= 60;
    if (r.rank === 'C') return score >= 50;
    return true;
  });
}
function hasBuySignal(score, signals) {
  return score >= 70 && !signals.some(s => s.type === 'overheated');
}
function ScoreBadge({ score }) {
  const r = scoreRank(score);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 800, background: r.bg, color: r.color, border: `1px solid ${r.border}`, padding: '2px 6px', borderRadius: 5, letterSpacing: 0.5, lineHeight: 1 }}>
        {r.rank}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: r.color, lineHeight: 1 }}>{score}</span>
        <div style={{ width: 36, height: 4, background: '#E2E8F0', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', background: r.bar, borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}
function ScoreHeaderPopover() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5 }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span>スコア</span>
      <span style={{ width: 15, height: 15, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', border: '1px solid rgba(255,255,255,0.35)', flexShrink: 0 }}>i</span>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, zIndex: 300, width: 340, background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.2)', border: '1px solid #E2E8F0', overflow: 'hidden', color: '#111' }}>
          <div style={{ background: `linear-gradient(135deg,${NAVY},${NAVY2})`, padding: '12px 16px' }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: GOLD, fontWeight: 700 }}>SCORE DEFINITION</div>
            <div style={{ fontSize: 13, color: '#fff', fontWeight: 600, marginTop: 2 }}>スコアとランクの定義</div>
          </div>
          <div style={{ padding: '10px 16px 4px' }}>
            {RANK_DEFS.map((r, i) => (
              <div key={r.rank} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < RANK_DEFS.length - 1 ? '1px solid #F1F5F9' : 'none' }}>
                <span style={{ fontSize: 12, fontWeight: 800, background: r.bg, color: r.color, border: `1px solid ${r.border}`, padding: '2px 7px', borderRadius: 5, minWidth: 22, textAlign: 'center' }}>{r.rank}</span>
                <span style={{ fontSize: 11, color: '#94A3B8', minWidth: 56 }}>{r.range}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: r.color }}>{r.label}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: '8px 16px 14px', borderTop: '1px solid #F1F5F9', marginTop: 4 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: '#94A3B8', fontWeight: 700, marginBottom: 8 }}>SCORE BREAKDOWN（合計 100pt）</div>
            {SCORE_BREAKDOWN.map(b => (
              <div key={b.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>{b.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>{b.desc}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#92400E', background: '#FEF3C7', padding: '1px 5px', borderRadius: 4 }}>+{b.max}pt</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function SignalBadges({ score, signals, specialDividend }) {
  const buy = hasBuySignal(score, signals);
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
      {buy && (
        <span className="buy-pulse" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: '#DCFCE7', color: '#15803D', fontWeight: 700, border: '1px solid #86EFAC', whiteSpace: 'nowrap' }}>
          🟢 BUY
        </span>
      )}
      {signals.map(s => (
        <span key={s.type} style={{
          fontSize: 11, padding: '2px 6px', borderRadius: 5, fontWeight: 600, whiteSpace: 'nowrap',
          ...(s.type === 'overheated'
            ? { background: '#FEF9C3', color: '#A16207', border: '1px solid #FDE047' }
            : { background: '#F1F5F9', color: s.color }),
        }}>
          {s.type === 'overheated' ? '🟡 STAY' : `${s.icon} ${s.label}`}
        </span>
      ))}
      {specialDividend && (
        <span title="過去12ヶ月に特別配当が含まれるため配当利回りを除外しています" style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, background: '#FEF2F2', color: '#9CA3AF', fontWeight: 500, whiteSpace: 'nowrap', cursor: 'help', textDecoration: 'line-through' }}>
          📌 特配除外
        </span>
      )}
    </div>
  );
}

// ─── Desktop row ───────────────────────────────────────────────────────────
function ScanRow({ row, rank, watchlist, onWatch, usdJpy, onEnrich }) {
  const signals   = getSignals(row);
  const isWatched = !!watchlist[row.ticker];
  const pct       = parseFloat(row.high52Pct);
  const hc        = high52Color(pct);

  const buy = hasBuySignal(row.score, signals);
  return (
    <tr style={{ borderBottom: '1px solid #F1F5F9', background: buy ? (rank % 2 === 0 ? 'rgba(220,252,231,0.55)' : 'rgba(220,252,231,0.3)') : (rank % 2 === 0 ? '#F8FAFC' : '#fff') }}>
      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
        <button onClick={() => onWatch(row)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: isWatched ? GOLD : '#CBD5E1', padding: 0, minWidth: 32, minHeight: 32 }}>
          {isWatched ? '★' : '☆'}
        </button>
      </td>
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <button onClick={() => onEnrich(row)}
            style={{ color: NAVY, fontWeight: 700, fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
            {row.ticker}
          </button>
          <a href={`https://finance.yahoo.com/quote/${row.ticker}`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10, color: '#94A3B8', textDecoration: 'none' }}>↗</a>
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>{row.name?.slice(0, 22)}</div>
        <div style={{ fontSize: 10, color: '#94A3B8' }}>{row.sector}</div>
      </td>
      <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 14 }}>{fmtPrice(row.price)}</td>
      <td style={{ padding: '8px 10px', color: '#64748B', fontSize: 12 }}>
        {usdJpy ? fmtJPY(row.price, usdJpy) : '—'}
      </td>
      <td style={{ padding: '8px 10px', fontWeight: 600, color: row.dayChangePct >= 0 ? '#059669' : '#DC2626' }}>
        {row.dayChangePct >= 0 ? '+' : ''}{row.dayChangePct?.toFixed(2)}%
      </td>
      <td style={{ padding: '8px 10px' }}>
        <span style={{ background: hc.bg, color: hc.color, padding: '2px 7px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
        </span>
      </td>
      <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600,
        color: row.volRatio >= 2 ? '#DC2626' : row.volRatio >= 1.5 ? '#D97706' : '#374151' }}>
        {row.volRatio ? row.volRatio.toFixed(1) + 'x' : '—'}
      </td>
      <td style={{ padding: '8px 10px', fontSize: 12, color: '#64748B' }}>{fmtMktCap(row.marketCap)}</td>
      <td style={{ padding: '8px 10px', fontSize: 12, color: '#64748B' }}>{row.pe ? row.pe.toFixed(1) : '—'}</td>
      <td style={{ padding: '8px 10px' }}>
        <SignalBadges score={row.score} signals={signals} specialDividend={row.specialDividend} />
      </td>
      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
        <ScoreBadge score={row.score} />
      </td>
    </tr>
  );
}

// ─── Mobile card ───────────────────────────────────────────────────────────
function MetricCell({ label, value, color = '#374151', bg = '#F8FAFC' }) {
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '7px 10px' }}>
      <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ScanCard({ row, watchlist, onWatch, usdJpy, onEnrich }) {
  const signals   = getSignals(row);
  const isWatched = !!watchlist[row.ticker];
  const pct       = parseFloat(row.high52Pct);
  const hc        = high52Color(pct);

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
      <div style={{ background: NAVY, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <button onClick={() => onEnrich(row)}
              style={{ color: GOLD, fontWeight: 700, fontSize: 19, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: GOLD }}>
              {row.ticker}
            </button>
            <a href={`https://finance.yahoo.com/quote/${row.ticker}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#64748B', textDecoration: 'none' }}>↗YF</a>
            <span style={{ background: scoreRank(row.score).bg, color: scoreRank(row.score).color, padding: '2px 8px', borderRadius: 10, fontWeight: 700, fontSize: 12, border: `1px solid ${scoreRank(row.score).border}` }}>
              {scoreRank(row.score).rank} {row.score}
            </span>
            {pct >= 0 && (
              <span style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>
                🏆 52W高値
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#94A3B8' }}>{row.name?.slice(0, 28)}</div>
          <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>{row.sector}</div>
        </div>
        <button onClick={() => onWatch(row)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 26, color: isWatched ? GOLD : '#475569', minWidth: 44, minHeight: 44, padding: '4px 8px', flexShrink: 0 }}>
          {isWatched ? '★' : '☆'}
        </button>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <div>
            <span style={{ fontSize: 22, fontWeight: 700, color: NAVY }}>{fmtPrice(row.price)}</span>
            <span style={{ marginLeft: 8, fontSize: 12, color: '#64748B' }}>{usdJpy ? fmtJPY(row.price, usdJpy) : ''}</span>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: row.dayChangePct >= 0 ? '#059669' : '#DC2626' }}>
            {row.dayChangePct >= 0 ? '+' : ''}{row.dayChangePct?.toFixed(2)}%
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <MetricCell label="52週高値比"
            value={(pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'}
            color={hc.color} bg={hc.bg} />
          <MetricCell label="出来高比"
            value={row.volRatio ? row.volRatio.toFixed(1) + 'x' : '—'}
            color={row.volRatio >= 2 ? '#DC2626' : '#374151'} />
          <MetricCell label="時価総額" value={fmtMktCap(row.marketCap)} />
          <MetricCell label="P/E" value={row.pe ? row.pe.toFixed(1) : '—'} />
        </div>
        <SignalBadges score={row.score} signals={signals} specialDividend={row.specialDividend} />
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function Page() {
  const [scanResults, setScanResults] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [usdJpy, setUsdJpy]           = useState(null);
  const [watchlist, setWatchlist]     = useState({});
  const [tab, setTab]                 = useState('scan');
  const [isMobile, setIsMobile]       = useState(false);
  const [scannedAt, setScannedAt]     = useState(null);
  const [scannedCount, setScannedCount] = useState(null);
  const [capFilter, setCapFilter]     = useState(() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY))?.cap || 'small'; } catch { return 'small'; } });
  const [sectorFilter, setSectorFilter] = useState(() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY))?.sector || 'all'; } catch { return 'all'; } });
  const [errorMsg, setErrorMsg]       = useState(null);
  const [enrichRow, setEnrichRow]     = useState(null);
  const [enrichData, setEnrichData]   = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [watchRefreshing, setWatchRefreshing] = useState(false);
  const [watchRefreshedAt, setWatchRefreshedAt] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem(GUIDE_KEY)) window.location.replace('/guide');
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_SCAN_KEY);
      if (saved) { const d = JSON.parse(saved); setScanResults(d.rows || []); setScannedAt(d.scannedAt); if (d.scannedCount) setScannedCount(d.scannedCount); }
      const wl = localStorage.getItem(WATCH_KEY);
      if (wl) setWatchlist(JSON.parse(wl));
    } catch {}
  }, []);

  useEffect(() => {
    fetch('/api/fx').then(r => r.json()).then(d => { if (d.rate) setUsdJpy(d.rate); }).catch(() => {});
  }, []);

  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify({ cap: capFilter, sector: sectorFilter })); } catch {}
  }, [capFilter, sectorFilter]);

  async function runScan() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res  = await fetch('/api/scan', { method: 'POST' });
      const data = await res.json();
      if (data.error) { setErrorMsg(data.error); return; }
      setScanResults(data.rows || []);
      setScannedAt(data.scannedAt);
      setScannedCount(data.scannedCount || null);
      localStorage.setItem(LAST_SCAN_KEY, JSON.stringify({ rows: data.rows, scannedAt: data.scannedAt, scannedCount: data.scannedCount }));
    } catch (e) {
      setErrorMsg('スキャンに失敗しました: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function openEnrich(row) {
    setEnrichRow(row);
    setEnrichData(null);
    setEnrichLoading(true);
    try {
      const res = await fetch('/api/gemini-enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: row.ticker, name: row.name }),
      });
      const data = await res.json();
      setEnrichData(data);
    } catch (e) {
      setEnrichData({ error: e.message });
    }
    setEnrichLoading(false);
  }

  function toggleWatch(row) {
    const next = { ...watchlist };
    if (next[row.ticker]) { delete next[row.ticker]; }
    else { next[row.ticker] = { ...row, savedAt: new Date().toISOString() }; }
    setWatchlist(next);
    localStorage.setItem(WATCH_KEY, JSON.stringify(next));
  }

  async function refreshWatchlist() {
    const tickers = Object.keys(watchlist);
    if (tickers.length === 0) return;
    setWatchRefreshing(true);
    try {
      const res  = await fetch('/api/watchlist-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      const data = await res.json();
      if (data.rows) {
        const fresh = Object.fromEntries(data.rows.map(r => [r.ticker, r]));
        const next  = Object.fromEntries(
          Object.entries(watchlist).map(([ticker, saved]) => [
            ticker,
            { ...saved, ...(fresh[ticker] || {}), savedAt: saved.savedAt },
          ])
        );
        setWatchlist(next);
        localStorage.setItem(WATCH_KEY, JSON.stringify(next));
        setWatchRefreshedAt(new Date().toISOString());
      }
    } catch {}
    setWatchRefreshing(false);
  }

  const capRanges = {
    all:   { min: 0,    max: Infinity },
    small: { min: 1e9,  max: 1e10 },
    mid:   { min: 1e10, max: 1e11 },
    large: { min: 1e11, max: Infinity },
  };
  const { min: capMin, max: capMax } = capRanges[capFilter] || capRanges.all;

  const sectorCounts = {};
  scanResults.forEach(r => {
    if (r.sector && r.sector !== '—') sectorCounts[r.sector] = (sectorCounts[r.sector] || 0) + 1;
  });
  const hotSector = Object.keys(sectorCounts).length
    ? Object.entries(sectorCounts).sort((a, b) => b[1] - a[1])[0][0]
    : null;
  const sectors = ['all', ...new Set(scanResults.map(r => r.sector).filter(s => s && s !== '—').sort())];

  const filteredRows = scanResults.filter(r =>
    (r.marketCap || 0) >= capMin &&
    (r.marketCap || 0) < capMax &&
    (sectorFilter === 'all' || r.sector === sectorFilter)
  );
  const watchRows    = Object.values(watchlist);
  const displayRows  = tab === 'scan' ? filteredRows : watchRows;

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 1rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <style>{`
        @keyframes buyPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(21,128,61,0.45); }
          50%       { box-shadow: 0 0 0 5px rgba(21,128,61,0); }
        }
        .buy-pulse { animation: buyPulse 1.8s ease-in-out infinite; }
      `}</style>
      {/* Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', rowGap: 8 }}>
        <nav style={{ display: 'flex', gap: 4, background: '#EEF2FF', padding: 4, borderRadius: 10 }}>
          <a href="/guide"     style={navStyle(false)}>📖 ガイド</a>
          <a href="/"          style={navStyle(true)} >📈 USスキャン</a>
          <a href="/portfolio" style={navStyle(false)}>📊 ポートフォリオ</a>
          <a href="https://new-high-screener.vercel.app" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, padding: '5px 11px', borderRadius: 6, textDecoration: 'none', background: 'rgba(0,0,0,0.06)', color: '#64748B', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 4 }}>🗾 日本株 ↗</a>
        </nav>
        <AuthButton />
      </div>

      {/* Gemini enrich popup */}
      {enrichRow && (
        <div onClick={() => setEnrichRow(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', maxWidth: 440, width: '100%', boxShadow: '0 16px 60px rgba(0,0,0,0.35)' }}>
            {/* Header */}
            <div style={{ background: `linear-gradient(135deg,${NAVY},${NAVY2})`, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 3, color: GOLD, fontWeight: 700, marginBottom: 4 }}>AI ANALYSIS</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{enrichRow.ticker}</div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>{enrichRow.name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: GOLD }}>${enrichRow.price?.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                  {enrichRow.dayChangePct >= 0 ? '+' : ''}{enrichRow.dayChangePct?.toFixed(2)}% 前日比
                </div>
                <a href={`https://finance.yahoo.com/quote/${enrichRow.ticker}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 10, color: '#64748B' }}>Yahoo Finance ↗</a>
              </div>
            </div>
            {/* Body */}
            <div style={{ padding: '20px 22px' }}>
              {enrichLoading ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#94A3B8' }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>✨</div>
                  <div style={{ fontSize: 13 }}>Gemini が分析中...</div>
                </div>
              ) : enrichData?.error ? (
                <div style={{ color: '#DC2626', fontSize: 13, padding: '16px 0' }}>⚠️ {enrichData.error}</div>
              ) : enrichData ? (
                <>
                  {/* 新高値付近の理由 */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: GOLD, marginBottom: 8 }}>
                      WHY AT 52W HIGH
                    </div>
                    <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '12px 16px' }}>
                      {(enrichData.reason || '').split('\n').map((line, i) => (
                        <div key={i} style={{ fontSize: 13, color: '#1E293B', lineHeight: 1.7, display: 'flex', gap: 8 }}>
                          <span style={{ color: GOLD, fontWeight: 700, flexShrink: 0 }}>{i + 1}.</span>
                          <span>{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* 決算評価 */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#64748B', marginBottom: 8 }}>
                      LATEST EARNINGS
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {enrichData.earningsYoY != null && (
                        <div style={{ background: enrichData.earningsYoY >= 0 ? '#ECFDF5' : '#FEF2F2', borderRadius: 10, padding: '10px 16px', flex: 1, minWidth: 100 }}>
                          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 4 }}>売上 YoY</div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: enrichData.earningsYoY >= 0 ? '#059669' : '#DC2626' }}>
                            {enrichData.earningsYoY >= 0 ? '+' : ''}{enrichData.earningsYoY.toFixed(1)}%
                          </div>
                        </div>
                      )}
                      {enrichData.earningsEval && (
                        <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 16px', flex: 2 }}>
                          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 4 }}>評価</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1E293B', lineHeight: 1.5 }}>{enrichData.earningsEval}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
              <button onClick={() => setEnrichRow(null)}
                style={{ marginTop: 20, width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#64748B' }}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hero */}
      <div style={{ background: `linear-gradient(160deg,${NAVY} 0%,${NAVY2} 100%)`, borderRadius: 16, padding: isMobile ? '20px 18px' : '26px 32px', marginBottom: 20, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: 'rgba(201,168,76,0.12)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, color: GOLD, fontWeight: 700, marginBottom: 6 }}>GLOBAL HIGH SCREENER</div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 26, fontWeight: 700 }}>US 52週高値スキャナー</h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94A3B8' }}>
              Nasdaq / NYSE · {scannedCount ? `${scannedCount.toLocaleString()}銘柄をスキャン` : '最大1,000銘柄をスキャン'}
            </p>
          </div>
          <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
            <div style={{ fontSize: 11, color: '#64748B', marginBottom: 3 }}>USD / JPY</div>
            {usdJpy
              ? <div style={{ fontSize: 24, fontWeight: 700, color: GOLD }}>{usdJpy.toFixed(2)} <span style={{ fontSize: 13, color: '#94A3B8' }}>円</span></div>
              : <div style={{ fontSize: 14, color: '#64748B' }}>取得中...</div>}
            <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>リアルタイム換算</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={runScan} disabled={loading}
          style={{ padding: '11px 24px', background: loading ? '#94A3B8' : `linear-gradient(135deg,${GOLD},${GOLD2})`, color: NAVY, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', minHeight: 44, boxShadow: loading ? 'none' : '0 2px 8px rgba(201,168,76,0.35)' }}>
          {loading ? '⏳ スキャン中 (10〜20秒)...' : '🔍 52週高値スキャン実行'}
        </button>
        {scannedAt && <span style={{ fontSize: 12, color: '#888' }}>最終: {new Date(scannedAt).toLocaleString('ja-JP')}</span>}
        <select value={capFilter} onChange={e => setCapFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13, cursor: 'pointer', minHeight: 44 }}>
          <option value="all">規模: すべて</option>
          <option value="small">Small ($1B–$10B) 原石</option>
          <option value="mid">Mid ($10B–$100B) 本命</option>
          <option value="large">Large ($100B+) 主力株</option>
        </select>
        {sectors.length > 2 && (
          <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13, cursor: 'pointer', minHeight: 44 }}>
            {sectors.map(s => (
            <option key={s} value={s}>
              {s === 'all'
                ? `セクター: すべて${hotSector ? ` (🔥${hotSector})` : ''}`
                : `${s === hotSector ? '🔥 ' : ''}${s}${sectorCounts[s] ? ` (${sectorCounts[s]})` : ''}`}
            </option>
          ))}
          </select>
        )}
      </div>

      {errorMsg && (
        <div style={{ marginBottom: 14, padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, fontSize: 13, color: '#DC2626' }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '2px solid #E2E8F0', marginBottom: 16 }}>
        {[
          ['scan',      `スキャン結果${filteredRows.length > 0 ? ` (${filteredRows.length})` : ''}`],
          ['watchlist', `ウォッチリスト${watchRows.length > 0 ? ` (${watchRows.length})` : ''}`],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '8px 16px', border: 'none', cursor: 'pointer', background: 'transparent', fontWeight: tab === key ? 700 : 400, color: tab === key ? NAVY : '#888', borderBottom: tab === key ? `2px solid ${NAVY}` : '2px solid transparent', fontSize: 13, marginBottom: -2, whiteSpace: 'nowrap' }}>
            {label}
          </button>
        ))}
        {tab === 'watchlist' && watchRows.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 2 }}>
            {watchRefreshedAt && (
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                更新: {new Date(watchRefreshedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button onClick={refreshWatchlist} disabled={watchRefreshing}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: `1px solid ${GOLD}`, background: watchRefreshing ? '#F8FAFC' : '#FFFBEB', color: watchRefreshing ? '#94A3B8' : '#92400E', fontSize: 12, fontWeight: 600, cursor: watchRefreshing ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-block', animation: watchRefreshing ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
              {watchRefreshing ? '更新中...' : '価格を更新'}
            </button>
          </div>
        )}
      </div>
      <style>{`.spin-icon { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Results */}
      {displayRows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94A3B8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{tab === 'scan' ? '🔍' : '⭐'}</div>
          <p style={{ fontSize: 14 }}>
            {tab === 'scan'
              ? '「52週高値スキャン実行」ボタンを押すと、52週高値圏の銘柄が表示されます'
              : '★ボタンで銘柄をウォッチリストに追加してください'}
          </p>
        </div>
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {displayRows.map(r => (
            <ScanCard key={r.ticker} row={r} watchlist={watchlist} onWatch={toggleWatch} usdJpy={usdJpy} onEnrich={openEnrich} />
          ))}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: NAVY, color: '#fff' }}>
                {['', 'ティッカー', '価格 (USD)', 'JPY換算', '前日比', '52W高値比', '出来高比', '時価総額', 'P/E', 'シグナル'].map(h => (
                  <th key={h} style={{ padding: '10px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
                <th style={{ padding: '10px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                  <ScoreHeaderPopover />
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, i) => (
                <ScanRow key={r.ticker} row={r} rank={i + 1} watchlist={watchlist} onWatch={toggleWatch} usdJpy={usdJpy} onEnrich={openEnrich} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
