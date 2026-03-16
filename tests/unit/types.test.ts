import { describe, it, expect } from 'vitest';
import {
  priceFromDecimal, priceToDecimal, volumeFrom,
  type Position, type AccountBalance, type TradeResult, type Quote,
  type InstrumentSearchResult, type TradeOptions,
  Xs6Side, TradeCommand, SubscriptionEid,
} from '../../src/index.js';

describe('Type safety', () => {
  it('Position type has all required fields', () => {
    const pos: Position = {
      symbol: 'CIG.PL',
      volume: 7,
      currentPrice: 2.56,
      openPrice: 2.585,
      profitPercent: -0.97,
      profitNet: -0.18,
      side: 'buy',
    };
    expect(pos.symbol).toBe('CIG.PL');
    expect(pos.side).toBe('buy');
  });

  it('Position type with optional fields', () => {
    const pos: Position = {
      symbol: 'AAPL.US',
      volume: 1,
      currentPrice: 180.5,
      openPrice: 175.0,
      profitPercent: 3.14,
      profitNet: 5.5,
      side: 'buy',
      stopLoss: 170,
      takeProfit: 200,
      swap: -0.02,
      orderId: '123456',
      commission: 0.5,
      margin: 175,
      openTime: Date.now(),
    };
    expect(pos.stopLoss).toBe(170);
    expect(pos.takeProfit).toBe(200);
  });

  it('AccountBalance type', () => {
    const bal: AccountBalance = {
      balance: 208.48,
      equity: 208.48,
      freeMargin: 208.48,
      currency: 'PLN',
      accountNumber: 12345678,
    };
    expect(bal.balance).toBe(bal.equity);
    expect(bal.currency).toBe('PLN');
  });

  it('TradeResult success', () => {
    const result: TradeResult = {
      success: true,
      symbol: 'CIG.PL',
      side: 'buy',
      volume: 1,
      price: 2.55,
      orderId: '12345',
    };
    expect(result.success).toBe(true);
  });

  it('TradeResult failure', () => {
    const result: TradeResult = {
      success: false,
      symbol: 'CIG.PL',
      side: 'buy',
      error: 'Insufficient funds',
    };
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('Quote type', () => {
    const quote: Quote = {
      symbol: 'CIG.PL',
      ask: 2.585,
      bid: 2.55,
      spread: 0.035,
    };
    expect(quote.ask).toBeGreaterThan(quote.bid);
    expect(quote.spread).toBeCloseTo(quote.ask - quote.bid);
  });

  it('TradeOptions type', () => {
    const opts: TradeOptions = {
      stopLoss: 2.40,
      takeProfit: 3.00,
    };
    expect(opts.stopLoss).toBeLessThan(opts.takeProfit!);
  });

  it('InstrumentSearchResult type', () => {
    const result: InstrumentSearchResult = {
      symbol: 'CIG.PL',
      instrumentId: 9438,
      name: 'CI Games',
      description: 'CIG.PL, CI Games SA',
      assetClass: 'STC',
      symbolKey: '9_CIG.PL_6',
    };
    expect(result.symbolKey).toContain(result.symbol);
  });
});

describe('Price/Volume conversions for trading', () => {
  it('round-trips price conversion', () => {
    const prices = [2.55, 150.75, 0.01, 1000.00, 3.141];
    for (const price of prices) {
      const encoded = priceFromDecimal(price, 3);
      const decoded = priceToDecimal(encoded);
      expect(decoded).toBeCloseTo(price, 2);
    }
  });

  it('handles SL/TP price for PLN stocks', () => {
    const buyPrice = 2.55;
    const sl = priceFromDecimal(buyPrice * 0.95, 3); // 5% SL
    const tp = priceFromDecimal(buyPrice * 1.10, 3); // 10% TP
    expect(priceToDecimal(sl)).toBeCloseTo(2.4225, 2);
    expect(priceToDecimal(tp)).toBeCloseTo(2.805, 2);
  });

  it('handles volume for fractional shares', () => {
    const vol = volumeFrom(1, 0); // 1 share
    expect(vol).toEqual({ value: 1, scale: 0 });

    const volFrac = volumeFrom(5, 2); // 0.05 lots
    expect(volFrac).toEqual({ value: 5, scale: 2 });
  });
});
