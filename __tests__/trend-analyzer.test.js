import { describe, it, expect } from 'vitest';
import { getTrendMode } from '../src/lib/trend-analyzer.js';

const base = { price: 100, week52High: 100, volRatio: 1.0, dayChangePct: 0, ma50Dev: 5 };

describe('getTrendMode', () => {
  // ─── breakout ──────────────────────────────────────────────────────────────
  describe('breakout: 52W高値 + 大出来高 + 上昇', () => {
    it('高値圏 / volRatio 2x / +2% → breakout', () => {
      expect(getTrendMode({ ...base, price: 100, week52High: 100, volRatio: 2.0, dayChangePct: 2 })).toBe('breakout');
    });
    it('高値-0.1% / volRatio 1.5x / +0.6% → breakout', () => {
      expect(getTrendMode({ ...base, price: 99.9, week52High: 100, volRatio: 1.5, dayChangePct: 0.6 })).toBe('breakout');
    });
    it('高値圏だが出来高 1.4x → breakout 非適用', () => {
      expect(getTrendMode({ ...base, price: 100, week52High: 100, volRatio: 1.4, dayChangePct: 2 })).not.toBe('breakout');
    });
    it('高値圏・大出来高だが日次 +0.4% → breakout 非適用（> 0.5% が条件）', () => {
      expect(getTrendMode({ ...base, price: 100, week52High: 100, volRatio: 2.0, dayChangePct: 0.4 })).not.toBe('breakout');
    });
    it('高値から-0.2% → breakout 非適用（pct < -0.1 が条件）', () => {
      expect(getTrendMode({ ...base, price: 99.8, week52High: 100, volRatio: 2.0, dayChangePct: 2 })).not.toBe('breakout');
    });
  });

  // ─── exit ──────────────────────────────────────────────────────────────────
  describe('exit: 大出来高でサポート割れ', () => {
    it('volRatio 2.5x / -3% → exit', () => {
      expect(getTrendMode({ ...base, volRatio: 2.5, dayChangePct: -3 })).toBe('exit');
    });
    it('volRatio 2.0x / -2% → exit', () => {
      expect(getTrendMode({ ...base, volRatio: 2.0, dayChangePct: -2 })).toBe('exit');
    });
    it('volRatio 2.0x / -1.9% → exit 非適用（≤ -2% が条件）', () => {
      expect(getTrendMode({ ...base, volRatio: 2.0, dayChangePct: -1.9 })).not.toBe('exit');
    });
    it('MA50 割り込み(-4%) + volRatio 1.5x + -2% → exit（分配売り）', () => {
      expect(getTrendMode({ ...base, ma50Dev: -4, volRatio: 1.5, dayChangePct: -2 })).toBe('exit');
    });
    it('MA50 割り込みだが出来高 1.4x → exit 非適用', () => {
      expect(getTrendMode({ ...base, ma50Dev: -4, volRatio: 1.4, dayChangePct: -2 })).not.toBe('exit');
    });
  });

  // ─── holding ───────────────────────────────────────────────────────────────
  describe('holding: 高値圏 + 出来高枯渇', () => {
    it('高値-3% / volRatio 0.5x / 横ばい → holding', () => {
      expect(getTrendMode({ ...base, price: 97, week52High: 100, volRatio: 0.5, dayChangePct: 0 })).toBe('holding');
    });
    it('高値-4.5% / volRatio 0.8x / +0.1% → holding', () => {
      expect(getTrendMode({ ...base, price: 95.5, week52High: 100, volRatio: 0.8, dayChangePct: 0.1 })).toBe('holding');
    });
    it('高値-6% → holding 非適用（5%以内が条件）', () => {
      expect(getTrendMode({ ...base, price: 94, week52High: 100, volRatio: 0.5, dayChangePct: 0 })).toBeNull();
    });
    it('volRatio 0.9x → holding 非適用（≤ 0.8x が条件）', () => {
      expect(getTrendMode({ ...base, price: 97, week52High: 100, volRatio: 0.9, dayChangePct: 0 })).toBeNull();
    });
    it('高値-4% / 出来高枯渇 / 日次 -1.5% → holding 非適用（下落中）', () => {
      expect(getTrendMode({ ...base, price: 96, week52High: 100, volRatio: 0.5, dayChangePct: -1.5 })).toBeNull();
    });
  });

  // ─── null ──────────────────────────────────────────────────────────────────
  describe('null: 判定対象外', () => {
    it('平均出来高・横ばい → null', () => {
      expect(getTrendMode({ ...base, volRatio: 1.0, dayChangePct: 0.2 })).toBeNull();
    });
    it('week52High = 0 → null（pct 計算不能）', () => {
      expect(getTrendMode({ ...base, week52High: 0, volRatio: 0.5, dayChangePct: 0 })).toBeNull();
    });
    it('全フィールド未設定 → null', () => {
      expect(getTrendMode({})).toBeNull();
    });
  });
});
