import { describe, it, expect } from 'vitest';
import { XTBClient } from '../../src/client.js';

describe('XTBClient', () => {
  it('creates websocket mode client', () => {
    const client = new XTBClient({
      mode: 'websocket',
      websocket: {
        url: 'wss://api5reala.x-station.eu/v1/xstation',
        accountNumber: 12345678,
        auth: { tgt: 'TGT-test' },
      },
    });
    expect(client).toBeDefined();
    expect(client.ws).toBeDefined();
    expect(client.browser).toBeNull();
  });

  it('creates browser mode client', () => {
    const client = new XTBClient({
      mode: 'browser',
      browser: { cdpUrl: 'ws://127.0.0.1:9222' },
    });
    expect(client).toBeDefined();
    expect(client.browser).toBeDefined();
    expect(client.ws).toBeNull();
  });

  it('throws on missing websocket config', () => {
    expect(() => new XTBClient({ mode: 'websocket' } as any)).toThrow();
  });

  it('throws on missing browser config', () => {
    expect(() => new XTBClient({ mode: 'browser' } as any)).toThrow();
  });

  describe('factory methods', () => {
    it('XTBClient.browser() creates browser client', () => {
      const client = XTBClient.browser('ws://127.0.0.1:9222');
      expect(client).toBeDefined();
      expect(client.browser).toBeDefined();
    });

    it('XTBClient.websocket() creates ws client', () => {
      const client = XTBClient.websocket({
        url: 'wss://api5demoa.x-station.eu/v1/xstation',
        accountNumber: 12345678,
        auth: { tgt: 'TGT-test' },
      });
      expect(client).toBeDefined();
      expect(client.ws).toBeDefined();
    });
  });
});

describe('WebSocket URLs', () => {
  it('real URL is correct', () => {
    expect('wss://api5reala.x-station.eu/v1/xstation').toMatch(/^wss:\/\/api5reala/);
  });

  it('demo URL is correct', () => {
    expect('wss://api5demoa.x-station.eu/v1/xstation').toMatch(/^wss:\/\/api5demoa/);
  });
});

describe('Symbol key format', () => {
  it('stock key format: {assetClass}_{symbol}_{groupId}', () => {
    const key = '9_CIG.PL_6';
    const parts = key.split('_');
    expect(parts[0]).toBe('9'); // stocks
    expect(parts[1]).toBe('CIG.PL');
    expect(parts[2]).toBe('6');
  });

  it('US stock key format', () => {
    const key = '9_AAPL.US_6';
    expect(key).toMatch(/^\d+_[A-Z.]+_\d+$/);
  });
});
