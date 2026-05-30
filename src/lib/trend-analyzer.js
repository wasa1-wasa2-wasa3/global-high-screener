/**
 * getTrendMode: 確変ステータス判定
 *
 * - breakout : 52W高値を大出来高で突破（赤ランプ）
 * - holding  : 高値圏で出来高が枯渇している（緑ランプ）
 * - exit     : 大出来高でサポートを割った（黄ランプ）
 * - null     : 判定対象外
 *
 * volRatio = volume / volAvg (10日平均)
 */
export function getTrendMode({ price, week52High, volRatio, dayChangePct, ma50Dev }) {
  const vr  = volRatio    || 0;
  const dc  = dayChangePct || 0;
  const pct = week52High > 0 ? (price / week52High - 1) * 100 : null;

  // breakout: 52W高値到達 + 大出来高（1.5x以上）+ 上昇
  if (pct !== null && pct >= -0.1 && vr >= 2.0 && dc > 1.5) return 'breakout';

  // exit: 大出来高での急落（出来高2x以上 + 日次-2%以下）
  // または MA50 割り込みを大出来高で確認（分配売り）
  if (vr >= 2.0 && dc <= -2) return 'exit';
  if ((ma50Dev || 0) < -3 && vr >= 1.5 && dc < -1) return 'exit';

  // holding: 高値圏（52W高値の5%以内）+ 出来高枯渇（0.8x以下）+ 急落でない（-3%超）
  // 本質は「出来高の枯渇」なので -2% 程度の小幅安は保ち合いとして許容する
  if (pct !== null && pct >= -5 && vr <= 0.8 && dc > -3) return 'holding';

  return null;
}
