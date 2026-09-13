import { describe, it, expect } from 'vitest';
import { calculateTotalCost, calculateTotalTokens, type UsageRecord } from './usageMath';

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  id: 'r1',
  timestamp: Date.now(),
  type: 'image',
  model: 'test-model',
  tokensUsed: 100,
  cost: 0.5,
  details: '',
  ...overrides,
});

describe('calculateTotalCost', () => {
  it('sums the cost field across records', () => {
    const history = [record({ cost: 0.5 }), record({ cost: 1.25 }), record({ cost: 0.1 })];
    expect(calculateTotalCost(history)).toBeCloseTo(1.85);
  });

  it('returns 0 for an empty history', () => {
    expect(calculateTotalCost([])).toBe(0);
  });
});

describe('calculateTotalTokens', () => {
  it('sums tokensUsed across records', () => {
    const history = [record({ tokensUsed: 100 }), record({ tokensUsed: 250 })];
    expect(calculateTotalTokens(history)).toBe(350);
  });

  it('returns 0 for an empty history', () => {
    expect(calculateTotalTokens([])).toBe(0);
  });
});
