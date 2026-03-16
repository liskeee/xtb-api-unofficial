# xtb-api-unofficial

> ⚠️ **Unofficial** — Reverse-engineered from xStation5. Not affiliated with XTB. Use at your own risk.

Unofficial TypeScript/Node.js client for XTB's xStation5 trading platform.

## Features

- 🔌 **WebSocket Mode** — Direct CoreAPI protocol, no browser needed
- 🌐 **Browser Mode** — Controls xStation5 via Chrome DevTools Protocol
- 🔐 **CAS Authentication** — Full login flow (credentials → TGT → ST → session)
- 📊 **Real-time Data** — Live quotes, positions, balance via push events
- 💹 **Trading** — Buy/sell market orders with SL/TP
- 🔍 **Instrument Search** — Access to 11,888+ instruments
- 📦 **TypeScript** — Full type safety

## Install

```bash
npm install xtb-api-unofficial
```

## Quick Start

### WebSocket Mode (recommended)

```typescript
import { XTBClient } from 'xtb-api-unofficial';

const client = new XTBClient({
  mode: 'websocket',
  websocket: {
    url: 'wss://api5reala.x-station.eu/v1/xstation', // or api5demoa for demo
    accountNumber: 12345678,
    auth: {
      credentials: { email: 'your@email.com', password: 'your-password' }
      // OR: tgt: 'TGT-xxx' (if you have a TGT from CAS cookie)
      // OR: serviceTicket: 'ST-xxx' (if you have a fresh ST)
    }
  }
});

await client.connect();

// Account balance
const balance = await client.getBalance();
console.log(`Balance: ${balance.balance} ${balance.currency}`);

// Live quote
const quote = await client.getQuote('9_CIG.PL_6');
console.log(`Bid: ${quote?.bid}, Ask: ${quote?.ask}`);

// Open positions
const positions = await client.getPositions();

// Search instruments
const results = await client.searchInstrument('Apple');

// Execute trade (USE WITH CAUTION!)
// await client.buy('AAPL.US', 1, { stopLoss: 150 });

await client.disconnect();
```

### Browser Mode

Requires Chrome with xStation5 open and remote debugging enabled:

```bash
google-chrome --remote-debugging-port=9222 https://xstation5.xtb.com
```

```typescript
import { XTBClient } from 'xtb-api-unofficial';

const client = new XTBClient({
  mode: 'browser',
  browser: { cdpUrl: 'ws://127.0.0.1:9222' }
});

await client.connect();
// Same API as WebSocket mode
await client.disconnect();
```

### Push Events (WebSocket mode)

```typescript
const ws = client.ws!;

ws.on('tick', (tick) => {
  console.log(`${tick.symbol}: ${tick.bid}/${tick.ask}`);
});

ws.on('position', (position) => {
  console.log(`Position update: ${position.symbol}`);
});

ws.on('authenticated', (info) => {
  console.log(`Logged in as ${info.userData.name} ${info.userData.surname}`);
});
```

## API Reference

### `XTBClient`

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<void>` | Connect and authenticate |
| `disconnect()` | `Promise<void>` | Disconnect |
| `getBalance()` | `Promise<AccountBalance>` | Account balance, equity, free margin |
| `getPositions()` | `Promise<Position[]>` | Open positions |
| `getQuote(symbol)` | `Promise<Quote \| null>` | Current bid/ask for a symbol |
| `searchInstrument(query)` | `Promise<InstrumentSearchResult[]>` | Search instruments |
| `buy(symbol, volume, opts?)` | `Promise<TradeResult>` | Execute buy order |
| `sell(symbol, volume, opts?)` | `Promise<TradeResult>` | Execute sell order |

### Symbol Key Format

Symbols use the format `{assetClassId}_{symbolName}_{groupId}`:
- `9_CIG.PL_6` — CI Games on Warsaw Stock Exchange
- `9_AAPL.US_6` — Apple on NASDAQ

### WebSocket URLs

| Environment | URL |
|-------------|-----|
| Real | `wss://api5reala.x-station.eu/v1/xstation` |
| Demo | `wss://api5demoa.x-station.eu/v1/xstation` |

## Architecture

```
src/
  auth/          CAS authentication (TGT → Service Ticket)
  browser/       Chrome DevTools Protocol client (Playwright)
  ws/            WebSocket CoreAPI client
  types/         TypeScript interfaces & enums
  client.ts      Unified high-level client
  utils.ts       Price/volume conversion helpers
```

## How Authentication Works

xStation5 uses a CAS (Central Authentication Service) flow:

1. **Login** → POST credentials to CAS → receive TGT (Ticket Granting Ticket)
2. **Service Ticket** → POST TGT to CAS with `service=xapi5` → receive ST
3. **WebSocket** → Connect → `registerClientInfo` → `loginWithServiceTicket(ST)`
4. **Session** → Receive account list, start subscribing to data

## ⚠️ Disclaimer

This is an **unofficial**, community-driven project. It is NOT affiliated with, endorsed by, or connected to XTB S.A. in any way.

- **Use at your own risk** — trading involves financial risk
- **No warranty** — this software is provided "as is"
- **API stability** — XTB may change their internal APIs at any time, breaking this library
- **Terms of Service** — users are responsible for compliance with XTB's terms
- **Not for production** without thorough testing on a demo account first

## Reverse Engineering

See [RESEARCH.md](./RESEARCH.md) for detailed technical findings about xStation5's internal architecture, WebSocket protocol, and CAS authentication flow.

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## License

MIT
