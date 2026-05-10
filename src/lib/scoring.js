export function calcScore(row) {
  let score = 0;

  // 52-week high proximity (0-40 pts): closer = higher
  if (row.week52High > 0) {
    const pct = row.price / row.week52High;
    if (pct >= 1.0)        score += 40;
    else if (pct >= 0.99)  score += 35;
    else if (pct >= 0.97)  score += 25;
    else if (pct >= 0.95)  score += 15;
    else if (pct >= 0.90)  score += 5;
  }

  // Volume surge vs 10-day average (0-30 pts)
  if (row.volAvg > 0) {
    const vr = row.volume / row.volAvg;
    if (vr >= 4.0)       score += 30;
    else if (vr >= 3.0)  score += 24;
    else if (vr >= 2.0)  score += 17;
    else if (vr >= 1.5)  score += 10;
    else if (vr >= 1.2)  score += 5;
  }

  // Day change momentum (0-20 pts)
  const dc = row.dayChangePct || 0;
  if (dc >= 7)       score += 20;
  else if (dc >= 5)  score += 16;
  else if (dc >= 3)  score += 12;
  else if (dc >= 1)  score += 6;
  else if (dc >= 0)  score += 2;

  // Market cap reliability bonus (0-10 pts)
  const mc = row.marketCap || 0;
  if (mc >= 1e12)       score += 10;
  else if (mc >= 2e11)  score += 7;
  else if (mc >= 5e10)  score += 5;
  else if (mc >= 1e10)  score += 3;
  else if (mc >= 1e9)   score += 1;

  return score;
}
