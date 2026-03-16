import { XTBWebSocketClient } from './ws/ws-client.js';
import { XTBBrowserClient, type BrowserClientConfig } from './browser/browser-client.js';
import type { Position, AccountBalance, InstrumentSearchResult, TradeOptions, TradeResult, Quote, WSClientConfig, WSAuthOptions } from './types/index.js';

export type ClientMode = 'browser' | 'websocket';

export interface XTBClientConfig {
  mode: ClientMode;
  browser?: BrowserClientConfig;
  websocket?: WSClientConfig;
  /** Authentication options for WebSocket mode */
  auth?: WSAuthOptions;
}

/**
 * High-level XTB trading client.
 * Provides a unified API over Browser automation and WebSocket modes.
 *
 * **⚠️ Warning**: This is an unofficial library. Use at your own risk.
 * Always test thoroughly on demo accounts before using with real money.
 *
 * ## Features
 * - **WebSocket Mode**: Direct CoreAPI protocol, no browser needed
 * - **Browser Mode**: Controls xStation5 via Chrome DevTools Protocol
 * - **CAS Authentication**: Full login flow (credentials → TGT → ST → session)
 * - **Real-time Data**: Live quotes, positions, balance via push events
 * - **Trading**: Buy/sell market orders with SL/TP
 * - **Instrument Search**: Access to 11,888+ instruments
 *
 * @example Browser Mode
 * ```ts
 * const client = new XTBClient({
 *   mode: 'browser',
 *   browser: { cdpUrl: 'ws://127.0.0.1:9222' }
 * });
 * await client.connect();
 * await client.buy('CIG.PL', 1);
 * ```
 *
 * @example WebSocket Mode with Auth
 * ```ts
 * const client = new XTBClient({
 *   mode: 'websocket',
 *   websocket: {
 *     url: 'wss://api5demoa.x-station.eu/v1/xstation',
 *     accountNumber: 12345678
 *   },
 *   auth: {
 *     credentials: { email: 'user@example.com', password: 'password' }
 *   }
 * });
 * await client.connect();
 * const positions = await client.getPositions();
 * ```
 */
export class XTBClient {
  private mode: ClientMode;
  private browserClient: XTBBrowserClient | null = null;
  private wsClient: XTBWebSocketClient | null = null;

  /**
   * Create a new XTB client instance.
   * @param config - Client configuration
   */
  constructor(config: XTBClientConfig) {
    this.mode = config.mode;
    if (config.mode === 'browser') {
      if (!config.browser) throw new Error('browser config required');
      this.browserClient = new XTBBrowserClient(config.browser);
    } else {
      if (!config.websocket) throw new Error('websocket config required');

      // Merge auth options from top-level config into websocket config
      const wsConfig: WSClientConfig = {
        ...config.websocket,
        auth: config.auth || config.websocket.auth,
      };

      this.wsClient = new XTBWebSocketClient(wsConfig);
    }
  }

  /**
   * Create a browser mode client instance.
   *
   * @param cdpUrl - Chrome DevTools Protocol WebSocket URL (e.g., 'ws://127.0.0.1:9222')
   * @param options - Additional browser client options
   * @returns New XTB client configured for browser mode
   *
   * @example
   * ```ts
   * const client = XTBClient.browser('ws://127.0.0.1:9222');
   * await client.connect();
   * ```
   */
  static browser(cdpUrl: string, options?: Omit<BrowserClientConfig, 'cdpUrl'>): XTBClient {
    return new XTBClient({
      mode: 'browser',
      browser: { cdpUrl, ...options },
    });
  }

  /**
   * Create a WebSocket mode client instance.
   *
   * @param config - WebSocket configuration with authentication options
   * @returns New XTB client configured for WebSocket mode
   *
   * @example
   * ```ts
   * const client = XTBClient.websocket({
   *   url: 'wss://api5demoa.x-station.eu/v1/xstation',
   *   accountNumber: 12345678,
   *   auth: {
   *     credentials: { email: 'user@example.com', password: 'password' }
   *   }
   * });
   * await client.connect();
   * ```
   */
  static websocket(config: WSClientConfig & { auth?: WSAuthOptions }): XTBClient {
    return new XTBClient({
      mode: 'websocket',
      websocket: config,
      auth: config.auth,
    });
  }

  /**
   * Connect to XTB and authenticate if needed.
   *
   * For browser mode, this connects to Chrome via CDP.
   * For WebSocket mode, this establishes WebSocket connection and performs CAS authentication.
   *
   * @throws Error if connection or authentication fails
   */
  async connect(): Promise<void> {
    if (this.mode === 'browser') await this.browserClient!.connect();
    else await this.wsClient!.connect();
  }

  /**
   * Disconnect from XTB.
   *
   * Cleanly closes the connection and cleans up resources.
   */
  async disconnect(): Promise<void> {
    if (this.mode === 'browser') await this.browserClient!.disconnect();
    else this.wsClient!.disconnect();
  }

  /**
   * Execute a BUY order for the specified symbol.
   *
   * ⚠️ **WARNING**: This executes real trades. Use demo accounts for testing.
   *
   * @param symbol - Symbol name (e.g., 'CIG.PL', 'AAPL.US')
   * @param volume - Volume to buy (number of units)
   * @param options - Optional trade parameters (stop loss, take profit, etc.)
   * @returns Trade execution result
   *
   * @example
   * ```ts
   * const result = await client.buy('CIG.PL', 100, {
   *   stopLoss: 2.40,
   *   takeProfit: 2.80
   * });
   * console.log(result.success ? 'Trade executed' : 'Trade failed');
   * ```
   */
  async buy(symbol: string, volume: number, options?: TradeOptions): Promise<TradeResult> {
    if (this.mode === 'browser') return this.browserClient!.buy(symbol, volume, options);
    return this.wsClient!.buy(symbol, volume, options);
  }

  /**
   * Execute a SELL order for the specified symbol.
   *
   * ⚠️ **WARNING**: This executes real trades. Use demo accounts for testing.
   *
   * @param symbol - Symbol name (e.g., 'CIG.PL', 'AAPL.US')
   * @param volume - Volume to sell (number of units)
   * @param options - Optional trade parameters (stop loss, take profit, etc.)
   * @returns Trade execution result
   *
   * @example
   * ```ts
   * const result = await client.sell('CIG.PL', 100, {
   *   stopLoss: 2.80,
   *   takeProfit: 2.40
   * });
   * console.log(result.success ? 'Trade executed' : 'Trade failed');
   * ```
   */
  async sell(symbol: string, volume: number, options?: TradeOptions): Promise<TradeResult> {
    if (this.mode === 'browser') return this.browserClient!.sell(symbol, volume, options);
    return this.wsClient!.sell(symbol, volume, options);
  }

  /**
   * Get all open positions.
   *
   * @returns Array of open positions with current P&L, stop loss, take profit, etc.
   *
   * @example
   * ```ts
   * const positions = await client.getPositions();
   * for (const position of positions) {
   *   console.log(`${position.symbol}: ${position.volume} @ ${position.openPrice}`);
   * }
   * ```
   */
  async getPositions(): Promise<Position[]> {
    if (this.mode === 'browser') return this.browserClient!.getPositions();
    return this.wsClient!.getPositions();
  }

  /**
   * Get account balance and equity information.
   *
   * @returns Account balance with equity, free margin, and currency
   *
   * @example
   * ```ts
   * const balance = await client.getBalance();
   * console.log(`Balance: ${balance.balance} ${balance.currency}`);
   * console.log(`Equity: ${balance.equity} ${balance.currency}`);
   * console.log(`Free Margin: ${balance.freeMargin} ${balance.currency}`);
   * ```
   */
  async getBalance(): Promise<AccountBalance> {
    if (this.mode === 'browser') return this.browserClient!.getBalance();
    return this.wsClient!.getBalance();
  }

  /**
   * Search for financial instruments.
   *
   * Searches across 11,888+ available instruments by name or description.
   *
   * @param query - Search query (e.g., 'Apple', 'CIG', 'EUR/USD')
   * @returns Array of matching instruments with symbol keys, IDs, and descriptions
   *
   * @example
   * ```ts
   * const results = await client.searchInstrument('Apple');
   * for (const instrument of results) {
   *   console.log(`${instrument.symbol} - ${instrument.description}`);
   * }
   * ```
   */
  async searchInstrument(query: string): Promise<InstrumentSearchResult[]> {
    if (this.mode === 'browser') return this.browserClient!.searchInstrument(query);
    return this.wsClient!.searchInstrument(query);
  }

  /**
   * Get current quote (bid/ask prices) for a symbol.
   *
   * @param symbol - Symbol name (e.g., 'CIG.PL', 'AAPL.US')
   * @returns Current quote with bid, ask, spread, and optional high/low/time
   *
   * @example
   * ```ts
   * const quote = await client.getQuote('CIG.PL');
   * if (quote) {
   *   console.log(`Bid: ${quote.bid}, Ask: ${quote.ask}, Spread: ${quote.spread}`);
   * }
   * ```
   */
  async getQuote(symbol: string): Promise<Quote | null> {
    if (this.mode === 'browser') return this.browserClient!.getQuote(symbol);
    return this.wsClient!.getQuote(symbol);
  }

  /**
   * Get the account number associated with this session.
   *
   * @returns Account number
   *
   * @example
   * ```ts
   * const accountNumber = await client.getAccountNumber();
   * console.log(`Connected to account: #${accountNumber}`);
   * ```
   */
  async getAccountNumber(): Promise<number> {
    if (this.mode === 'browser') return this.browserClient!.getAccountNumber();
    return this.wsClient!.getAccountNumber();
  }

  /**
   * Get the underlying WebSocket client (only available in WebSocket mode).
   *
   * Useful for accessing WebSocket-specific features like event listeners,
   * raw protocol methods, and real-time subscriptions.
   *
   * @returns WebSocket client instance or null if in browser mode
   *
   * @example
   * ```ts
   * const ws = client.ws;
   * if (ws) {
   *   ws.on('tick', (tick) => console.log('Price update:', tick));
   *   ws.on('position', (pos) => console.log('Position update:', pos));
   * }
   * ```
   */
  get ws(): XTBWebSocketClient | null { return this.wsClient; }

  /**
   * Get the underlying Browser client (only available in browser mode).
   *
   * Useful for accessing browser-specific features and low-level page manipulation.
   *
   * @returns Browser client instance or null if in WebSocket mode
   */
  get browser(): XTBBrowserClient | null { return this.browserClient; }
}
