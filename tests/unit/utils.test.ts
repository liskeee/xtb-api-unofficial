import { describe, it, expect } from 'vitest';
import { priceFromDecimal, priceToDecimal, volumeFrom, buildAccountId, parseSymbolKey } from '../../src/utils.js';

describe('priceFromDecimal', () => {
  it('converts 2.62 with precision 2', () => {
    expect(priceFromDecimal(2.62, 2)).toEqual({ value: 262, scale: 2 });
  });

  it('converts 150.5 with precision 1', () => {
    expect(priceFromDecimal(150.5, 1)).toEqual({ value: 1505, scale: 1 });
  });

  it('converts integer price', () => {
    expect(priceFromDecimal(100, 0)).toEqual({ value: 100, scale: 0 });
  });
});

describe('priceToDecimal', () => {
  it('converts { value: 262, scale: 2 } to 2.62', () => {
    expect(priceToDecimal({ value: 262, scale: 2 })).toBeCloseTo(2.62);
  });

  it('converts { value: 1505, scale: 1 } to 150.5', () => {
    expect(priceToDecimal({ value: 1505, scale: 1 })).toBeCloseTo(150.5);
  });
});

describe('volumeFrom', () => {
  it('creates volume with default scale 0', () => {
    expect(volumeFrom(19)).toEqual({ value: 19, scale: 0 });
  });

  it('creates volume with custom scale', () => {
    expect(volumeFrom(5, 2)).toEqual({ value: 5, scale: 2 });
  });
});

describe('buildAccountId', () => {
  it('builds meta1 account id', () => {
    expect(buildAccountId(12345678)).toBe('meta1_12345678');
  });

  it('builds custom endpoint account id', () => {
    expect(buildAccountId(12345678, 'demo1')).toBe('demo1_12345678');
  });
});

describe('parseSymbolKey', () => {
  it('parses standard symbol key', () => {
    expect(parseSymbolKey('9_CIG.PL_6')).toEqual({
      assetClassId: 9,
      symbolName: 'CIG.PL',
      groupId: 6,
    });
  });

  it('parses symbol with underscores in name', () => {
    expect(parseSymbolKey('9_SOME_TICKER_6')).toEqual({
      assetClassId: 9,
      symbolName: 'SOME_TICKER',
      groupId: 6,
    });
  });

  it('returns null for invalid key', () => {
    expect(parseSymbolKey('invalid')).toBeNull();
  });
});
