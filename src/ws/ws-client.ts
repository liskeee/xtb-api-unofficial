import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  SocketStatus, Xs6Side, SubscriptionEid,
  type WSClientConfig, type WSRequest, type WSResponse, type CoreAPICommand,
  type AccountBalance, type Position, type Quote,
  type InstrumentSearchResult, type TradeOptions, type TradeResult,
  type INewMarketOrderEvent, type INewMarketOrder, type ISize,
  type ClientInfo, type XLoginResult, type WSPushMessage,
  type CASLoginResult,
} from '../types/index.js';
import { CASClient } from '../auth/index.js';
import { buildAccountId, priceFromDecimal, volumeFrom, sleep } from '../utils.js';

interface PendingRequest {
  resolve: (value: WSResponse) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// Event types for TypeScript declaration merging
export interface XTBWebSocketClient {
  /**
   * Emitted when WebSocket connection is established (before authentication).
   */
  on(event: 'connected', listener: () => void): this;
  /**
   * Emitted when authentication completes successfully.
   * @param loginResult - Authentication result with account and user data
   */
  on(event: 'authenticated', listener: (loginResult: XLoginResult) => void): this;
  /**
   * Emitted when WebSocket connection is closed.
   * @param code - Close code
   * @param reason - Close reason
   */
  on(event: 'disconnected', listener: (code: number, reason: string) => void): this;
  /**
   * Emitted when a WebSocket or protocol error occurs.
   * @param error - Error object
   */
  on(event: 'error', listener: (error: Error) => void): this;
  /**
   * Emitted when connection status changes.
   * @param status - New connection status
   */
  on(event: 'statusUpdate', listener: (status: SocketStatus) => void): this;
  /**
   * Emitted for incoming push messages from the server.
   * @param message - Push message data
   */
  on(event: 'push', listener: (message: WSPushMessage) => void): this;
  /**
   * Emitted for generic WebSocket messages.
   * @param message - Message data
   */
  on(event: 'message', listener: (message: WSResponse | WSPushMessage) => void): this;
  /**
   * Emitted for real-time tick/quote data updates.
   * @param tick - Tick data with bid, ask, high, low, volume
   */
  on(event: 'tick', listener: (tick: any) => void): this;
  /**
   * Emitted for position updates.
   * @param position - Position data
   */
  on(event: 'position', listener: (position: any) => void): this;
  /**
   * Emitted for symbol/instrument data updates.
   * @param symbol - Symbol data
   */
  on(event: 'symbol', listener: (symbol: any) => void): this;
  /**
   * Emitted when two-factor authentication is required.
   * @param sessionData - 2FA session data with sessionId and available methods
   */
  on(event: 'requires_2fa', listener: (sessionData: { loginTicket: string; sessionId: string; methods: string[]; expiresAt: number; twoFactorAuthType?: string }) => void): this;
}

/**
 * Low-level WebSocket client for xStation5.
 *
 * Implements the CoreAPI protocol with full CAS authentication support.
 * Provides real-time data subscriptions and trading capabilities via WebSocket.
 *
 * **Features:**
 * - Full CAS authentication flow (credentials → TGT → Service Ticket → WebSocket auth)
 * - Real-time subscriptions (ticks, positions, request status)
 * - Symbol cache for fast instrument search (11,888+ instruments)
 * - Auto-reconnection with exponential backoff
 * - Typed event emitters for real-time data
 * - Direct trading via tradeTransaction commands
 *
 * **Event Types:**
 * - `connected` - WebSocket connection established
 * - `authenticated` - CAS authentication successful
 * - `tick` - Real-time price updates
 * - `position` - Position/trade updates
 * - `push` - Generic push messages from server
 *
 * @example
 * ```ts
 * const ws = new XTBWebSocketClient({
 *   url: 'wss://api5demoa.x-station.eu/v1/xstation',
 *   accountNumber: 12345678,
 *   auth: {
 *     credentials: { email: 'user@example.com', password: 'password' }
 *   }
 * });
 *
 * ws.on('tick', (tick) => console.log('Price update:', tick));
 * ws.on('authenticated', (result) => console.log('Logged in:', result));
 *
 * await ws.connect();
 * const balance = await ws.getBalance();
 * ```
 */
export class XTBWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<Omit<WSClientConfig, 'auth'>> & { auth?: WSClientConfig['auth'] };
  private status: SocketStatus = SocketStatus.CLOSED;
  private pendingRequests = new Map<string, PendingRequest>();
  private reqSequence = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1000;
  private reconnecting = false;
  private casClient: CASClient | null = null;
  private loginResult: XLoginResult | null = null;
  private authenticated = false;
  private symbolsCache: InstrumentSearchResult[] | null = null;

  /**
   * Create a new WebSocket client instance.
   *
   * @param config - WebSocket client configuration including URL, account, and auth options
   */
  constructor(config: WSClientConfig) {
    super();
    this.config = {
      endpoint: 'meta1',
      pingInterval: 10000,
      autoReconnect: true,
      maxReconnectDelay: 30000,
      appName: 'xStation5',
      appVersion: '2.94.1',
      device: 'Linux x86_64',
      ...config
    };

    // Initialize CAS client if auth is needed
    if (this.config.auth?.credentials) {
      this.casClient = new CASClient();
    }
  }

  /**
   * Get the account ID in the format required by the WebSocket API.
   * @returns Account ID string (e.g., 'meta1_12345678')
   */
  get accountId(): string { return buildAccountId(this.config.accountNumber, this.config.endpoint); }

  /**
   * Get the current WebSocket connection status.
   * @returns Current connection status
   */
  get connectionStatus(): SocketStatus { return this.status; }

  /**
   * Check if WebSocket is connected.
   * @returns True if connected, false otherwise
   */
  get isConnected(): boolean { return this.status === SocketStatus.CONNECTED; }

  /**
   * Check if authenticated with XTB servers.
   * @returns True if authenticated, false otherwise
   */
  get isAuthenticated(): boolean { return this.authenticated; }

  /**
   * Get account information from login result.
   * @returns Login result with account list and user data, or null if not authenticated
   */
  get accountInfo(): XLoginResult | null { return this.loginResult; }

  /**
   * Connect to the WebSocket server and perform authentication if configured.
   *
   * Establishes WebSocket connection and performs full CAS authentication flow
   * if auth options are provided. Emits 'connected' when WebSocket is ready
   * and 'authenticated' when CAS login completes.
   *
   * @throws Error if connection fails, authentication fails, or services are unavailable
   */
  async connect(): Promise<void> {
    if (this.ws) throw new Error('Already connected or connecting');

    // First establish WebSocket connection
    await this.establishConnection();

    // Then perform authentication if configured
    if (this.config.auth) {
      await this.performAuthentication();
    }
  }

  /** Establish WebSocket connection */
  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.updateStatus(SocketStatus.CONNECTING);
      this.ws = new WebSocket(this.config.url);

      this.ws.on('open', () => {
        this.updateStatus(SocketStatus.CONNECTED);
        this.reconnectDelay = 1000;
        this.reconnecting = false;
        this.startPing();
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg: WSResponse | WSPushMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (err) {
          this.emit('error', new Error(`Failed to parse message: ${err}`));
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.cleanup();
        this.updateStatus(SocketStatus.CLOSED);
        this.emit('disconnected', code, reason.toString());
        if (this.config.autoReconnect && !this.reconnecting) this.scheduleReconnect();
      });

      this.ws.on('error', (err: Error) => {
        this.emit('error', err);
        if (this.status === SocketStatus.CONNECTING) reject(err);
      });
    });
  }

  /** Perform authentication flow */
  private async performAuthentication(): Promise<void> {
    const auth = this.config.auth!;
    let serviceTicket: string;

    // Step 1: Get service ticket
    if (auth.serviceTicket) {
      serviceTicket = auth.serviceTicket;
    } else if (auth.tgt) {
      if (!this.casClient) this.casClient = new CASClient();
      const result = await this.casClient.getServiceTicket(auth.tgt, 'xapi5');
      serviceTicket = result.serviceTicket;
    } else if (auth.credentials) {
      if (!this.casClient) this.casClient = new CASClient();
      const loginResult = await this.casClient.login(auth.credentials.email, auth.credentials.password);

      if (loginResult.type === 'requires_2fa') {
        // Emit 2FA required event and wait for user to provide code
        this.emit('requires_2fa', {
          loginTicket: loginResult.loginTicket,
          sessionId: loginResult.sessionId, // backward compat
          methods: loginResult.methods,
          expiresAt: loginResult.expiresAt,
          twoFactorAuthType: loginResult.twoFactorAuthType,
        });
        return; // Don't continue authentication until 2FA is completed
      }

      // Success: proceed with service ticket
      const ticketResult = await this.casClient.getServiceTicket(loginResult.tgt, 'xapi5');
      serviceTicket = ticketResult.serviceTicket;
    } else {
      throw new Error('No valid authentication method provided');
    }

    // Step 2: Register client info (must match xStation5)
    await this.registerClientInfo();

    // Step 3: Login with service ticket
    await this.loginWithServiceTicket(serviceTicket);
  }

  /**
   * Disconnect from the WebSocket server.
   *
   * Cleanly closes the WebSocket connection, disables auto-reconnect,
   * and cleans up all resources including pending requests and timers.
   */
  disconnect(): void {
    this.config.autoReconnect = false;
    if (this.ws) {
      this.updateStatus(SocketStatus.DISCONNECTING);
      this.ws.close();
    }
    this.cleanup();
  }

  /**
   * Send a raw CoreAPI command and wait for response.
   *
   * Low-level method for sending commands to the WebSocket API.
   * Most users should use the higher-level methods instead.
   *
   * @param commandName - Command name for request ID generation
   * @param payload - CoreAPI command payload
   * @param timeoutMs - Request timeout in milliseconds (default: 10000)
   * @returns Promise that resolves to the command response
   * @throws Error if not connected, command fails, or timeout occurs
   */
  async send(commandName: string, payload: Partial<CoreAPICommand['CoreAPI']>, timeoutMs = 10000): Promise<WSResponse> {
    if (!this.isConnected || !this.ws) throw new Error('Not connected');
    const reqId = this.nextReqId(commandName);

    // For auth commands, don't include accountId
    const coreAPI: CoreAPICommand['CoreAPI'] = {
      endpoint: this.config.endpoint,
      ...payload,
    };

    // Only add accountId for non-auth commands
    if (!payload.registerClientInfo && !payload.logonWithServiceTicket) {
      coreAPI.accountId = this.accountId;
    }

    const request: WSRequest = {
      reqId,
      command: [{ CoreAPI: coreAPI }],
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Request ${reqId} timed out`));
      }, timeoutMs);
      this.pendingRequests.set(reqId, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * Subscribe to real-time tick/quote data for a symbol.
   *
   * Subscribes to EID 2 (xcfdtick) for bid, ask, high, low, volume updates.
   * Tick events will be emitted via the 'tick' event.
   *
   * @param symbolKey - Symbol key in format {assetClassId}_{symbolName}_{groupId} (e.g., '9_CIG.PL_6')
   * @returns Promise that resolves when subscription is confirmed
   */
  async subscribeTicks(symbolKey: string): Promise<WSResponse> {
    return this.send('getAndSubscribeTicks', { getAndSubscribeElement: { eid: SubscriptionEid.TICKS, keys: [symbolKey] } });
  }

  /**
   * Unsubscribe from real-time tick data for a symbol.
   *
   * @param symbolKey - Symbol key to unsubscribe from
   * @returns Promise that resolves when unsubscription is confirmed
   */
  async unsubscribeTicks(symbolKey: string): Promise<WSResponse> {
    return this.send('unsubscribeTicks', { unsubscribeElement: { eid: SubscriptionEid.TICKS, keys: [symbolKey] } });
  }

  /**
   * Subscribe to request status updates for trade confirmations.
   *
   * Subscribes to EID 6 for trade execution confirmations and status updates.
   * Essential for monitoring trade execution results.
   *
   * @returns Promise that resolves when subscription is confirmed
   */
  async subscribeRequestStatus(): Promise<WSResponse> {
    return this.send('subscribeRequestStatus', { subscribeElement: { eid: SubscriptionEid.REQUEST_STATUS } });
  }

  /**
   * Ping the server to measure latency.
   *
   * Sends a ping command and measures round-trip time.
   * Useful for connection quality monitoring.
   *
   * @returns Promise that resolves to latency in milliseconds
   */
  async ping(): Promise<number> {
    const start = Date.now();
    await this.send('ping', { ping: {} });
    return Date.now() - start;
  }

  /**
   * Register client info - first step in authentication flow.
   *
   * Must match xStation5 client info exactly for authentication to work.
   * This identifies the client to the server and establishes compatibility.
   *
   * @returns Promise that resolves when client info is registered
   * @throws Error if registration fails
   */
  async registerClientInfo(): Promise<WSResponse> {
    const clientInfo: ClientInfo = {
      appName: this.config.appName!,
      appVersion: this.config.appVersion!,
      appBuildNumber: '0',
      device: this.config.device!,
      osVersion: '',
      comment: 'Node.js',
      apiVersion: '2.73.0',
      osType: 0,
      deviceType: 1,
    };

    return this.send('registerClientInfo', {
      registerClientInfo: { clientInfo },
    });
  }

  /**
   * Login with service ticket - second step in authentication flow.
   *
   * Uses service ticket (ST) obtained from CAS to authenticate with WebSocket.
   * Must be called after registerClientInfo() for the auth flow to succeed.
   * Emits 'authenticated' event when successful.
   *
   * @param serviceTicket - Service ticket from CAS (format: ST-...)
   * @returns Promise that resolves to login result with account list and user data
   * @throws Error if login fails or service ticket is invalid
   */
  async loginWithServiceTicket(serviceTicket: string): Promise<XLoginResult> {
    const response = await this.send('loginWithServiceTicket', {
      logonWithServiceTicket: { serviceTicket },
    });

    // Login result is in response[0].xloginresult
    const first = response.response?.[0] as any;
    const loginData = first?.xloginresult;
    
    if (!loginData) {
      const exception = first?.exception;
      throw new Error(`Login failed: ${exception?.message || response.error?.message || 'Unknown error'}`);
    }

    // Parse accountList — accountNo is in wtAccountId.accountNo (as string)
    this.loginResult = {
      accountList: (loginData.accountList || []).map((acc: any) => ({
        accountNo: Number(acc.wtAccountId?.accountNo ?? acc.accountNo ?? 0),
        currency: String(acc.currency ?? ''),
        endpointType: String(acc.endpointType?.name ?? acc.endpointType ?? ''),
      })),
      endpointList: loginData.endpointList || [],
      userData: {
        name: String(loginData.userData?.name ?? ''),
        surname: String(loginData.userData?.surname ?? ''),
      },
    };

    this.authenticated = true;
    this.emit('authenticated', this.loginResult);

    return this.loginResult;
  }

  /**
   * Submit two-factor authentication code to complete login.
   *
   * Call this method when you receive a 'requires_2fa' event.
   * If successful, authentication will continue automatically.
   *
   * @param loginTicket - Login ticket (MID-xxx) from 'requires_2fa' event
   * @param code - 6-digit OTP code from authenticator app, SMS, or email
   * @param twoFactorAuthType - 2FA method type (default: 'SMS')
   * @returns Promise that resolves when authentication completes
   * @throws Error if 2FA code is invalid, expired, or rate limited
   */
  async submitTwoFactorCode(loginTicket: string, code: string, twoFactorAuthType = 'SMS'): Promise<void> {
    if (!this.casClient) {
      throw new Error('No CAS client available - authentication not started');
    }

    const twoFactorResult = await this.casClient.loginWithTwoFactor(loginTicket, code, twoFactorAuthType);

    if (twoFactorResult.type === 'requires_2fa') {
      // Still requires 2FA (could happen with certain error conditions)
      this.emit('requires_2fa', {
        loginTicket: twoFactorResult.loginTicket,
        sessionId: twoFactorResult.sessionId,
        methods: twoFactorResult.methods,
        expiresAt: twoFactorResult.expiresAt,
        twoFactorAuthType: twoFactorResult.twoFactorAuthType,
      });
      return;
    }

    // Success: continue with service ticket generation
    const ticketResult = await this.casClient.getServiceTicket(twoFactorResult.tgt, 'xapi5');

    // Complete the authentication flow
    await this.registerClientInfo();
    await this.loginWithServiceTicket(ticketResult.serviceTicket);
  }

  // ─── High-level API (mirrors browser-client interface) ───

  /**
   * Get account balance and equity information.
   *
   * Uses EID 1043 (xtotalbalance) for real-time balance data.
   * Falls back to account info from login result if balance data unavailable.
   *
   * @returns Promise that resolves to account balance with equity, free margin, and currency
   * @throws Error if not authenticated or balance service fails
   */
  async getBalance(): Promise<AccountBalance> {
    if (!this.authenticated || !this.loginResult) {
      throw new Error('Must be authenticated to get balance');
    }

    // Use account info from login result
    const account = this.loginResult.accountList.find(
      (acc) => acc.accountNo === this.config.accountNumber
    ) || this.loginResult.accountList[0];

    if (!account) {
      throw new Error('Account not found in login result');
    }

    // Use EID 1043 (xtotalbalance) for real-time balance
    const res = await this.send('getBalance', {
      getAndSubscribeElement: { eid: SubscriptionEid.TOTAL_BALANCE },
    });

    const elements = this.extractElements(res);
    const balanceData = (elements[0] as any)?.value?.xtotalbalance;

    if (balanceData) {
      return {
        balance: Number(balanceData.balance ?? 0),
        equity: Number(balanceData.equity ?? 0),
        freeMargin: Number(balanceData.freeMargin ?? 0),
        currency: account.currency,
        accountNumber: account.accountNo,
      };
    }

    return {
      balance: 0,
      equity: 0,
      freeMargin: 0,
      currency: account.currency,
      accountNumber: account.accountNo,
    };
  }

  /**
   * Get all open trading positions.
   *
   * Uses EID 1 (xcfdtrade) to retrieve current positions with details like
   * volume, open price, profit/loss, stop loss, take profit, etc.
   * Also subscribes to real-time position updates via 'position' events.
   *
   * @returns Promise that resolves to array of open positions
   * @throws Error if not authenticated or position service fails
   */
  async getPositions(): Promise<Position[]> {
    const res = await this.send('getPositions', {
      getAndSubscribeElement: { eid: SubscriptionEid.POSITIONS },
    });

    // Data is in response[0].element.elements[].value.xcfdtrade
    const elements = this.extractElements(res);

    return elements
      .map((el) => {
        const trade = (el as any)?.value?.xcfdtrade;
        if (!trade) return null;
        return {
          symbol: String(trade.symbol ?? ''),
          instrumentId: trade.idQuote != null ? Number(trade.idQuote) : undefined,
          volume: Number(trade.volume ?? 0),
          currentPrice: 0, // Not in position data, need tick
          openPrice: Number(trade.openPrice ?? 0),
          stopLoss: trade.sl != null && trade.sl !== 0 ? Number(trade.sl) : undefined,
          takeProfit: trade.tp != null && trade.tp !== 0 ? Number(trade.tp) : undefined,
          profitPercent: 0,
          profitNet: 0,
          swap: trade.swap != null ? Number(trade.swap) : undefined,
          side: Number(trade.side) === Xs6Side.BUY ? 'buy' as const : 'sell' as const,
          orderId: trade.positionId != null ? String(trade.positionId) : undefined,
          commission: trade.commission != null ? Number(trade.commission) : undefined,
          margin: trade.margin != null ? Number(trade.margin) : undefined,
          openTime: trade.openTime != null ? Number(trade.openTime) : undefined,
        } as Position;
      })
      .filter((p): p is Position => p !== null);
  }

  /**
   * Execute a BUY order via WebSocket tradeTransaction.
   *
   * ⚠️ **WARNING**: This executes real trades. Always test on demo accounts first.
   *
   * Sends a market buy order using the CoreAPI tradeTransaction command.
   * Automatically looks up instrument ID via symbol search.
   *
   * @param symbol - Symbol name (e.g., 'CIG.PL', 'AAPL.US')
   * @param volume - Volume to buy (number of units)
   * @param options - Optional trade parameters (stop loss, take profit, trailing stop)
   * @returns Promise that resolves to trade execution result
   * @throws Error if not authenticated, symbol not found, or trade fails
   */
  async buy(symbol: string, volume: number, options?: TradeOptions): Promise<TradeResult> {
    return this.executeTrade(symbol, volume, Xs6Side.BUY, options);
  }

  /**
   * Execute a SELL order via WebSocket tradeTransaction.
   *
   * ⚠️ **WARNING**: This executes real trades. Always test on demo accounts first.
   *
   * Sends a market sell order using the CoreAPI tradeTransaction command.
   * Automatically looks up instrument ID via symbol search.
   *
   * @param symbol - Symbol name (e.g., 'CIG.PL', 'AAPL.US')
   * @param volume - Volume to sell (number of units)
   * @param options - Optional trade parameters (stop loss, take profit, trailing stop)
   * @returns Promise that resolves to trade execution result
   * @throws Error if not authenticated, symbol not found, or trade fails
   */
  async sell(symbol: string, volume: number, options?: TradeOptions): Promise<TradeResult> {
    return this.executeTrade(symbol, volume, Xs6Side.SELL, options);
  }

  /**
   * Search for financial instruments with intelligent caching.
   *
   * **Performance Optimization**: Downloads all 11,888+ instruments on first call
   * and caches them locally. Subsequent searches are instant, filtering from cache.
   *
   * Uses EID 3 (xcfdsymbol) to retrieve complete instrument catalog including
   * symbol names, descriptions, instrument IDs, and symbol keys.
   *
   * **Symbol Key Format**: `{assetClassId}_{symbolName}_{groupId}` (e.g., '9_CIG.PL_6')
   *
   * @param query - Search query (case-insensitive, matches symbol name or description)
   * @returns Promise that resolves to array of matching instruments
   * @throws Error if not authenticated or symbol service fails
   *
   * @example
   * ```ts
   * // First call downloads all symbols (~1-3 seconds)
   * const results1 = await ws.searchInstrument('Apple');
   *
   * // Subsequent calls are instant (cached)
   * const results2 = await ws.searchInstrument('Microsoft');
   * const results3 = await ws.searchInstrument('Tesla');
   * ```
   */
  async searchInstrument(query: string): Promise<InstrumentSearchResult[]> {
    // Use cache if available (instant search after first load)
    if (this.symbolsCache) {
      const queryLower = query.toLowerCase();
      return this.symbolsCache
        .filter((s) =>
          s.symbol.toLowerCase().includes(queryLower) ||
          s.name.toLowerCase().includes(queryLower) ||
          s.description.toLowerCase().includes(queryLower)
        )
        .slice(0, 100); // Limit results for performance
    }

    // First call: download all symbols and cache them
    const res = await this.send('searchInstruments', {
      getAndSubscribeElement: { eid: SubscriptionEid.SYMBOLS },
    }, 30000); // Longer timeout for large dataset

    // Extract symbols from response
    const elements = this.extractElements(res);

    const allSymbols = elements
      .map((el) => {
        const sym = (el as any)?.value?.xcfdsymbol;
        if (!sym) return null;
        return {
          symbol: String(sym.name ?? ''),
          instrumentId: Number(sym.quoteId ?? 0),
          name: String(sym.description ?? sym.name ?? ''),
          description: String(sym.description ?? ''),
          assetClass: String(sym.idAssetClass ?? ''),
          symbolKey: `${sym.idAssetClass}_${sym.name}_${sym.groupId ?? sym.quoteId}`,
        };
      })
      .filter((s): s is InstrumentSearchResult => s !== null);

    // Cache symbols for future searches
    this.symbolsCache = allSymbols;
    console.log(`Cached ${allSymbols.length} instruments for instant search`);

    // Return filtered results
    const queryLower = query.toLowerCase();
    return allSymbols
      .filter((s) =>
        s.symbol.toLowerCase().includes(queryLower) ||
        s.name.toLowerCase().includes(queryLower) ||
        s.description.toLowerCase().includes(queryLower)
      )
      .slice(0, 100); // Limit results for performance
  }

  /**
   * Get the account number for this WebSocket session.
   *
   * Returns the account number from the login result if available,
   * otherwise falls back to the configured account number.
   *
   * @returns Account number for this session
   */
  getAccountNumber(): number {
    if (this.loginResult && this.loginResult.accountList.length > 0) {
      // Return the configured account number if found in account list
      const account = this.loginResult.accountList.find(
        (acc) => acc.accountNo === this.config.accountNumber
      );
      if (account) return account.accountNo;

      // Fallback to first account in list
      return this.loginResult.accountList[0].accountNo;
    }

    // Fallback to configured account number
    return this.config.accountNumber;
  }

  /**
   * Get current quote (bid/ask prices) for a symbol.
   *
   * Uses EID 2 (xcfdtick) to retrieve real-time price data.
   * Automatically tries common symbol key patterns if exact key not provided.
   * Also subscribes to tick updates, so 'tick' events will be emitted for this symbol.
   *
   * **Symbol Key Format**: Accepts both symbol names ('CIG.PL') and full keys ('9_CIG.PL_6')
   *
   * @param symbol - Symbol name or full symbol key
   * @returns Promise that resolves to quote data or null if symbol not found
   * @throws Error if not authenticated or quote service fails
   *
   * @example
   * ```ts
   * const quote = await ws.getQuote('CIG.PL');
   * if (quote) {
   *   console.log(`Bid: ${quote.bid}, Ask: ${quote.ask}`);
   * }
   * ```
   */
  async getQuote(symbol: string): Promise<Quote | null> {
    // Symbol key format: {assetClassId}_{symbolName}_{groupId} e.g. 9_CIG.PL_6
    // If already in key format, use directly. Otherwise try common patterns.
    const isKey = symbol.includes('_');
    const keysToTry = isKey
      ? [symbol]
      : [`9_${symbol}_6`, symbol]; // 9 = stocks, 6 = default group

    for (const key of keysToTry) {
      try {
        const res = await this.subscribeTicks(key);
        // Data is in response[0].element.elements[0].value.xcfdtick
        const elements = this.extractElements(res);
        const tick = (elements[0] as any)?.value?.xcfdtick;
        if (tick) {
          return {
            symbol: String(tick.symbol ?? symbol),
            ask: Number(tick.ask ?? 0),
            bid: Number(tick.bid ?? 0),
            spread: Number(tick.ask ?? 0) - Number(tick.bid ?? 0),
            high: tick.high != null ? Number(tick.high) : undefined,
            low: tick.low != null ? Number(tick.low) : undefined,
            time: tick.timestamp != null ? Number(tick.timestamp) : undefined,
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  // ─── Private helpers ───

  private async executeTrade(
    symbol: string,
    volume: number,
    side: Xs6Side,
    options?: TradeOptions,
  ): Promise<TradeResult> {
    // We need the instrumentId. First try to search for it.
    const results = await this.searchInstrument(symbol);
    const instrument = results.find(
      (r) => r.symbol.toUpperCase() === symbol.toUpperCase(),
    ) ?? results[0];

    if (!instrument) {
      return { success: false, symbol, side: side === Xs6Side.BUY ? 'buy' : 'sell', error: `Instrument not found: ${symbol}` };
    }

    const size: ISize = options?.amount != null
      ? { amount: options.amount }
      : { volume: volumeFrom(volume) };

    const order: INewMarketOrder = {
      instrumentid: instrument.instrumentId,
      size,
      side,
    };

    // TODO: precision for SL/TP prices — using 2 as default; should come from instrument data
    if (options?.stopLoss != null) {
      order.stoploss = options.trailingStop != null
        ? { trailingstopinput: { pips: options.trailingStop } }
        : { price: priceFromDecimal(options.stopLoss, 2) };
    }
    if (options?.takeProfit != null) {
      order.takeprofit = { price: priceFromDecimal(options.takeProfit, 2) };
    }

    const orderEvent: INewMarketOrderEvent = {
      order,
      uiTrackingId: `ws_${Date.now()}`,
      account: {
        number: this.config.accountNumber,
        server: this.config.endpoint,
        currency: '', // TODO: populate from account info if available
      },
    };

    // Subscribe to request status to get trade confirmation
    await this.subscribeRequestStatus();

    const res = await this.send('tradeTransaction', {
      tradeTransaction: { newMarketOrder: orderEvent },
    }, 15000);

    const sideStr = side === Xs6Side.BUY ? 'buy' as const : 'sell' as const;

    if (res.error) {
      return { success: false, symbol, side: sideStr, error: res.error.message };
    }

    const data = this.extractResponseData(res);
    return {
      success: true,
      orderId: data?.orderId != null ? String(data.orderId) : undefined,
      symbol,
      side: sideStr,
      volume,
      price: data?.price != null ? Number(data.price) : undefined,
    };
  }

  private extractResponseData(res: WSResponse): Record<string, unknown> | null {
    if (res.response && res.response.length > 0) {
      const first = res.response[0] as Record<string, unknown>;
      // xStation5 wraps data in element.elements[0].value.{type}
      const element = first?.element as Record<string, unknown> | undefined;
      if (element?.elements && Array.isArray(element.elements)) {
        // Return the raw element with all items for collection responses
        return first;
      }
      return first;
    }
    if (res.data && typeof res.data === 'object') {
      return res.data as Record<string, unknown>;
    }
    return null;
  }

  /** Extract all elements from a subscription response */
  private extractElements(res: WSResponse): Record<string, unknown>[] {
    if (!res.response || res.response.length === 0) return [];
    const first = res.response[0] as Record<string, unknown>;
    const element = first?.element as Record<string, unknown> | undefined;
    if (element?.elements && Array.isArray(element.elements)) {
      return element.elements as Record<string, unknown>[];
    }
    return [];
  }

  private nextReqId(prefix: string): string { return `${prefix}_${Date.now()}_${++this.reqSequence}`; }

  private handleMessage(msg: WSResponse | WSPushMessage): void {
    // Handle request responses
    if (msg.reqId && this.pendingRequests.has(msg.reqId)) {
      const pending = this.pendingRequests.get(msg.reqId)!;
      this.pendingRequests.delete(msg.reqId);
      clearTimeout(pending.timeout);
      pending.resolve(msg);
      return;
    }

    // Handle push messages (status=1)
    if ('status' in msg && msg.status === 1 && msg.events) {
      this.emit('push', msg as WSPushMessage);

      // Also emit specific events for each EID
      for (const event of msg.events) {
        switch (event.eid) {
          case SubscriptionEid.TICKS:
            if (event.row.value.xcfdtick) {
              this.emit('tick', event.row.value.xcfdtick);
            }
            break;
          case SubscriptionEid.POSITIONS:
            if (event.row.value.xcfdtrade) {
              this.emit('position', event.row.value.xcfdtrade);
            }
            break;
          case SubscriptionEid.SYMBOLS:
            if (event.row.value.xcfdsymbol) {
              this.emit('symbol', event.row.value.xcfdsymbol);
            }
            break;
        }
      }
      return;
    }

    // Generic message handler for other message types
    this.emit('message', msg);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(async () => { try { await this.ping(); } catch {} }, this.config.pingInterval);
  }

  private stopPing(): void { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; } }

  private async scheduleReconnect(): Promise<void> {
    this.reconnecting = true;
    await sleep(this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.config.maxReconnectDelay);
    try { await this.connect(); } catch {}
  }

  private cleanup(): void {
    this.stopPing();
    for (const [, p] of this.pendingRequests) {
      clearTimeout(p.timeout);
      p.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    this.ws = null;
    this.authenticated = false;
    this.loginResult = null;
    this.symbolsCache = null; // Clear symbols cache on disconnect
  }

  private updateStatus(status: SocketStatus): void { this.status = status; this.emit('statusUpdate', status); }
}
