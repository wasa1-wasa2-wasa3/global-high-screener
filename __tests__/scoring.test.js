import { describe, it, expect } from 'vitest';
import { calcScore, scoreRankLabel } from '../src/lib/scoring.js';

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function rank(score) {
  return scoreRankLabel(score);
}

// ─── 典型的マルチバガー候補 ───────────────────────────────────────────────────

describe('典型的マルチバガー候補（成長株）', () => {
  it('売上+50% / 時価総額$2B / PSR 15x → ランク A 以上', () => {
    const score = calcScore({
      revenueGrowthYoy: 50,
      marketCap: 2e9,
      psr: 15,
    });
    expect(score).toBeGreaterThanOrEqual(70);
    expect(['A', 'S']).toContain(rank(score));
  });

  it('売上+50% / 時価総額$2B / PSR 15x / 52W高値圏 / 出来高2x → ランク S', () => {
    const score = calcScore({
      revenueGrowthYoy: 50,
      marketCap: 2e9,
      psr: 15,
      price: 100,
      week52High: 101,  // ほぼ高値圏
      volume: 2000000,
      volAvg: 1000000,
    });
    expect(score).toBeGreaterThanOrEqual(80);
    expect(rank(score)).toBe('S');
  });

  it('売上+50% / 時価総額$2B / グロス利益率75% → ランク S', () => {
    const score = calcScore({
      revenueGrowthYoy: 50,
      marketCap: 2e9,
      grossMargin: 75,
    });
    expect(score).toBeGreaterThanOrEqual(80);
    expect(rank(score)).toBe('S');
  });
});

// ─── 売上成長率スコア ─────────────────────────────────────────────────────────

describe('revenueGrowthYoy ブラケット', () => {
  it('+50% → 45pt', () => {
    expect(calcScore({ revenueGrowthYoy: 50 })).toBe(45);
  });
  it('+49% → 30pt', () => {
    expect(calcScore({ revenueGrowthYoy: 49 })).toBe(30);
  });
  it('+30% → 30pt', () => {
    expect(calcScore({ revenueGrowthYoy: 30 })).toBe(30);
  });
  it('+20% → 15pt', () => {
    expect(calcScore({ revenueGrowthYoy: 20 })).toBe(15);
  });
  it('+10% → 6pt', () => {
    expect(calcScore({ revenueGrowthYoy: 10 })).toBe(6);
  });
  it('+9% → 0pt（10%未満は加算なし）', () => {
    expect(calcScore({ revenueGrowthYoy: 9 })).toBe(0);
  });
  it('null → 0pt', () => {
    expect(calcScore({ revenueGrowthYoy: null })).toBe(0);
  });
});

// ─── 小型株プレミアム ─────────────────────────────────────────────────────────

describe('marketCap 小型株プレミアム', () => {
  it('$2B → 30pt（超小型 × 1.2マルチプライヤー適用: 25×1.2=30）', () => {
    expect(calcScore({ marketCap: 2e9 })).toBe(30);
  });
  it('$2.1B → 20pt（$2-5B 小型）', () => {
    expect(calcScore({ marketCap: 2.1e9 })).toBe(20);
  });
  it('$5B → 20pt', () => {
    expect(calcScore({ marketCap: 5e9 })).toBe(20);
  });
  it('$5.1B → 14pt（$5-10B 中小型）', () => {
    expect(calcScore({ marketCap: 5.1e9 })).toBe(14);
  });
  it('$10B → 14pt', () => {
    expect(calcScore({ marketCap: 1e10 })).toBe(14);
  });
  it('$10.1B → 6pt（中型）', () => {
    expect(calcScore({ marketCap: 1.01e10 })).toBe(6);
  });
  it('$50B超 → 0pt（大型・加点なし）', () => {
    expect(calcScore({ marketCap: 5.1e10 })).toBe(0);
  });
  it('$1T（メガキャップ）→ 0pt', () => {
    expect(calcScore({ marketCap: 1e12 })).toBe(0);
  });
});

// ─── グロス利益率 ─────────────────────────────────────────────────────────────

describe('grossMargin ブラケット', () => {
  it('70% → 15pt', () => {
    expect(calcScore({ grossMargin: 70 })).toBe(15);
  });
  it('50% → 8pt', () => {
    expect(calcScore({ grossMargin: 50 })).toBe(8);
  });
  it('30% → 3pt', () => {
    expect(calcScore({ grossMargin: 30 })).toBe(3);
  });
  it('29% → 0pt', () => {
    expect(calcScore({ grossMargin: 29 })).toBe(0);
  });
  it('null → 0pt', () => {
    expect(calcScore({ grossMargin: null })).toBe(0);
  });
});

// ─── PSR ─────────────────────────────────────────────────────────────────────

describe('PSR ブラケット', () => {
  it('PSR < 5 → 10pt', () => {
    expect(calcScore({ psr: 4.9 })).toBe(10);
  });
  it('PSR 10 → 7pt（< 10）', () => {
    expect(calcScore({ psr: 9.9 })).toBe(7);
  });
  it('PSR 15 → 4pt（< 20）', () => {
    expect(calcScore({ psr: 15 })).toBe(4);
  });
  it('PSR 35 → 1pt（< 40）', () => {
    expect(calcScore({ psr: 35 })).toBe(1);
  });
  it('PSR 40 → 0pt', () => {
    expect(calcScore({ psr: 40 })).toBe(0);
  });
  it('null → 0pt', () => {
    expect(calcScore({ psr: null })).toBe(0);
  });
});

// ─── PBR/PER が存在しても加算されないこと（廃止の確認）────────────────────────

describe('PBR / PER は廃止 → スコアに影響なし', () => {
  const base = calcScore({});
  it('PBR を渡しても加点なし', () => {
    expect(calcScore({ pbr: 0.3 })).toBe(base);
  });
  it('PE を渡しても加点なし', () => {
    expect(calcScore({ pe: 10 })).toBe(base);
  });
  it('PBR 高くても減点なし', () => {
    expect(calcScore({ pbr: 50 })).toBe(base);
  });
});

// ─── スコア上限 ───────────────────────────────────────────────────────────────

describe('スコア上限', () => {
  it('全項目最大値でも 100 にクリップ', () => {
    expect(calcScore({
      revenueGrowthYoy: 100,
      marketCap: 1e9,
      grossMargin: 90,
      price: 100, week52High: 100,
      volume: 10000000, volAvg: 1000000,
      dayChangePct: 10,
      psr: 1,
    })).toBe(100);
  });
  it('全項目 null / 0 → 0', () => {
    expect(calcScore({})).toBe(0);
  });
});

// ─── $50B+ 大型株キャップ ─────────────────────────────────────────────────────

describe('$50B+ 大型株 → スコア強制上限 10 (D)', () => {
  it('$50.1B / Rev+50% / GrossMargin 90% → 最大 10pt', () => {
    const score = calcScore({
      marketCap: 5.01e10,
      revenueGrowthYoy: 50,
      grossMargin: 90,
      price: 100, week52High: 100,
      volume: 5000000, volAvg: 1000000,
    });
    expect(score).toBeLessThanOrEqual(10);
    expect(scoreRankLabel(score)).toBe('D');
  });
  it('$100B (メガキャップ) → 10pt 以下', () => {
    expect(calcScore({ marketCap: 1e11, revenueGrowthYoy: 50 })).toBeLessThanOrEqual(10);
  });
  it('$50B ちょうど → キャップ対象外（$50B以下）', () => {
    const score = calcScore({ marketCap: 5e10, revenueGrowthYoy: 50 });
    expect(score).toBeGreaterThan(10);
  });
  it('SKM相当 $15B / Rev低成長 → D（キャップなし、自然にD）', () => {
    const score = calcScore({ marketCap: 1.52e10, revenueGrowthYoy: 3, price: 100, week52High: 102 });
    expect(score).toBeLessThan(50);
    expect(scoreRankLabel(score)).toBe('D');
  });
});

// ─── ×1.2 超小型マルチプライヤー ─────────────────────────────────────────────

describe('≤$2B 超小型マルチプライヤー × 1.2', () => {
  it('Rev +50% / $1B → ×1.2 適用でランクS', () => {
    // 45 (rev) + 25 (cap) = 70 → ×1.2 = 84 → S
    const score = calcScore({ revenueGrowthYoy: 50, marketCap: 1e9 });
    expect(score).toBe(84);
    expect(scoreRankLabel(score)).toBe('S');
  });
  it('Rev +80% / $1B → ランク S（ユーザー指定テスト）', () => {
    // 45 + 25 = 70 → ×1.2 = 84 → S
    const score = calcScore({ revenueGrowthYoy: 80, marketCap: 1e9 });
    expect(score).toBeGreaterThanOrEqual(80);
    expect(scoreRankLabel(score)).toBe('S');
  });
  it('$2.1B → マルチプライヤー非適用（そのまま）', () => {
    // 25B超のブラケット境界: $2.1B → 20pt, no ×1.2
    expect(calcScore({ marketCap: 2.1e9 })).toBe(20);
  });
});

// ─── Rev YoY > 50% → 最低 B 保証 ─────────────────────────────────────────────

describe('Rev YoY > 50% → 最低ランク B (score ≥ 60)', () => {
  it('Rev 51% / marketCap なし → floor 発動 → 60pt', () => {
    // 45pt のみ → floor → 60
    const score = calcScore({ revenueGrowthYoy: 51 });
    expect(score).toBe(60);
    expect(scoreRankLabel(score)).toBe('B');
  });
  it('Rev 50% ちょうど → floor 対象外（>50% が条件）', () => {
    // 45pt → floor なし → 45
    expect(calcScore({ revenueGrowthYoy: 50 })).toBe(45);
  });
  it('Rev 70% / $15B → floor + $20B以下のため B を超えられる', () => {
    // 45+6 = 51 → floor → 60 → no $20B cap ($15B < $20B) → 60 → B
    const score = calcScore({ marketCap: 1.5e10, revenueGrowthYoy: 70 });
    expect(score).toBeGreaterThanOrEqual(60);
  });
});

// ─── $20B超 → B以下に制限 ────────────────────────────────────────────────────

describe('$20B超 → score ≤ 69 (B以下)', () => {
  it('$20.1B / 全指標最大 → Bキャップ (score = 69)', () => {
    // raw: 45+6+15+10+10+8+4 = 98 → cap → 69
    const score = calcScore({
      marketCap: 2.01e10,
      revenueGrowthYoy: 100, grossMargin: 90,
      price: 100, week52High: 100,
      volume: 5000000, volAvg: 1000000,
      dayChangePct: 10, psr: 1,
    });
    expect(score).toBe(69);
    expect(scoreRankLabel(score)).toBe('B');
  });
  it('$20B ちょうど → Bキャップ対象外（> 20B が条件）', () => {
    const score = calcScore({
      marketCap: 2e10,
      revenueGrowthYoy: 100, grossMargin: 90,
      price: 100, week52High: 100,
      volume: 5000000, volAvg: 1000000,
      dayChangePct: 10, psr: 1,
    });
    // raw = 98 → no cap → S
    expect(score).toBeGreaterThan(69);
  });
});

// ─── 成長効率ボーナス (Rev≥30% + PSR<15) ─────────────────────────────────────

describe('成長効率ボーナス: Rev YoY ≥ 30% かつ PSR < 15 → +8pt', () => {
  it('Rev 30% / PSR 10 → 30+7+8 = 45pt', () => {
    // Rev 30% → 30pt, PSR 9.9 → 7pt, bonus → 8pt
    expect(calcScore({ revenueGrowthYoy: 30, psr: 9.9 })).toBe(45);
  });
  it('Rev 30% / PSR 15 → ボーナス非適用（PSR < 15 が条件）', () => {
    // Rev 30% → 30pt, PSR 15 → 4pt, bonus なし
    expect(calcScore({ revenueGrowthYoy: 30, psr: 15 })).toBe(34);
  });
  it('Rev 29% / PSR 10 → ボーナス非適用（Rev < 30% が条件）', () => {
    // Rev 29% → 15pt, PSR 9.9 → 7pt, bonus なし
    expect(calcScore({ revenueGrowthYoy: 29, psr: 9.9 })).toBe(22);
  });
  it('Rev 50% / PSR 5 / $2B → ×1.2 適用 → ランク S', () => {
    // 45+25+10+8 = 88 → ×1.2 = 100 → S
    const score = calcScore({ revenueGrowthYoy: 50, marketCap: 2e9, psr: 4.9 });
    expect(score).toBe(100);
    expect(scoreRankLabel(score)).toBe('S');
  });
  it('Rev null → ボーナス非適用', () => {
    expect(calcScore({ psr: 4.9 })).toBe(10); // PSR 10pt only, bonus needs Rev≥30%
  });
  it('PSR null → ボーナス非適用', () => {
    expect(calcScore({ revenueGrowthYoy: 50 })).toBe(45); // Rev 45pt only
  });
});
