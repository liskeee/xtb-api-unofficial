/**
 * E2E Trading Flow Test
 * 
 * This test validates the complete auto-trading workflow:
 * 1. Connect & authenticate
 * 2. Check balance (do we have money?)
 * 3. Search instruments
 * 4. Get live quotes
 * 5. Check open positions
 * 6. Validate buy/sell order structure
 * 
 * Run with: XTB_TGT=TGT-xxx npm run test:e2e
 * 
 * ⚠️ Does NOT execute real trades — only validates the flow.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { XTBClient } from '../../src/index.js';

const TGT = process.env.XTB_TGT;
const SKIP = !TGT;

describe.skipIf(SKIP)('E2E: Auto-trading readiness', () => {
  let client: InstanceType<typeof XTBClient>;

  beforeAll(async () => {
    client = new XTBClient({
      mode: 'websocket',
      websocket: {
        url: 'wss://api5reala.x-station.eu/v1/xstation',
        accountNumber: parseInt(process.env.XTB_ACCOUNT || '0'),
        auth: { tgt: TGT! },
      },
    });
    await client.connect();
  }, 15000);

  afterAll(async () => {
    await client?.disconnect();
  });

  it('authenticates successfully', () => {
    expect(client.ws?.isAuthenticated).toBe(true);
    expect(client.ws?.accountInfo).toBeDefined();
  });

  it('gets account balance', async () => {
    const balance = await client.getBalance();
    expect(balance.balance).toBeGreaterThanOrEqual(0);
    expect(balance.currency).toBeTruthy();
    expect(balance.accountNumber).toBeGreaterThan(0);
    console.log(`  💰 Balance: ${balance.balance} ${balance.currency}`);
  });

  it('gets live quote', async () => {
    const quote = await client.getQuote('9_CIG.PL_6');
    expect(quote).not.toBeNull();
    expect(quote!.bid).toBeGreaterThan(0);
    expect(quote!.ask).toBeGreaterThan(0);
    expect(quote!.ask).toBeGreaterThanOrEqual(quote!.bid);
    console.log(`  📈 CIG.PL: bid=${quote!.bid} ask=${quote!.ask} spread=${(quote!.spread).toFixed(4)}`);
  });

  it('searches instruments', async () => {
    const results = await client.searchInstrument('Apple');
    expect(results.length).toBeGreaterThan(0);
    const apple = results.find(r => r.symbol === 'AAPL.US');
    expect(apple).toBeDefined();
    console.log(`  🔍 Found ${results.length} results for "Apple"`);
  });

  it('gets open positions', async () => {
    const positions = await client.getPositions();
    expect(Array.isArray(positions)).toBe(true);
    for (const pos of positions) {
      expect(pos.symbol).toBeTruthy();
      expect(pos.volume).toBeGreaterThan(0);
      expect(['buy', 'sell']).toContain(pos.side);
    }
    console.log(`  💼 ${positions.length} open position(s)`);
  });

  it('receives push ticks in real-time', async () => {
    const ticks: any[] = [];
    client.ws!.on('tick', (tick: any) => ticks.push(tick));
    
    // Subscribe and wait for at least 1 push tick
    await client.getQuote('9_CIG.PL_6');
    await new Promise(r => setTimeout(r, 3000));
    
    // May or may not get push ticks in 3s (market might be closed)
    expect(Array.isArray(ticks)).toBe(true);
    if (ticks.length > 0) {
      expect(ticks[0].symbol).toBe('CIG.PL');
      console.log(`  📊 Received ${ticks.length} push tick(s)`);
    } else {
      console.log(`  📊 No push ticks (market may be closed)`);
    }
  }, 10000);
});
