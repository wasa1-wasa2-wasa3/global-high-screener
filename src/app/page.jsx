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
function scoreColor(score) {
  if (score >= 70) return { color: '#15803D', bg: '#DCFCE7', bar: '#16A34A' };
  if (score >= 50) return { color: '#D97706', bg: '#FEF3C7', bar: '#F59E0B' };
  return { color: '#64748B', bg: '#F1F5F9', bar: '#94A3B8' };
}
function hasBuySignal(score, signals) {
  return score >= 70 && !signals.some(s => s.type === 'overheated');
}
function ScoreBadge({ score }) {
  const sc = scoreColor(score);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: sc.color }}>{score}</span>
      <div style={{ width: 44, height: 5, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', background: sc.bar, borderRadius: 3 }} />
      </div>
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
            <span style={{ background: scoreColor(row.score).bg, color: scoreColor(row.score).color, padding: '2px 8px', borderRadius: 10, fontWeight: 700, fontSize: 12, border: `1px solid ${scoreColor(row.score).bar}` }}>
              {row.score}pt
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
  const [capFilter, setCapFilter]     = useState('small');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [errorMsg, setErrorMsg]       = useState(null);
  const [enrichRow, setEnrichRow]     = useState(null);
  const [enrichData, setEnrichData]   = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);

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
      <div style={{ display: 'flex', borderBottom: '2px solid #E2E8F0', marginBottom: 16 }}>
        {[
          ['scan',      `スキャン結果${filteredRows.length > 0 ? ` (${filteredRows.length})` : ''}`],
          ['watchlist', `ウォッチリスト${watchRows.length > 0 ? ` (${watchRows.length})` : ''}`],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '8px 16px', border: 'none', cursor: 'pointer', background: 'transparent', fontWeight: tab === key ? 700 : 400, color: tab === key ? NAVY : '#888', borderBottom: tab === key ? `2px solid ${NAVY}` : '2px solid transparent', fontSize: 13, marginBottom: -2, whiteSpace: 'nowrap' }}>
            {label}
          </button>
        ))}
      </div>

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
                {['', 'ティッカー', '価格 (USD)', 'JPY換算', '前日比', '52W高値比', '出来高比', '時価総額', 'P/E', 'シグナル', 'スコア'].map(h => (
                  <th key={h} style={{ padding: '10px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
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
