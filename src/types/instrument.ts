/**
 * Complete instrument symbol definition from XTB.
 *
 * Represents detailed information about a financial instrument including
 * identifiers, display names, trading parameters, and asset classification.
 *
 * @example
 * ```ts
 * const symbol: InstrumentSymbol = {
 *   name: 'CIG.PL',
 *   quoteId: 12345,
 *   instrumentId: 67890,
 *   idAssetClass: 9, // 9 = stocks
 *   displayName: 'CI Games SA',
 *   description: 'CI Games SA - game development company',
 *   fullDescription: 'CI Games SA - Polish video game developer and publisher',
 *   groupId: 6,
 *   searchGroup: 'Polish Stocks',
 *   precision: 2,
 *   lotMin: 1,
 *   lotStep: 1
 * };
 * ```
 */
export interface InstrumentSymbol {
  /** Symbol name (e.g., 'CIG.PL', 'AAPL.US') */
  name: string;
  /** Quote ID for price data subscriptions */
  quoteId: number;
  /** Unique instrument identifier */
  instrumentId: number;
  /** Asset class ID (1=forex, 4=indices, 5=commodities, 9=stocks) */
  idAssetClass: number;
  /** Human-readable display name */
  displayName: string;
  /** Short description */
  description: string;
  /** Full detailed description */
  fullDescription: string;
  /** Group ID for symbol organization */
  groupId: number;
  /** Search group category */
  searchGroup: string;
  /** Price precision (decimal places) */
  precision: number;
  /** Minimum lot size */
  lotMin: number;
  /** Lot step increment */
  lotStep: number;
  /** Optional instrument tag */
  instrumentTag?: string;
  /** Whether market depth data is available */
  hasDepth?: boolean;
}

/**
 * Real-time quote/tick data.
 *
 * Contains current market prices and optional daily high/low information.
 *
 * @example
 * ```ts
 * const quote: Quote = {
 *   symbol: 'AAPL.US',
 *   bid: 150.25,
 *   ask: 150.35,
 *   spread: 0.10,
 *   high: 152.80,
 *   low: 149.50,
 *   time: 1640995200000 // Unix timestamp
 * };
 *
 * console.log(`${quote.symbol}: $${quote.bid}/$${quote.ask} (spread: $${quote.spread})`);
 * ```
 */
export interface Quote {
  /** Symbol name */
  symbol: string;
  /** Current ask (sell) price */
  ask: number;
  /** Current bid (buy) price */
  bid: number;
  /** Bid-ask spread */
  spread: number;
  /** Daily high price */
  high?: number;
  /** Daily low price */
  low?: number;
  /** Quote timestamp (Unix milliseconds) */
  time?: number;
}

/**
 * Instrument search result.
 *
 * Simplified instrument information returned from search operations.
 * Contains essential details needed for trading and display.
 *
 * @example
 * ```ts
 * // Search for Apple stock
 * const results = await client.searchInstrument('Apple');
 * const apple = results.find(r => r.symbol === 'AAPL.US');
 *
 * if (apple) {
 *   console.log(`Found: ${apple.name} (${apple.symbol})`);
 *   console.log(`Description: ${apple.description}`);
 *   console.log(`Symbol Key: ${apple.symbolKey}`);
 *
 *   // Use for trading
 *   await client.buy(apple.symbol, 100);
 * }
 * ```
 */
export interface InstrumentSearchResult {
  /** Symbol name for trading */
  symbol: string;
  /** Instrument ID for WebSocket commands */
  instrumentId: number;
  /** Display name */
  name: string;
  /** Description text */
  description: string;
  /** Asset class name */
  assetClass: string;
  /** Full symbol key in format {assetClassId}_{symbolName}_{groupId} */
  symbolKey: string;
}
