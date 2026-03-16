# XTB xStation5 — Reverse Engineering Research

## Architecture
- xStation5 = AngularJS SPA + Web Workers (WebSocket in worker)
- Backend: `ipax.xtb.com` (gRPC-web) — auth, user data, feature flags
- Trading: WebSocket in Web Worker, events through AngularJS scope

## WebSocket Protocol

### Message Format
```json
{ "reqId": "actionName_timestamp_seqId", "command": [{ "CoreAPI": { "endpoint": "meta1", "accountId": "meta1_{account}", ... } }] }
```

### Known Commands
- `subscribeElement: { eid: 6 }` — request status
- `getAndSubscribeElement: { eid: 2, keys: ["9_CIG.PL_6"] }` — tick data
- `unsubscribeElement: { eid: 3, keys: [...] }` — unsubscribe symbols
- `ping: {}` → response: `{ xpong: { time } }`

### Symbol Key Format
`{assetClassId}_{symbolName}_{groupId}` — e.g., `9_CIG.PL_6`

## gRPC API (ipax.xtb.com)
Services: AuthService, PersonService, CustomerDataPublicService, TrustedDevicesService, FeatureFlagService, PerformanceService, CentralLanguageService, InterestService, PaymentsService, MfaService, RetirementService

**Trading endpoints are behind feature flags** (`featureipaxtradingnewmarketorder`) — not yet accessible.

## Trading Objects (JS Runtime)
Global constructors: INewMarketOrder, INewMarketOrderEvent, ISize, IVolume, IPrice, IStopLossInput, ITakeProfitInput, Xs6Side, Xs6AuthAccount, NewMarketOrderConfirmationRequestEvent, NewMarketOrderUtil, TradeCommand, RequestTradeData

## UI Automation Flow (Tested & Working)
1. Search: set ngModel on search input
2. Open popup: click `.mw-ct-ticket-btn`
3. Buy: `scope.instantBuy()` → confirmation dialog
4. Confirm: `scope.okButtonClicked()` → trade executed via WebSocket

## Key Data
- 11,888 instruments available
- Account format: `meta1_{number}` (e.g., `meta1_12345678`)
- Worker script: `_worker_socket-*.js`
- Old xAPI (xapi.xtb.com:5124): dead
