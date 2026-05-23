'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import AuthButton from '../components/AuthButton';
import { getSignals } from '../lib/signals';
import { calcScore } from '../lib/scoring';

const NAVY  = '#0A1628';
const NAVY2 = '#1E3A5F';
const GOLD  = '#C9A84C';
const GOLD2 = '#F0C040';

const WATCH_KEY     = 'us_watchlist_v1';
const LAST_SCAN_KEY = 'us_scan_last_v1';
const GUIDE_KEY     = 'guide_seen_us_v1';
const FILTER_KEY    = 'us_filter_v2'; // v2: default 'all'、旧 'small' キャッシュをリセット
const LIST_TYPE         = 'us_scan';
const WATCH_REFRESH_KEY = 'us_watch_refreshed_v1';
const WATCH_STALE_MS    = 60 * 60 * 1000;

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
  { rank: 'S', range: '80–100', label: 'High Signal',  color: '#92400E', bg: '#FEF3C7', border: '#F59E0B', bar: '#F59E0B' },
  { rank: 'A', range: '70–79',  label: 'Watch First',  color: '#15803D', bg: '#DCFCE7', border: '#86EFAC', bar: '#16A34A' },
  { rank: 'B', range: '60–69',  label: 'On Radar',     color: '#1D4ED8', bg: '#EFF6FF', border: '#93C5FD', bar: '#3B82F6' },
  { rank: 'C', range: '50–59',  label: 'Weak Signal',  color: '#475569', bg: '#F1F5F9', border: '#CBD5E1', bar: '#94A3B8' },
  { rank: 'D', range: '<50',    label: 'Low Signal',   color: '#94A3B8', bg: '#F8FAFC', border: '#E2E8F0', bar: '#CBD5E1' },
];
const SCORE_BREAKDOWN = [
  { label: '売上成長率 YoY',   max: 45, desc: '+50%以上 → +45pt ★最優先' },
  { label: '小型株プレミアム', max: 25, desc: '$2B以下 → +25pt'            },
  { label: 'グロス利益率',     max: 20, desc: '70%以上 → +20pt'            },
  { label: '52W高値近接',      max: 10, desc: '高値0% → +10pt'             },
  { label: 'PSR',              max: 10, desc: '5倍未満 → +10pt'            },
  { label: '出来高急増',       max:  5, desc: '4x以上 → +5pt'              },
  { label: '前日モメンタム',   max:  2, desc: '+5%以上 → +2pt'             },
  { label: 'RS vs QQQ',        max:  8, desc: '2x以上 → +8pt'              },
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

// ─── Trend Lamp ──────────────────────────────────────────────────────────────
const TREND_CFG = {
  breakout: { arrow: '↑', color: '#16A34A', label: '買い増し',  title: '↑ 絶好調 — 大出来高で52W高値突破・買い増し検討' },
  holding:  { arrow: '→', color: '#64748B', label: '保有OK',   title: '→ 保有OK — 高値圏で出来高枯渇・健全な保ち合い' },
  exit:     { arrow: '↓', color: '#DC2626', label: '売り検討',  title: '↓ 要注意 — 大出来高でサポート割れ・売り検討' },
};
const WATCH_CFG = {
  breakout: { arrow: '🚀', color: '#fff',    label: '今すぐエントリー', title: '【Breakout!】大出来高で52W高値を突破しました。今がエントリーのベストタイミングです。買ったその日に逆指値を入れること。' },
  holding:  { arrow: '→',  color: '#64748B', label: 'もう少し待て',     title: '【待機中】高値圏をキープしていますが、エントリーサインはまだ出ていません。出来高が急増するまで待ちましょう。' },
  exit:     { arrow: '↓',  color: '#DC2626', label: 'ウォッチ外す候補',  title: '【トレンド悪化】大出来高でサポートを割り込みました。エントリーせずウォッチリストから外すことを検討してください。' },
};
const SCAN_CFG = {
  breakout: { arrow: '🚀', color: '#16A34A', label: '急いで★追加！',   title: '【Breakout検出】今この銘柄が動き始めています。★を押してウォッチリストに追加し、購入を検討してください。' },
  holding:  { arrow: '→', color: '#64748B', label: '★追加して待つ',   title: '【高値圏キープ中】まだエントリーサインは出ていません。★でウォッチリストに追加して、Breakoutを待ちましょう。' },
  exit:     { arrow: '↓', color: '#DC2626', label: '見送り推奨',       title: '【下降トレンド】大出来高でサポートを割り込んでいます。今は見送りを推奨します。' },
};
function TrendLamp({ mode, showLabel = false, watchMode = false, scanMode = false }) {
  if (!mode) {
    const nullLabel = watchMode ? '待機中' : scanMode ? '★追加して待つ' : '様子見';
    const nullTip   = watchMode
      ? '【待機中】エントリーサイン（大出来高×高値突破）がまだ出ていません。ウォッチを続けて発火を待ちましょう。'
      : scanMode
        ? '【高値圏付近】まだ特定のトレンドシグナルはありません。★でウォッチリストに追加して様子を見ましょう。'
        : '→ 様子見 — 特定のトレンドシグナルなし';
    return (
      <span title={nullTip}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, color: '#CBD5E1' }}>
        <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>→</span>
        {showLabel && <span style={{ fontSize: 10, fontWeight: 600 }}>{nullLabel}</span>}
      </span>
    );
  }
  const cfg = (watchMode ? WATCH_CFG : scanMode ? SCAN_CFG : TREND_CFG)[mode];
  if (!cfg) return null;
  const isBreakout = mode === 'breakout';
  return (
    <span title={cfg.title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, color: cfg.color,
        ...(isBreakout ? {
          background: 'linear-gradient(135deg,#16A34A,#15803D)',
          borderRadius: 8, padding: '3px 8px',
          boxShadow: '0 0 10px rgba(22,163,74,0.55)',
          border: '1px solid #4ADE80',
        } : {}),
      }}>
      <span style={{ fontSize: isBreakout ? 16 : 13, fontWeight: 700, lineHeight: 1 }}>{cfg.arrow}</span>
      {showLabel && <span style={{ fontSize: 10, fontWeight: 700 }}>{cfg.label}</span>}
    </span>
  );
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
            <div style={{ fontSize: 9, letterSpacing: 2, color: '#94A3B8', fontWeight: 700, marginBottom: 8 }}>SCORE BREAKDOWN（各要素の最大加点・上限100pt）</div>
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
function SignalBadges({ score, signals, specialDividend, rs }) {
  const buy = hasBuySignal(score, signals);
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
      {buy && (
        <span className="buy-pulse" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: '#DCFCE7', color: '#15803D', fontWeight: 700, border: '1px solid #86EFAC', whiteSpace: 'nowrap' }}>
          🟢 買い
        </span>
      )}
      {rs != null && rs >= 1.5 && (
        <span title={`RS vs QQQ: ${rs.toFixed(2)}x — 過去1年でQQQの${rs.toFixed(1)}倍のリターン`}
          style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, background: '#EFF6FF', color: '#1D4ED8', fontWeight: 700, border: '1px solid #93C5FD', whiteSpace: 'nowrap' }}>
          📈 RS {rs.toFixed(1)}x
        </span>
      )}
      {signals.map(s => (
        <span key={s.type} style={{
          fontSize: 11, padding: '2px 6px', borderRadius: 5, fontWeight: 600, whiteSpace: 'nowrap',
          ...(s.type === 'overheated'
            ? { background: '#FEF9C3', color: '#A16207', border: '1px solid #FDE047' }
            : { background: '#F1F5F9', color: s.color }),
        }}>
          {s.type === 'overheated' ? '🟡 過熱' : `${s.icon} ${s.label}`}
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
function ScanRow({ row, rank, watchlist, onWatch, usdJpy, onEnrich,
                   isWatchTab = false, buyingTicker, onBuyToggle, buyForm, onBuyFormChange, onBuySubmit }) {
  const signals   = getSignals(row);
  const isWatched = !!watchlist[row.ticker];
  const pct       = parseFloat(row.high52Pct);
  const hc        = high52Color(pct);
  const buy       = hasBuySignal(row.score, signals);
  const isBuying  = isWatchTab && buyingTicker === row.ticker;

  return (
    <>
      <tr style={{ borderBottom: '1px solid #F1F5F9', background: buy ? (rank % 2 === 0 ? 'rgba(220,252,231,0.55)' : 'rgba(220,252,231,0.3)') : (rank % 2 === 0 ? '#F8FAFC' : '#fff') }}>
        <td style={{ padding: '8px 6px', textAlign: 'center' }}>
          <button onClick={() => onWatch(row)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: isWatched ? GOLD : '#CBD5E1', padding: 0, minWidth: 32, minHeight: 32 }}>
            {isWatched ? '★' : '☆'}
          </button>
        </td>
        <td style={{ padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <TrendLamp mode={row.trendMode} showLabel watchMode={isWatchTab} scanMode={!isWatchTab} />
            <button onClick={() => onEnrich(row)}
              style={{ color: NAVY, fontWeight: 700, fontSize: 14, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
              {row.ticker}
            </button>
            <a href={`https://finance.yahoo.co.jp/quote/${row.ticker}/chart`} target="_blank" rel="noopener noreferrer"
              className="yf-chart-link"
              title={`${row.ticker} チャートを開く`}
              style={{ fontSize: 11, color: '#94A3B8', textDecoration: 'none', opacity: 0.7 }}>📈</a>
            {isWatchTab && row.trendMode === 'breakout' && (
              <button onClick={() => onBuyToggle(row.ticker)}
                style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: isBuying ? '#DCFCE7' : '#F0FDF4', color: '#15803D', border: '1px solid #86EFAC', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                ✅ 購入した
              </button>
            )}
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
        <td style={{ padding: '8px 10px', fontSize: 12,
          fontWeight: row.revenueGrowthYoy != null && row.revenueGrowthYoy >= 30 ? 700 : 400,
          color: row.revenueGrowthYoy != null ? (row.revenueGrowthYoy >= 50 ? '#15803D' : row.revenueGrowthYoy >= 20 ? '#D97706' : '#64748B') : '#CBD5E1' }}>
          {row.revenueGrowthYoy != null ? (row.revenueGrowthYoy >= 0 ? '+' : '') + row.revenueGrowthYoy.toFixed(1) + '%' : '—'}
          {row.revCAGR3Y != null && (
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1, fontWeight: 400 }}>
              CAGR: {row.revCAGR3Y >= 0 ? '+' : ''}{row.revCAGR3Y.toFixed(1)}%
            </div>
          )}
        </td>
        <td style={{ padding: '8px 10px', fontSize: 12,
          color: row.grossMargin != null ? (row.grossMargin >= 70 ? '#15803D' : row.grossMargin >= 50 ? '#D97706' : '#64748B') : '#CBD5E1' }}>
          {row.grossMargin != null ? row.grossMargin.toFixed(1) + '%' : '—'}
        </td>
        <td style={{ padding: '8px 10px' }}>
          <SignalBadges score={row.score} signals={signals} specialDividend={row.specialDividend} rs={row.rs} />
        </td>
        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
          <ScoreBadge score={row.score} />
        </td>
      </tr>
      {isBuying && (
        <tr style={{ background: '#F0FDF4' }}>
          <td colSpan={12} style={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#15803D' }}>📥 {row.ticker} をポートフォリオに追加</span>
              <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                平均取得単価 (USD):
                <input type="number" value={buyForm.avgCost} onChange={e => onBuyFormChange('avgCost', e.target.value)}
                  placeholder={row.price?.toFixed(2)}
                  style={{ width: 90, padding: '4px 8px', borderRadius: 6, border: '1px solid #86EFAC', fontSize: 13 }} />
              </label>
              <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                株数:
                <input type="number" value={buyForm.shares} onChange={e => onBuyFormChange('shares', e.target.value)}
                  placeholder="10"
                  style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1px solid #86EFAC', fontSize: 13 }} />
              </label>
              <button onClick={() => onBuySubmit(row)}
                disabled={!buyForm.avgCost || !buyForm.shares}
                style={{ padding: '5px 16px', borderRadius: 7, background: buyForm.avgCost && buyForm.shares ? '#15803D' : '#94A3B8', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: buyForm.avgCost && buyForm.shares ? 'pointer' : 'not-allowed' }}>
                📊 ポートフォリオへ
              </button>
              <button onClick={() => onBuyToggle(null)}
                style={{ padding: '5px 12px', borderRadius: 7, background: '#fff', color: '#64748B', border: '1px solid #E2E8F0', fontSize: 12, cursor: 'pointer' }}>
                キャンセル
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Mobile card ───────────────────────────────────────────────────────────
function MetricCell({ label, value, color = '#374151', bg = '#F8FAFC', sub = null }) {
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '7px 10px' }}>
      <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function ScanCard({ row, watchlist, onWatch, usdJpy, onEnrich,
                    isWatchTab = false, buyingTicker, onBuyToggle, buyForm, onBuyFormChange, onBuySubmit }) {
  const signals   = getSignals(row);
  const isWatched = !!watchlist[row.ticker];
  const pct       = parseFloat(row.high52Pct);
  const hc        = high52Color(pct);
  const isBuying  = isWatchTab && buyingTicker === row.ticker;

  return (
    <>
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
      <div style={{ background: NAVY, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <button onClick={() => onEnrich(row)}
              style={{ color: GOLD, fontWeight: 700, fontSize: 19, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: GOLD }}>
              {row.ticker}
            </button>
            <TrendLamp mode={row.trendMode} showLabel watchMode={isWatchTab} scanMode={!isWatchTab} />
            <a href={`https://finance.yahoo.co.jp/quote/${row.ticker}/chart`} target="_blank" rel="noopener noreferrer"
              className="yf-chart-link"
              title={`${row.ticker} チャートを開く`}
              style={{ fontSize: 12, color: '#94A3B8', textDecoration: 'none', opacity: 0.8 }}>📈Chart</a>
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
          <MetricCell label="Rev YoY"
            value={row.revenueGrowthYoy != null ? (row.revenueGrowthYoy >= 0 ? '+' : '') + row.revenueGrowthYoy.toFixed(1) + '%' : '—'}
            color={row.revenueGrowthYoy != null ? (row.revenueGrowthYoy >= 50 ? '#15803D' : row.revenueGrowthYoy >= 20 ? '#D97706' : '#64748B') : '#CBD5E1'}
            bg={row.revenueGrowthYoy != null && row.revenueGrowthYoy >= 30 ? '#ECFDF5' : '#F8FAFC'}
            sub={row.revCAGR3Y != null ? `CAGR: ${row.revCAGR3Y >= 0 ? '+' : ''}${row.revCAGR3Y.toFixed(1)}%` : null} />
          <MetricCell label="Gross Mg"
            value={row.grossMargin != null ? row.grossMargin.toFixed(1) + '%' : '—'}
            color={row.grossMargin != null ? (row.grossMargin >= 70 ? '#15803D' : row.grossMargin >= 50 ? '#D97706' : '#64748B') : '#CBD5E1'}
            bg={row.grossMargin != null && row.grossMargin >= 70 ? '#ECFDF5' : '#F8FAFC'} />
        </div>
        <SignalBadges score={row.score} signals={signals} specialDividend={row.specialDividend} rs={row.rs} />
        {isWatchTab && row.trendMode === 'breakout' && (
          <button onClick={() => onBuyToggle(row.ticker)}
            style={{ marginTop: 10, width: '100%', padding: '9px', borderRadius: 8, background: isBuying ? '#DCFCE7' : '#F0FDF4', color: '#15803D', border: '1px solid #86EFAC', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            ✅ 購入した → ポートフォリオへ
          </button>
        )}
      </div>
    </div>
    {isBuying && (
      <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 12, padding: '14px 16px', marginTop: -8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#15803D', marginBottom: 10 }}>📥 {row.ticker} をポートフォリオに追加</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ minWidth: 120 }}>平均取得単価 (USD):</span>
            <input type="number" value={buyForm.avgCost} onChange={e => onBuyFormChange('avgCost', e.target.value)}
              placeholder={row.price?.toFixed(2)}
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #86EFAC', fontSize: 13 }} />
          </label>
          <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ minWidth: 120 }}>株数:</span>
            <input type="number" value={buyForm.shares} onChange={e => onBuyFormChange('shares', e.target.value)}
              placeholder="10"
              style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #86EFAC', fontSize: 13 }} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onBuySubmit(row)}
              disabled={!buyForm.avgCost || !buyForm.shares}
              style={{ flex: 1, padding: '8px', borderRadius: 7, background: buyForm.avgCost && buyForm.shares ? '#15803D' : '#94A3B8', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: buyForm.avgCost && buyForm.shares ? 'pointer' : 'not-allowed' }}>
              📊 ポートフォリオへ
            </button>
            <button onClick={() => onBuyToggle(null)}
              style={{ padding: '8px 16px', borderRadius: 7, background: '#fff', color: '#64748B', border: '1px solid #E2E8F0', fontSize: 13, cursor: 'pointer' }}>
              キャンセル
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────
export default function Page() {
  const userRef = useRef(null);
  const [scanResults, setScanResults] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [usdJpy, setUsdJpy]           = useState(null);
  const [watchlist, setWatchlist]     = useState({});
  const [tab, setTab]                 = useState('scan');
  const [isMobile, setIsMobile]       = useState(false);
  const [scannedAt, setScannedAt]     = useState(null);
  const [scannedCount, setScannedCount] = useState(null);
  const [capFilter, setCapFilter]     = useState(() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY))?.cap || 'all'; } catch { return 'all'; } });
  const [sectorFilter, setSectorFilter] = useState(() => { try { return JSON.parse(localStorage.getItem(FILTER_KEY))?.sector || 'all'; } catch { return 'all'; } });
  const [errorMsg, setErrorMsg]       = useState(null);
  const [enrichRow, setEnrichRow]     = useState(null);
  const [enrichData, setEnrichData]   = useState(null);
  const [fundData, setFundData]       = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [watchRefreshing, setWatchRefreshing]   = useState(false);
  const [watchRefreshedAt, setWatchRefreshedAt] = useState(null);
  const [buyingTicker, setBuyingTicker]         = useState(null);
  const [buyForm, setBuyForm]                   = useState({ avgCost: '', shares: '' });
  const [sortField, setSortField]               = useState(null);
  const [sortDir, setSortDir]                   = useState('desc');
  const tableScrollRef                          = useRef(null);

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
      const wr = localStorage.getItem(WATCH_REFRESH_KEY);
      if (wr) setWatchRefreshedAt(wr);
    } catch {}
  }, []);

  useEffect(() => {
    async function loadFromSupabase(u) {
      const { data } = await supabase.from('watchlist')
        .select('ticker, name, data, saved_at')
        .eq('user_id', u.id).eq('list_type', LIST_TYPE);
      if (!data?.length) return;
      const wl = Object.fromEntries(
        data.map(r => [r.ticker, { ...r.data, ticker: r.ticker, name: r.name, savedAt: r.saved_at }])
      );
      setWatchlist(wl);
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(wl)); } catch {}
    }

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { userRef.current = user; loadFromSupabase(user); }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null;
      userRef.current = u;
      if (u) loadFromSupabase(u);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    fetch('/api/fx').then(r => r.json()).then(d => { if (d.rate) setUsdJpy(d.rate); }).catch(() => {});
  }, []);

  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify({ cap: capFilter, sector: sectorFilter })); } catch {}
  }, [capFilter, sectorFilter]);

  useEffect(() => {
    if (tab !== 'watchlist') return;
    if (Object.keys(watchlist).length === 0) return;
    const lastRefreshed = localStorage.getItem(WATCH_REFRESH_KEY);
    const isStale = !lastRefreshed || Date.now() - new Date(lastRefreshed) > WATCH_STALE_MS;
    if (isStale) refreshWatchlist();
  }, [tab]);

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
    setFundData(null);
    setEnrichLoading(true);
    try {
      const [geminiRes, fundRes] = await Promise.allSettled([
        fetch('/api/gemini-enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: row.ticker, name: row.name }) }).then(r => r.json()),
        fetch('/api/fundamentals',  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: row.ticker }) }).then(r => r.json()),
      ]);
      setEnrichData(geminiRes.status === 'fulfilled' ? geminiRes.value : { error: geminiRes.reason?.message });
      if (fundRes.status === 'fulfilled' && !fundRes.value.error) setFundData(fundRes.value);
    } catch (e) {
      setEnrichData({ error: e.message });
    }
    setEnrichLoading(false);
  }

  async function toggleWatch(row) {
    const next = { ...watchlist };
    const removing = !!next[row.ticker];
    if (removing) { delete next[row.ticker]; }
    else { next[row.ticker] = { ...row, savedAt: new Date().toISOString() }; }
    setWatchlist(next);
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch {}
    const u = userRef.current;
    if (u) {
      if (removing) {
        await supabase.from('watchlist').delete()
          .eq('user_id', u.id).eq('list_type', LIST_TYPE).eq('ticker', row.ticker);
      } else {
        const { ticker, name, savedAt: _s, ...data } = next[row.ticker];
        await supabase.from('watchlist').upsert({
          user_id: u.id, list_type: LIST_TYPE, ticker, name: name || ticker, data,
        }, { onConflict: 'user_id,list_type,ticker' });
      }
    }
  }

  function handleBuyToggle(ticker) {
    if (buyingTicker === ticker || ticker === null) {
      setBuyingTicker(null);
      setBuyForm({ avgCost: '', shares: '' });
    } else {
      setBuyingTicker(ticker);
      setBuyForm({ avgCost: '', shares: '' });
    }
  }

  function addToPortfolio(row, avgCost, shares) {
    try {
      const stored = localStorage.getItem('us_portfolio_v1');
      const portfolio = stored ? JSON.parse(stored) : {};
      portfolio[row.ticker] = { ...row, avgCost: parseFloat(avgCost), holdingShares: parseFloat(shares), savedAt: Date.now() };
      localStorage.setItem('us_portfolio_v1', JSON.stringify(portfolio));
      window.location.href = '/portfolio';
    } catch {}
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
        const now = new Date().toISOString();
        setWatchRefreshedAt(now);
        localStorage.setItem(WATCH_REFRESH_KEY, now);
      }
    } catch {}
    setWatchRefreshing(false);
  }

  const capRanges = {
    all:   { min: 0,    max: Infinity },
    micro: { min: 1e9,  max: 2e9   },  // $1B–$2B Micro-Cap（×1.2 マルチプライヤー対象）
    small: { min: 2e9,  max: 1e10  },  // $2B–$10B Small-Cap
    mid:   { min: 1e10, max: 5e10  },  // $10B–$50B Mid-Cap
    large: { min: 5e10, max: 1.5e11 }, // $50B–$150B Large-Cap
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
  const baseRows     = tab === 'scan' ? filteredRows : watchRows;

  const US_SORT_KEY_MAP = {
    'ティッカー':   r => r.ticker,
    '価格 (USD)':   r => r.regularMarketPrice ?? r.price ?? 0,
    '前日比':       r => r.regularMarketChangePercent ?? r.dayChangePct ?? 0,
    '52W高値比':    r => r.high52Pct ?? 0,
    '出来高比':     r => r.volRatio ?? 0,
    '時価総額':     r => r.marketCap ?? 0,
    'Rev YoY':      r => r.revenueGrowthYoy ?? 0,
    'Gross Mg':     r => r.grossMargin ?? 0,
    'スコア':       r => r.score ?? 0,
  };

  function handleSort(col) {
    if (!US_SORT_KEY_MAP[col]) return;
    if (sortField === col) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(col);
      setSortDir('desc');
    }
  }

  const displayRows = sortField && US_SORT_KEY_MAP[sortField]
    ? [...baseRows].sort((a, b) => {
        const va = US_SORT_KEY_MAP[sortField](a);
        const vb = US_SORT_KEY_MAP[sortField](b);
        if (va < vb) return sortDir === 'desc' ? 1 : -1;
        if (va > vb) return sortDir === 'desc' ? -1 : 1;
        return 0;
      })
    : baseRows;

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 1rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <style>{`
        @keyframes buyPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(21,128,61,0.45); }
          50%       { box-shadow: 0 0 0 5px rgba(21,128,61,0); }
        }
        .buy-pulse { animation: buyPulse 1.8s ease-in-out infinite; }
        .yf-chart-link { transition: color 0.15s, opacity 0.15s; }
        .yf-chart-link:hover { color: #C9A84C !important; opacity: 1 !important; text-decoration: underline; }
        th.sortable-th { transition: background 0.15s, color 0.15s; cursor: pointer; user-select: none; }
        th.sortable-th:hover { background: #1a3a6a !important; color: #F0C040 !important; }
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
            style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', maxWidth: 440, width: '100%', boxShadow: '0 16px 60px rgba(0,0,0,0.35)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
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
                <a href={`https://finance.yahoo.co.jp/quote/${enrichRow.ticker}/chart`} target="_blank" rel="noopener noreferrer"
                  className="yf-chart-link"
                  style={{ fontSize: 10, color: '#64748B' }}>📈 Chart ↗</a>
              </div>
            </div>
            {/* Body */}
            <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
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
                  <div style={{ marginBottom: fundData ? 18 : 0 }}>
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
                  {/* 経営実態 */}
                  {fundData && (() => {
                    const enhancedScore = calcScore({
                      ...enrichRow,
                      revenueGrowthYoy: fundData.revenueGrowthYoy,
                      grossMargin: fundData.grossMargin,
                    });
                    const eRank = scoreRank(enhancedScore);
                    return (
                    <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#7C3AED', marginBottom: 10 }}>FUNDAMENTALS — 経営実態</div>
                      {/* 詳細スコアバッジ */}
                      <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 2 }}>スキャン時スコア</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#64748B' }}>{enrichRow.score}pt</div>
                        </div>
                        <div style={{ fontSize: 20, color: '#CBD5E1' }}>→</div>
                        <div>
                          <div style={{ fontSize: 9, color: '#7C3AED', fontWeight: 700, marginBottom: 2 }}>ファンダ込みスコア</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 20, fontWeight: 800, color: eRank.color }}>{enhancedScore}pt</span>
                            <span style={{ fontSize: 13, fontWeight: 800, background: eRank.bg, color: eRank.color, border: `1px solid ${eRank.border}`, padding: '2px 7px', borderRadius: 5 }}>{eRank.rank}</span>
                          </div>
                        </div>
                      </div>
                      {/* 成長指標グリッド */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                        {/* Revenue Growth YoY */}
                        <div style={{ background: fundData.revenueGrowthYoy != null ? (fundData.revenueGrowthYoy >= 50 ? '#ECFDF5' : fundData.revenueGrowthYoy >= 20 ? '#FFFBEB' : '#F8FAFC') : '#F8FAFC', borderRadius: 8, padding: '10px 10px', border: fundData.revenueGrowthYoy >= 50 ? '1px solid #86EFAC' : '1px solid transparent' }}>
                          <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 4, fontWeight: 600 }}>売上成長率 YoY ★</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: fundData.revenueGrowthYoy != null ? (fundData.revenueGrowthYoy >= 30 ? '#15803D' : fundData.revenueGrowthYoy >= 10 ? '#D97706' : '#64748B') : '#CBD5E1' }}>
                            {fundData.revenueGrowthYoy != null ? (fundData.revenueGrowthYoy >= 0 ? '+' : '') + fundData.revenueGrowthYoy.toFixed(1) + '%' : '—'}
                          </div>
                          {fundData.revenueGrowthYoy != null && <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2, color: fundData.revenueGrowthYoy >= 50 ? '#15803D' : fundData.revenueGrowthYoy >= 30 ? '#D97706' : '#94A3B8' }}>
                            {fundData.revenueGrowthYoy >= 50 ? '+45pt ★最優先' : fundData.revenueGrowthYoy >= 30 ? '+30pt' : fundData.revenueGrowthYoy >= 20 ? '+15pt' : fundData.revenueGrowthYoy >= 10 ? '+6pt' : '+0pt'}
                          </div>}
                        </div>
                        {/* Gross Margin */}
                        <div style={{ background: fundData.grossMargin != null ? (fundData.grossMargin >= 70 ? '#ECFDF5' : fundData.grossMargin >= 50 ? '#FFFBEB' : '#F8FAFC') : '#F8FAFC', borderRadius: 8, padding: '10px 10px' }}>
                          <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 4, fontWeight: 600 }}>グロス利益率</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: fundData.grossMargin != null ? (fundData.grossMargin >= 70 ? '#15803D' : fundData.grossMargin >= 50 ? '#D97706' : '#64748B') : '#CBD5E1' }}>
                            {fundData.grossMargin != null ? fundData.grossMargin.toFixed(1) + '%' : '—'}
                          </div>
                          {fundData.grossMargin != null && <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2, color: fundData.grossMargin >= 70 ? '#15803D' : fundData.grossMargin >= 50 ? '#D97706' : '#94A3B8' }}>
                            {fundData.grossMargin >= 70 ? '+20pt SaaS級' : fundData.grossMargin >= 50 ? '+10pt' : fundData.grossMargin >= 30 ? '+4pt' : '+0pt'}
                          </div>}
                        </div>
                      </div>
                      {/* 財務健全性グリッド */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                        {/* ROE */}
                        <div style={{ background: fundData.roe >= 10 ? '#ECFDF5' : '#F8FAFC', borderRadius: 8, padding: '10px 10px' }}>
                          <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 4, fontWeight: 600 }}>ROE</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: fundData.roe != null ? (fundData.roe >= 10 ? '#15803D' : '#64748B') : '#CBD5E1' }}>
                            {fundData.roe != null ? fundData.roe.toFixed(1) + '%' : '—'}
                          </div>
                          {fundData.roe != null && <div style={{ fontSize: 9, color: fundData.roe >= 10 ? '#15803D' : '#94A3B8', marginTop: 2 }}>{fundData.roe >= 10 ? '✓ 優秀' : fundData.roe >= 5 ? '普通' : '低い'}</div>}
                        </div>
                        {/* 自己資本比率 */}
                        <div style={{ background: fundData.capitalRatio != null ? (fundData.capitalRatio >= 40 ? '#ECFDF5' : fundData.capitalRatio < 20 ? '#FEF2F2' : '#F8FAFC') : '#F8FAFC', borderRadius: 8, padding: '10px 10px' }}>
                          <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 4, fontWeight: 600 }}>自己資本比率</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: fundData.capitalRatio != null ? (fundData.capitalRatio >= 40 ? '#15803D' : fundData.capitalRatio < 20 ? '#DC2626' : '#64748B') : '#CBD5E1' }}>
                            {fundData.capitalRatio != null ? fundData.capitalRatio + '%' : '—'}
                          </div>
                          {fundData.capitalRatio != null && <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2, color: fundData.capitalRatio >= 40 ? '#15803D' : fundData.capitalRatio < 20 ? '#DC2626' : '#94A3B8' }}>
                            {fundData.capitalRatio >= 40 ? '🔵 Safe' : fundData.capitalRatio < 20 ? '🔴 Risk' : '⚪ 普通'}
                          </div>}
                        </div>
                        {/* インサイダー保有 */}
                        <div style={{ background: fundData.insiderOwnership != null && fundData.insiderOwnership >= 30 ? '#FEF9C3' : '#F8FAFC', borderRadius: 8, padding: '10px 10px' }}>
                          <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 4, fontWeight: 600 }}>インサイダー</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: fundData.insiderOwnership != null ? (fundData.insiderOwnership >= 30 ? '#92400E' : '#64748B') : '#CBD5E1' }}>
                            {fundData.insiderOwnership != null ? fundData.insiderOwnership.toFixed(1) + '%' : '—'}
                          </div>
                          {fundData.insiderOwnership != null && <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2, color: fundData.insiderOwnership >= 30 ? '#92400E' : '#94A3B8' }}>
                            {fundData.insiderOwnership >= 30 ? '🏆 オーナー型' : fundData.insiderOwnership >= 10 ? '普通' : '低い'}
                          </div>}
                        </div>
                      </div>
                    </div>
                    );
                  })()}
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
            <div style={{ fontSize: 11, letterSpacing: 3, color: GOLD, fontWeight: 700, marginBottom: 6 }}>US STOCK SCREENER</div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 26, fontWeight: 700 }}>💵 ドルドルくん</h1>
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
          <option value="all">規模: すべて ($1B–$150B)</option>
          <option value="micro">Micro-Cap ($1B–$2B) ×1.2 ボーナス</option>
          <option value="small">Small-Cap ($2B–$10B)</option>
          <option value="mid">Mid-Cap ($10B–$50B)</option>
          <option value="large">Large-Cap ($50B–$150B)</option>
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

      {/* Disclaimer */}
      {tab === 'scan' && scanResults.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 11, color: '#94A3B8', lineHeight: 1.6 }}>
          ⚠️ スコア・ランクは仮説モデルによる参考値です。バックテストは未実施であり、将来の利益を保証するものではありません。投資判断はご自身の責任で行ってください。
        </div>
      )}

      {/* STEP indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 5, background: tab === 'scan' ? GOLD : '#F1F5F9', color: tab === 'scan' ? NAVY : '#94A3B8' }}>STEP ①</span>
          <span style={{ fontSize: 11, color: tab === 'scan' ? NAVY : '#94A3B8', fontWeight: tab === 'scan' ? 700 : 400 }}>スキャン</span>
          {tab === 'scan' && <span style={{ fontSize: 9, color: GOLD, fontWeight: 700 }}>◀ 現在地</span>}
        </div>
        <span style={{ color: '#CBD5E1', fontSize: 11 }}>→</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 5, background: tab === 'watchlist' ? GOLD : '#F1F5F9', color: tab === 'watchlist' ? NAVY : '#94A3B8' }}>STEP ②</span>
          <span style={{ fontSize: 11, color: tab === 'watchlist' ? NAVY : '#94A3B8', fontWeight: tab === 'watchlist' ? 700 : 400 }}>ウォッチ</span>
          {tab === 'watchlist' && <span style={{ fontSize: 9, color: GOLD, fontWeight: 700 }}>◀ 現在地</span>}
        </div>
        <span style={{ color: '#CBD5E1', fontSize: 11 }}>→</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <a href="/portfolio" style={{ textDecoration: 'none' }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 5, background: '#F1F5F9', color: '#94A3B8' }}>STEP ③</span>
          </a>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>ポートフォリオ</span>
        </div>
      </div>

      {/* Stale warning */}
      {tab === 'watchlist' && watchRows.length > 0 && watchRefreshedAt && Date.now() - new Date(watchRefreshedAt) > WATCH_STALE_MS && (
        <div style={{ marginBottom: 12, padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, fontSize: 12, color: '#92400E', display: 'flex', alignItems: 'center', gap: 8 }}>
          ⚠️ データが1時間以上古くなっています。「価格を更新」ボタンを押してください。
        </div>
      )}

      {/* Results */}
      {displayRows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94A3B8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>
            {tab === 'watchlist' ? '⭐' : scannedAt ? '🔎' : '🔍'}
          </div>
          {tab === 'watchlist' ? (
            <p style={{ fontSize: 14 }}>★ボタンで銘柄をウォッチリストに追加してください</p>
          ) : scannedAt ? (
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
                マルチバガー候補が見つかりませんでした
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.7, maxWidth: 360, margin: '0 auto', color: '#94A3B8' }}>
                時価総額 $1B〜$150B かつ 売上成長率 +15% 以上の条件を<br />
                満たす52週高値圏の銘柄が現在存在しません。<br />
                時間をおいて再スキャンしてください。
              </p>
            </div>
          ) : (
            <p style={{ fontSize: 14 }}>「52週高値スキャン実行」ボタンを押すと、52週高値圏の銘柄が表示されます</p>
          )}
        </div>
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {displayRows.map(r => (
            <ScanCard key={r.ticker} row={r} watchlist={watchlist} onWatch={toggleWatch} usdJpy={usdJpy} onEnrich={openEnrich}
              isWatchTab={tab === 'watchlist'} buyingTicker={buyingTicker} onBuyToggle={handleBuyToggle}
              buyForm={buyForm} onBuyFormChange={(f, v) => setBuyForm(p => ({ ...p, [f]: v }))}
              onBuySubmit={r => addToPortfolio(r, buyForm.avgCost, buyForm.shares)} />
          ))}
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'fixed', right: 64, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 6, zIndex: 100 }}>
            <button onClick={() => tableScrollRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
              style={{ fontSize: 15, width: 36, height: 36, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', color: '#555', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>◀</button>
            <button onClick={() => tableScrollRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
              style={{ fontSize: 15, width: 36, height: 36, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', color: '#555', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>▶</button>
          </div>
        <div ref={tableScrollRef} style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: NAVY, color: '#fff' }}>
                {['', 'ティッカー', '価格 (USD)', 'JPY換算', '前日比', '52W高値比', '出来高比', '時価総額', 'Rev YoY', 'Gross Mg', 'シグナル'].map(h => {
                  const sortable = !!US_SORT_KEY_MAP[h];
                  const isActive = sortField === h;
                  const arrow = isActive ? (sortDir === 'desc' ? ' ▼' : ' ▲') : (sortable ? ' ⇅' : '');
                  return (
                    <th key={h} onClick={sortable ? () => handleSort(h) : undefined}
                      className={sortable ? 'sortable-th' : undefined}
                      style={{ padding: '10px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', color: isActive ? GOLD2 : '#fff' }}>
                      {h}{arrow}
                    </th>
                  );
                })}
                <th onClick={() => handleSort('スコア')} className="sortable-th"
                  style={{ padding: '10px 10px', textAlign: 'left', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', color: sortField === 'スコア' ? GOLD2 : '#fff' }}>
                  <ScoreHeaderPopover />{sortField === 'スコア' ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ' ⇅'}
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, i) => (
                <ScanRow key={r.ticker} row={r} rank={i + 1} watchlist={watchlist} onWatch={toggleWatch} usdJpy={usdJpy} onEnrich={openEnrich}
                  isWatchTab={tab === 'watchlist'} buyingTicker={buyingTicker} onBuyToggle={handleBuyToggle}
                  buyForm={buyForm} onBuyFormChange={(f, v) => setBuyForm(p => ({ ...p, [f]: v }))}
                  onBuySubmit={r => addToPortfolio(r, buyForm.avgCost, buyForm.shares)} />
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* Signal legend */}
      {displayRows.length > 0 && (
        <details style={{ marginTop: 20 }}>
          <summary style={{ fontSize: 12, color: '#94A3B8', cursor: 'pointer', userSelect: 'none' }}>シグナル凡例</summary>
          <div style={{ marginTop: 10, fontSize: 12 }}>
            {[
              {
                group: '📈 買いシグナル',
                items: [
                  { badge: '🟢 買い',    bg: '#DCFCE7', color: '#15803D', border: '#86EFAC',    desc: 'スコア70以上・過熱なし' },
                  { badge: '🔴 突破',    bg: '#F1F5F9', color: '#DC2626', border: '#FECACA',    desc: '高値圏×出来高1.5倍超×上昇' },
                  { badge: '🔵 押し目',  bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE',    desc: '高値圏から2〜10%の押し戻し' },
                  { badge: '📈 RS',      bg: '#EFF6FF', color: '#1D4ED8', border: '#93C5FD',    desc: 'QQQ比1.5倍超のリターン' },
                ],
              },
              {
                group: '⚠️ 注意シグナル',
                items: [
                  { badge: '🟡 過熱',    bg: '#FEF9C3', color: '#A16207', border: '#FDE047',    desc: '50日線から30%超乖離・新規見送り' },
                  { badge: '⏳ 決算近',  bg: '#FEF3C7', color: '#D97706', border: '#FDE68A',    desc: '7日以内に決算発表・急騰急落リスク' },
                ],
              },
              {
                group: '→ ウォッチ状態',
                items: [
                  { badge: '→ 待機中',           bg: '#F8FAFC', color: '#64748B', border: '#CBD5E1', desc: 'エントリーサインまだ出ていない。出来高急増まで待つ' },
                  { badge: '→ もう少し待て',     bg: '#F8FAFC', color: '#64748B', border: '#CBD5E1', desc: '高値圏キープ中だがサインはまだ。出来高が急増するまで待つ' },
                  { badge: '🚀 今すぐエントリー', bg: 'linear-gradient(135deg,#16A34A,#15803D)', color: '#fff', border: '#4ADE80', desc: '大出来高で52W高値突破。買ったその日に逆指値を入れる' },
                  { badge: '↓ ウォッチ外す候補', bg: '#FEF2F2', color: '#DC2626', border: '#FECACA', desc: '大出来高でサポート割れ。エントリーせず外すことを検討' },
                ],
              },
              {
                group: 'ℹ️ その他',
                items: [
                  { badge: '💎 割安',       bg: '#F5F3FF', color: '#7C3AED', border: '#DDD6FE', desc: 'PBR 1.0倍未満・純資産以下で割安' },
                  { badge: '🏝️ アイランド底', bg: '#ECFEFF', color: '#0891B2', border: '#A5F3FC', desc: 'ギャップダウン→孤立→ギャップアップ反転' },
                ],
              },
            ].map(g => (
              <div key={g.group} style={{ marginBottom: 10, border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '6px 14px', background: '#F8FAFC', fontSize: 11, fontWeight: 700, color: '#64748B', borderBottom: '1px solid #E2E8F0' }}>{g.group}</div>
                {g.items.map((row, i) => (
                  <div key={row.badge} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: i % 2 === 0 ? '#fff' : '#FAFAFA', borderTop: i > 0 ? '1px solid #F1F5F9' : 'none' }}>
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, background: row.bg, color: row.color, border: `1px solid ${row.border}`, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, minWidth: 70, textAlign: 'center' }}>
                      {row.badge}
                    </span>
                    <span style={{ color: '#64748B' }}>{row.desc}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}
