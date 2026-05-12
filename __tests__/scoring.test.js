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
  it('$2B → 25pt（超小型）', () => {
    expect(calcScore({ marketCap: 2e9 })).toBe(25);
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
