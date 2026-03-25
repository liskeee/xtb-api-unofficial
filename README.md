# xtb-api-unofficial

[![CI](https://github.com/liskeee/xtb-api-unofficial/actions/workflows/ci.yml/badge.svg)](https://github.com/liskeee/xtb-api-unofficial/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/xtb-api-unofficial.svg)](https://www.npmjs.com/package/xtb-api-unofficial)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

> ⚠️ **Unofficial** — Reverse-engineered from xStation5. Not affiliated with XTB. Use at your own risk.

Unofficial TypeScript/Node.js client for XTB's xStation5 trading platform.

## Features

- 🔌 **WebSocket Mode** — Direct CoreAPI protocol, no browser needed
- 🌐 **Browser Mode** — Controls xStation5 via Chrome DevTools Protocol
- 🔐 **CAS Authentication** — Full login flow (credentials → TGT → ST → session)
- 📊 **Real-time Data** — Live quotes, positions, balance via push events
- 💹 **Trading** — Buy/sell market orders with SL/TP
- 🔍 **Instrument Search** — Access to 11,888+ instruments
- ⚡ **gRPC-web Mode** — Direct trading via Chrome DevTools Protocol (fastest)
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

### gRPC-web Mode

Trades via the xStation5 gRPC-web backend (ipax.xtb.com) through Chrome DevTools Protocol.
Requires Chrome with xStation5 open and remote debugging enabled:

```bash
google-chrome --remote-debugging-port=18800 https://xstation5.xtb.com
```

```typescript
import { GrpcClient, CASClient } from 'xtb-api-unofficial';

// 1. Get TGT via CAS authentication
const cas = new CASClient({ email: 'user@example.com', password: 'password' });
const { tgt } = await cas.getServiceTicket();

// 2. Connect gRPC client to Chrome
const grpc = new GrpcClient({
  cdpUrl: 'http://localhost:18800',
  accountNumber: '51984891',
  accountServer: 'XS-real1',
});
await grpc.connect();

// 3. Get JWT with account scope
const jwt = await grpc.getJwt(tgt);

// 4. Execute trades (USE WITH CAUTION!)
// const result = await grpc.buy(9438, 1);   // BUY 1x CIG.PL
// const result = await grpc.sell(9438, 2);  // SELL 2x CIG.PL

await grpc.disconnect();
```

## Architecture

```
src/
  auth/          CAS authentication (TGT → Service Ticket)
  browser/       Chrome DevTools Protocol client (Playwright)
  ws/            WebSocket CoreAPI client
  grpc/          gRPC-web trading via CDP (ipax.xtb.com)
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

## API Documentation

Full API documentation is auto-generated from source code using TypeDoc:

👉 **[View API Docs](https://liskeee.github.io/xtb-api-unofficial/)**

To generate locally:

```bash
npm run docs
```

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

## License

MIT
