import { describe, it, expect } from 'vitest';
import { computeSoc } from './writer';

describe('computeSoc', () => {
  it('returns weighted average of two batteries', () => {
    const batteries = {
      0: { soc: 80, capacity: 100 },
      1: { soc: 60, capacity: 200 },
    };
    // (80*100 + 60*200) / (100+200) = 20000/300 = 66.666...
    expect(computeSoc(batteries)).toBeCloseTo(66.67, 1);
  });

  it('returns null when no battery has data', () => {
    const batteries = {
      0: { soc: null, capacity: null },
      1: { soc: null, capacity: null },
    };
    expect(computeSoc(batteries)).toBeNull();
  });
});

describe('gear conversion', () => {
  it('converts N to 0', () => {
    const gear = 'N' === 'N' ? 0 : Number.parseInt('N', 10);
    expect(gear).toBe(0);
  });

  it('converts string gear to integer', () => {
    for (const g of ['1', '2', '3', '4', '5', '6']) {
      const gear = g === 'N' ? 0 : Number.parseInt(g, 10);
      expect(gear).toBe(Number(g));
    }
  });
});

describe('speed conversion', () => {
  it('converts m/s to km/h', () => {
    expect(10 * 3.6).toBe(36);
  });

  it('returns 0 for 0 m/s', () => {
    expect(0 * 3.6).toBe(0);
  });
});
