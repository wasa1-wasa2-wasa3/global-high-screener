/**
 * calcScore: US株マルチバガー探索スコア (0-100)
 *
 * 加点ブラケット（Phase 3 でスキャン時に全データ取得済み）:
 *   1. 売上成長率 YoY      0-45pt  最優先
 *   2. 小型株プレミアム    0-25pt  $10B以下に傾斜
 *   3. グロス利益率        0-20pt
 *   4. 52週高値近接        0-10pt
 *   5. PSR                 0-10pt
 *   6. 出来高急増          0-5pt
 *   7. 前日モメンタム      0-2pt
 *   8. 成長効率ボーナス    0-8pt   Rev≥30% かつ PSR<15（成長×割安）
 *   9. RS vs QQQ           0-8pt   1年相対強度
 *  10. Rule of 40          0-10pt  RevGrowth% + FCFMargin%（-5pt ペナルティあり）
 *
 * ポスト補正（加点後に適用）:
 *   A. ≤$2B 超小型マルチプライヤー × 1.2（Math.min(100,…) 前に適用）
 *   B. Rev YoY > 50% → 最低ランク B 保証（score ≥ 63）
 *   C. 品質アンカー: Rev≥20% かつ GM≥70% → 最低ランク B 保証（score ≥ 63）
 *   G. クロスファクター: mc < $10B かつ Rev YoY > 50% → 最低ランク A 保証（score ≥ 70）
 *   D. $20B超 → B以下に制限（score ≤ 55）
 *   E. $50B超 → 強制 D（score ≤ 10）
 */
export function calcScore(row) {
  let score = 0;

  // 1. 売上成長率 YoY (0-45pt) — 最優先
  const rg = row.revenueGrowthYoy;
  if (rg != null) {
    if      (rg >= 50) score += 45;
    else if (rg >= 30) score += 30;
    else if (rg >= 20) score += 15;
    else if (rg >= 10) score += 6;
  }

  // 2. 小型株プレミアム (0-25pt) — $10B以下を優遇、大型は加点なし
  const mc = row.marketCap || 0;
  if (mc > 0) {
    if      (mc <= 2e9)   score += 25;  // ~$2B 超小型
    else if (mc <= 5e9)   score += 20;  // $2-5B 小型
    else if (mc <= 1e10)  score += 14;  // $5-10B 中小型
    else if (mc <= 5e10)  score += 6;   // $10-50B 中型
  }

  // 3. グロス利益率 (0-20pt) — SaaS・ソフトウェアの高収益構造を評価
  const gm = row.grossMargin;
  if (gm != null) {
    if      (gm >= 70) score += 20;
    else if (gm >= 50) score += 10;
    else if (gm >= 30) score += 4;
  }

  // 4. 52週高値近接 (0-10pt) — ブレイクアウトタイミング
  if (row.week52High > 0) {
    const pct = row.price / row.week52High;
    if      (pct >= 1.0)  score += 10;
    else if (pct >= 0.99) score += 8;
    else if (pct >= 0.97) score += 5;
    else if (pct >= 0.95) score += 2;
  }

  // 5. PSR (Price-to-Sales Ratio, 0-10pt) — 成長株バリュエーション
  const psr = row.psr;
  if (psr != null && psr > 0) {
    if      (psr < 5)   score += 10;
    else if (psr < 10)  score += 7;
    else if (psr < 20)  score += 4;
    else if (psr < 40)  score += 1;
  }

  // 6. 出来高急増 (0-5pt) — 機関投資家参戦シグナル（ノイズ抑制のため上限削減）
  if (row.volAvg > 0) {
    const vr = row.volume / row.volAvg;
    if      (vr >= 4.0) score += 5;
    else if (vr >= 3.0) score += 3;
    else if (vr >= 2.0) score += 2;
    else if (vr >= 1.5) score += 1;
  }

  // 7. 前日上昇モメンタム (0-2pt) — 単日ノイズの影響を最小化
  const dc = row.dayChangePct || 0;
  if      (dc >= 5) score += 2;
  else if (dc >= 1) score += 1;

  // 8. 成長効率ボーナス (0-8pt): Rev YoY ≥ 30% かつ PSR < 15 = 成長に対して割安
  if ((rg || 0) >= 30 && psr != null && psr > 0 && psr < 15) score += 8;

  // 9. RS vs QQQ (0-8pt) — 1年相対強度
  const rs = row.rs;
  if (rs != null) {
    if      (rs >= 3.0) score += 8;
    else if (rs >= 2.0) score += 5;
    else if (rs >= 1.5) score += 3;
    else if (rs >= 1.0) score += 1;
  }

  // 10. Rule of 40 (0-10pt): RevGrowth% + FCFMargin% — 成長とキャッシュ創出の両立
  const r40 = row.ruleOf40;
  if (r40 != null) {
    if      (r40 >= 60) score += 10;
    else if (r40 >= 50) score += 7;
    else if (r40 >= 40) score += 5;
    else if (r40 >= 30) score += 2;
    else if (r40 < 0)   score = Math.max(0, score - 5);
  }

  // A. ≤$2B 超小型マルチプライヤー × 1.2（Math.min 前に適用して差別化を維持）
  if (mc > 0 && mc <= 2e9) score = Math.round(score * 1.2);

  let result = Math.min(100, score);

  // B. Rev YoY > 50% = 成長最優先 → 最低 B ランク保証（score ≥ 63、3pt マージン付き）
  if ((rg || 0) > 50 && result < 63) result = 63;

  // C. 品質アンカー: Rev≥20% かつ GM≥70% → 株価調整があっても最低 B を維持（score ≥ 63）
  if ((rg || 0) >= 20 && (gm || 0) >= 70 && result < 63) result = 63;

  // G. クロスファクター: mc < $10B かつ Rev YoY > 50% → 小型高成長の最低 A 保証（score ≥ 70）
  if (mc > 0 && mc < 1e10 && (rg || 0) > 50 && result < 70) result = 70;

  // D. $20B超 → B以下に制限（マルチバガー余地が限定的）
  if (mc > 2e10 && mc <= 5e10) result = Math.min(55, result);

  // E. $50B超 = マルチバガー不適格 → 強制 D（score ≤ 10）
  if (mc > 5e10) return Math.min(10, result);

  return result;
}

/**
 * scoreRankLabel: スコア → ランク文字列
 */
export function scoreRankLabel(score) {
  if (score >= 80) return 'S';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}
