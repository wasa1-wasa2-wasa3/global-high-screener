export function getSignals(row) {
  const signals = [];
  const vr = row.volAvg > 0 ? row.volume / row.volAvg : 0;

  // 🔴 Breakout: AT 52-week high + volume surge
  if (row.price >= row.week52High * 0.999 && vr >= 1.5 && row.dayChangePct > 0.5) {
    signals.push({ type: 'breakout', icon: '🔴', label: '突破', color: '#DC2626' });
  }

  // 🔵 Pullback: recently near 52w high, now pulled back 3–10%
  if (row.lastNearHighAt) {
    const daysSince = (Date.now() - new Date(row.lastNearHighAt)) / 86400000;
    const pullbackPct = (row.price / row.week52High - 1) * 100;
    if (daysSince <= 7 && pullbackPct >= -10 && pullbackPct < -2) {
      signals.push({ type: 'pullback', icon: '🔵', label: '押し目', color: '#2563EB' });
    }
  }

  // ⏳ Earnings within 7 days
  if (row.earningsDate) {
    const daysTo = (new Date(row.earningsDate) - Date.now()) / 86400000;
    if (daysTo >= 0 && daysTo <= 7) {
      signals.push({ type: 'earnings', icon: '⏳', label: '決算近', color: '#D97706' });
    }
  }

  if ((row.ma50Dev || 0) > 30) {
    signals.push({ type: 'overheated', icon: '⚠️', label: '過熱', color: '#9CA3AF' });
  }

  // 💎 Deep Value: PBR < 1.0 (ROE > 10% is verified in the fundamentals popup)
  if (row.pbr > 0 && row.pbr < 1.0) {
    signals.push({ type: 'deepValue', icon: '💎', label: '割安', color: '#7C3AED' });
  }

  // 🏝️ Island Reversal Bottom: gap-down → isolated island → gap-up reversal
  if (row.islandReversal) {
    signals.push({ type: 'island', icon: '🏝️', label: 'アイランド底', color: '#0891B2' });
  }

  const ma50d = row.ma50Dev || 0;
  const mc    = row.marketCap || 0;

  if (ma50d >= 0 && ma50d <= 25 && (row.volRatio || 0) >= 0.8 && (row.dayChangePct || 0) >= -3) {
    signals.push({ type: 'hold', icon: '✅', label: '保有継続', color: '#16A34A' });
  }

  if (ma50d > 40) {
    signals.push({ type: 'takeProfit', icon: '💰', label: '利確検討', color: '#EA580C' });
  }

  const stopThreshold = mc > 0 && mc < 2_000_000_000 ? -25 : -15;
  if (ma50d < stopThreshold) {
    signals.push({ type: 'stopLoss', icon: '🛑', label: 'テクニカル悪化', color: '#7F1D1D' });
  }

  if ((row.dividendYield || 0) >= 3.0) {
    signals.push({ type: 'highDividend', icon: '✨', label: '高配当', color: '#CA8A04' });
  }

  if (mc > 0 && mc <= 1_500_000_000) {
    signals.push({ type: 'micro', icon: '⚡', label: '超小型', color: '#6D28D9' });
  }

  return signals;
}
