/**
 * calcScore: US株マルチバガー探索スコア (0-100)
 *
 * 優先順位:
 *   1. 売上成長率 (revenueGrowthYoy)  0-45pt — 最優先。fundamentals popup で取得
 *   2. 小型株プレミアム (marketCap)    0-25pt — $10B以下に傾斜
 *   3. グロス利益率 (grossMargin)      0-15pt — fundamentals popup で取得
 *   4. 52週高値近接                    0-10pt — ブレイクアウトタイミング確認
 *   5. PSR                             0-10pt — 成長株向けバリュエーション
 *   6. 出来高急増                       0-8pt — 機関参戦シグナル
 *   7. 前日上昇モメンタム               0-4pt — 短期モメンタム確認
 *
 * スキャン時点では revenueGrowthYoy / grossMargin は null のため最大 57pt。
 * fundamentals popup から取得後に再計算すると最大 100pt。
 *
 * 廃止: PBR / PER 重み（成長株は割高が当然のため除外）
 * 廃止: 大型株ボーナス（小型株プレミアムに逆転）
 */
export function calcScore(row) {
  let score = 0;

  // 1. 売上成長率 YoY (0-45pt) — 最優先
  // revenueGrowthYoy: % 単位 (50 = 50%)
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
    // $50B超 = 加点なし (mega/large cap)
  }

  // 3. グロス利益率 (0-15pt) — SaaS・ソフトウェアの高収益構造を評価
  // grossMargin: % 単位 (70 = 70%)
  const gm = row.grossMargin;
  if (gm != null) {
    if      (gm >= 70) score += 15;
    else if (gm >= 50) score += 8;
    else if (gm >= 30) score += 3;
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
  // PSR < 20 = 健全。>40 = バブル圏
  const psr = row.psr;
  if (psr != null && psr > 0) {
    if      (psr < 5)   score += 10;
    else if (psr < 10)  score += 7;
    else if (psr < 20)  score += 4;
    else if (psr < 40)  score += 1;
  }

  // 6. 出来高急増 (0-8pt) — 機関投資家参戦シグナル
  if (row.volAvg > 0) {
    const vr = row.volume / row.volAvg;
    if      (vr >= 4.0) score += 8;
    else if (vr >= 3.0) score += 6;
    else if (vr >= 2.0) score += 4;
    else if (vr >= 1.5) score += 2;
    else if (vr >= 1.2) score += 1;
  }

  // 7. 前日上昇モメンタム (0-4pt)
  const dc = row.dayChangePct || 0;
  if      (dc >= 7)  score += 4;
  else if (dc >= 5)  score += 3;
  else if (dc >= 3)  score += 2;
  else if (dc >= 1)  score += 1;

  return Math.min(100, score);
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
