import { chromium, type Browser, type Page } from 'playwright-core';
import type { Position, AccountBalance, InstrumentSearchResult, TradeOptions, TradeResult, Quote } from '../types/index.js';
import { sleep } from '../utils.js';

export interface BrowserClientConfig {
  /** CDP WebSocket URL (ws://127.0.0.1:PORT/cdp or similar) */
  cdpUrl: string;
  /** Timeout for operations in ms (default: 15000) */
  timeout?: number;
}

/**
 * Browser automation client for xStation5.
 *
 * Connects to an existing Chrome instance via CDP and executes trades by
 * manipulating AngularJS services directly in the browser context.
 * This approach bypasses UI automation and directly calls the same APIs
 * that xStation5 uses internally.
 *
 * **Requirements:**
 * - Chrome with remote debugging enabled: `--remote-debugging-port=9222`
 * - xStation5 logged in and loaded at `https://xstation5.xtb.com`
 * - Active session with access to trading services
 *
 * **⚠️ Warning**: This executes real trades. Always test on demo accounts first.
 *
 * @example
 * ```bash
 * # Start Chrome with remote debugging
 * google-chrome --remote-debugging-port=9222 https://xstation5.xtb.com
 * ```
 *
 * @example
 * ```ts
 * const client = new XTBBrowserClient({
 *   cdpUrl: 'ws://127.0.0.1:9222'
 * });
 * await client.connect();
 * const balance = await client.getBalance();
 * await client.buy('CIG.PL', 100, { stopLoss: 2.40 });
 * ```
 */
export class XTBBrowserClient {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: Required<BrowserClientConfig>;

  constructor(config: BrowserClientConfig) {
    this.config = { timeout: 15000, ...config };
  }

  /**
   * Connect to Chrome running xStation5.
   *
   * Establishes CDP connection and finds the xStation5 tab.
   * The tab must be already loaded and logged in.
   *
   * @throws Error if Chrome CDP connection fails or xStation5 tab is not found
   */
  async connect(): Promise<void> {
    try {
      this.browser = await chromium.connectOverCDP(this.config.cdpUrl);
    } catch (error) {
      throw new Error(`Failed to connect to Chrome CDP at ${this.config.cdpUrl}. Make sure Chrome is running with --remote-debugging-port. ${error}`);
    }

    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        if (p.url().includes('xstation5.xtb.com')) { this.page = p; break; }
      }
      if (this.page) break;
    }
    if (!this.page) {
      throw new Error('No xStation5 tab found. Make sure xstation5.xtb.com is open and logged in.');
    }

    // Verify AngularJS is available
    const isAngularReady = await this.isReady();
    if (!isAngularReady) {
      throw new Error('xStation5 AngularJS services are not available. Make sure the page is fully loaded and you are logged in.');
    }
  }

  /**
   * Disconnect from Chrome.
   *
   * Cleanly closes the CDP connection and clears references.
   */
  async disconnect(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Check if connected and xStation5 AngularJS is ready.
   *
   * @returns True if page is connected and AngularJS scope is available
   */
  async isReady(): Promise<boolean> {
    if (!this.page) return false;
    return this.page.evaluate(() => {
      try {
        return !!(window as any).angular?.element(document.querySelector('.ng-scope'))?.scope();
      } catch {
        return false;
      }
    });
  }


  /**
   * Get account balance and equity using AngularJS services.
   *
   * Retrieves real-time balance data including equity, free margin, and currency.
   * Uses the same service that xStation5 UI uses internally.
   *
   * @returns Account balance information
   * @throws Error if AngularJS services are not available or if timeout occurs
   */
  async getBalance(): Promise<AccountBalance> {
    this.ensurePage();
    return this.page!.evaluate(() => {
      try {
        const angular = (window as any).angular;
        if (!angular) throw new Error('AngularJS not available');

        const $injector = angular.element(document.body).injector();
        if (!$injector) throw new Error('AngularJS injector not available');

        const balanceSvc = $injector.get('api:forexTotalBalanceService');
        if (!balanceSvc) throw new Error('forexTotalBalanceService not available');

        return new Promise((resolve, reject) => {
          balanceSvc.loadAndSubscribeBalance((eventType: any, data: any) => {
            if (data) {
              resolve({
                balance: Number(data.balance || 0),
                equity: Number(data.equity || 0),
                freeMargin: Number(data.freeMargin || 0),
                currency: String(data.currency || 'PLN'),
                accountNumber: Number(data.aid?.accountNo || 0),
              });
            }
          }, 'jarvis_balance');
          setTimeout(() => reject(new Error('Balance service timeout - no data received within 5 seconds')), 5000);
        });
      } catch (error) {
        throw new Error(`Failed to get balance: ${error}`);
      }
    });
  }

  /**
   * Get all open positions using AngularJS services.
   *
   * Retrieves all currently open trading positions with details like
   * volume, open price, profit/loss, stop loss, take profit, etc.
   *
   * @returns Array of open positions, empty array if no positions
   * @throws Error if AngularJS services are not available
   */
  async getPositions(): Promise<Position[]> {
    this.ensurePage();
    return this.page!.evaluate(() => {
      try {
        const angular = (window as any).angular;
        if (!angular) throw new Error('AngularJS not available');

        const $injector = angular.element(document.body).injector();
        if (!$injector) throw new Error('AngularJS injector not available');

        const tradeSvc = $injector.get('api:forexTradeRecordService');
        if (!tradeSvc) throw new Error('forexTradeRecordService not available');

        return new Promise((resolve, reject) => {
          tradeSvc.loadAndSubscribeOpenTrade((eventType: any, data: any) => {
            if (data && Array.isArray(data)) {
              const positions = data.map((p: any) => ({
                symbol: String(p.symbol || ''),
                instrumentId: p.idQuote != null ? Number(p.idQuote) : undefined,
                volume: Number(p.volume || 0),
                currentPrice: 0, // Need to fill from quotes if needed
                openPrice: Number(p.openPrice || 0),
                stopLoss: p.sl !== 0 ? Number(p.sl) : undefined,
                takeProfit: p.tp !== 0 ? Number(p.tp) : undefined,
                profitPercent: 0,
                profitNet: Number(p.profit || 0),
                swap: Number(p.swap || 0),
                side: (p.side === 0 ? 'buy' : 'sell') as 'buy' | 'sell',
                orderId: String(p.order),
                openTime: Number(p.openTime || 0)
              }));
              resolve(positions);
            } else {
              resolve([]);
            }
          }, 'jarvis_positions');
          setTimeout(() => reject(new Error('Position service timeout - no data received within 5 seconds')), 5000);
        });
      } catch (error) {
        throw new Error(`Failed to get positions: ${error}`);
      }
    });
  }

  /**
   * Get current quote (bid/ask prices) for a symbol using AngularJS services.
   *
   * Retrieves real-time price data including bid, ask, spread, high, low, and timestamp.
   * Automatically resolves symbol names to internal symbol keys.
   *
   * @param symbolName - Symbol name (e.g., 'CIG.PL', 'AAPL.US')
   * @returns Quote data or null if symbol not found or timeout
   * @throws Error if AngularJS services are not available
   */
  async getQuote(symbolName: string): Promise<Quote | null> {
    this.ensurePage();
    return this.page!.evaluate((sym: string) => {
      try {
        const angular = (window as any).angular;
        if (!angular) throw new Error('AngularJS not available');

        const $injector = angular.element(document.body).injector();
        if (!$injector) throw new Error('AngularJS injector not available');

        const quoteSvc = $injector.get('api:forexQuoteService');
        if (!quoteSvc) throw new Error('forexQuoteService not available');

        return new Promise((resolve, reject) => {
          try {
            // Find full symbol key first (e.g. 9_CIG.PL_6)
            const allQuotes = quoteSvc.getAllQuotesLight();
            const symbolData = allQuotes.find((q: any) => q.symbol?.name === sym || q.name === sym);
            const key = symbolData?.key || sym;

            quoteSvc.loadAndSubscribeQuotes([key], (eventType: any, quote: any) => {
              if (quote && quote.tick) {
                const t = quote.tick;
                resolve({
                  symbol: sym,
                  ask: Number(t.ask || 0),
                  bid: Number(t.bid || 0),
                  spread: Number(t.ask || 0) - Number(t.bid || 0),
                  high: Number(t.high || 0),
                  low: Number(t.low || 0),
                  time: Number(t.timestamp || 0)
                });
              }
            }, 'jarvis_quote_' + sym);
            setTimeout(() => resolve(null), 5000);
          } catch (error) {
            reject(new Error(`Failed to subscribe to quotes for ${sym}: ${error}`));
          }
        });
      } catch (error) {
        throw new Error(`Failed to get quote for ${sym}: ${error}`);
      }
    }, symbolName);
  }

  /**
   * Execute a BUY order using AngularJS trade service.
   *
   * ⚠️ **WARNING**: This executes real trades. Always test on demo accounts first.
   *
   * Directly calls the same trading service that xStation5 UI uses,
   * bypassing UI automation for faster and more reliable execution.
   *
   * @param symbol - Symbol name (e.g., 'CIG.PL', 'AAPL.US')
   * @param volume - Volume to buy (number of units)
   * @param options - Optional trade parameters (stop loss, take profit)
   * @returns Trade execution result with order ID if successful
   * @throws Error if AngularJS services are not available or trade fails
   */
  async buy(symbol: string, volume: number, options?: TradeOptions): Promise<TradeResult> {
    return this.executeTradeService(symbol, volume, 0, options);
  }

  /**
   * Execute a SELL order using AngularJS trade service.
   *
   * ⚠️ **WARNING**: This executes real trades. Always test on demo accounts first.
   *
   * Directly calls the same trading service that xStation5 UI uses,
   * bypassing UI automation for faster and more reliable execution.
   *
   * @param symbol - Symbol name (e.g., 'CIG.PL', 'AAPL.US')
   * @param volume - Volume to sell (number of units)
   * @param options - Optional trade parameters (stop loss, take profit)
   * @returns Trade execution result with order ID if successful
   * @throws Error if AngularJS services are not available or trade fails
   */
  async sell(symbol: string, volume: number, options?: TradeOptions): Promise<TradeResult> {
    return this.executeTradeService(symbol, volume, 1, options);
  }

  /**
   * Search for financial instruments by name across 11,888+ available instruments.
   *
   * Searches through the symbols cache that xStation5 loads into AngularJS scope.
   * Matches against both symbol names and descriptions.
   *
   * @param query - Search query (e.g., 'Apple', 'CIG', 'EUR/USD')
   * @returns Array of matching instruments (limited to 20 results)
   * @throws Error if AngularJS is not available or symbols cache is not loaded
   */
  async searchInstrument(query: string): Promise<InstrumentSearchResult[]> {
    this.ensurePage();
    return this.page!.evaluate((q: string) => {
      try {
        const angular = (window as any).angular;
        if (!angular) throw new Error('AngularJS not available');

        const rootScope = angular.element(document.querySelector('.ng-scope') || document.body).scope().$root;
        if (!rootScope) throw new Error('AngularJS root scope not available');

        const visited = new Set<number>();
        let symbolsArray: any[] | null = null;

        function findSymbols(scope: any): void {
          if (!scope || visited.has(scope.$id)) return;
          visited.add(scope.$id);
          if (scope.symbols?.length > 1000) {
            symbolsArray = scope.symbols;
            return;
          }
          let child = scope.$$childHead;
          while (child) {
            findSymbols(child);
            if (symbolsArray) return;
            child = child.$$nextSibling;
          }
        }

        findSymbols(rootScope);
        if (!symbolsArray) {
          throw new Error('Symbols data not found in AngularJS scope. Make sure xStation5 is fully loaded.');
        }

        const ql = q.toLowerCase();
        return (symbolsArray as any[])
          .filter((s: any) => {
            const n = (s.symbol?.name || '').toLowerCase();
            const d = (s.symbol?.description || '').toLowerCase();
            return n.includes(ql) || d.includes(ql);
          })
          .slice(0, 20)
          .map((s: any) => ({
            symbol: s.symbol.name,
            instrumentId: s.symbol.instrumentId,
            name: s.symbol.displayName || s.symbol.name,
            description: s.symbol.description || '',
            assetClass: s.symbol.searchGroup || '',
            symbolKey: s.key || `${s.symbol.idAssetClass}_${s.symbol.name}_${s.symbol.groupId}`,
          }));
      } catch (error) {
        throw new Error(`Failed to search instruments: ${error}`);
      }
    }, query);
  }

  /**
   * Get the account number from the current xStation5 session.
   *
   * Extracts the account number from the page content where it appears as #12345678.
   *
   * @returns Account number or 0 if not found
   */
  async getAccountNumber(): Promise<number> {
    this.ensurePage();
    return this.page!.evaluate(() => {
      const match = document.body.textContent?.match(/#(\d{5,})/);
      return match ? parseInt(match[1], 10) : 0;
    });
  }

  /**
   * Execute trade using AngularJS order service.
   *
   * This method directly calls the same trading APIs that xStation5 UI uses,
   * providing faster execution than UI automation.
   *
   * @param symbol - Symbol name to trade
   * @param volume - Trade volume
   * @param side - Trade side (0 = buy, 1 = sell)
   * @param options - Optional trade parameters
   * @returns Trade execution result
   * @throws Error if trading services are not available or trade fails
   * @private
   */
  private async executeTradeService(symbol: string, volume: number, side: number, options?: TradeOptions): Promise<TradeResult> {
    this.ensurePage();

    // Define types for the page.evaluate parameters
    interface TradeParams {
      sym: string;
      vol: number;
      side: number;
      opts?: TradeOptions;
    }

    return this.page!.evaluate(async ({ sym, vol, side, opts }: TradeParams) => {
      try {
        const angular = (window as any).angular;
        if (!angular) throw new Error('AngularJS not available');

        const $injector = angular.element(document.body).injector();
        if (!$injector) throw new Error('AngularJS injector not available');

        const orderSvc = $injector.get('api:forexOrderService');
        if (!orderSvc) throw new Error('forexOrderService not available');

        const quoteSvc = $injector.get('api:forexQuoteService');
        if (!quoteSvc) throw new Error('forexQuoteService not available');

        // Get instrument info
        const allQuotes = quoteSvc.getAllQuotesLight();
        const symbolData = allQuotes.find((q: any) => q.symbol?.name === sym || q.name === sym);
        if (!symbolData) throw new Error(`Symbol not found: ${sym}`);

        return new Promise((resolve, reject) => {
          const callback = (res: any) => {
            if (res && res.status === 'SUCCESS') {
              resolve({
                success: true,
                symbol: sym,
                side: (side === 0 ? 'buy' : 'sell') as 'buy' | 'sell',
                volume: vol,
                orderId: res.orderId
              });
            } else {
              resolve({
                success: false,
                symbol: sym,
                side: (side === 0 ? 'buy' : 'sell') as 'buy' | 'sell',
                error: res?.exception?.message || 'Trade failed'
              });
            }
          };

          try {
            if (side === 0) {
              orderSvc.newOpenTradeBuy(symbolData, vol, opts?.stopLoss || 0, opts?.takeProfit || 0, callback);
            } else {
              orderSvc.newOpenTradeSell(symbolData, vol, opts?.stopLoss || 0, opts?.takeProfit || 0, callback);
            }
          } catch (error) {
            reject(new Error(`Failed to execute trade: ${error}`));
          }

          // Timeout after 30 seconds
          setTimeout(() => reject(new Error('Trade execution timeout')), 30000);
        });
      } catch (error) {
        throw new Error(`Trade execution failed for ${sym}: ${error}`);
      }
    }, { sym: symbol, vol: volume, side, opts: options });
  }

  /**
   * Ensure that page connection is available.
   * @throws Error if not connected
   * @private
   */
  private ensurePage(): void {
    if (!this.page) {
      throw new Error('Not connected to xStation5. Call connect() first and ensure Chrome is running with remote debugging enabled.');
    }
  }
}
