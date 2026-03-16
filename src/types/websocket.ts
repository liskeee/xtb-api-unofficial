import type { INewMarketOrderEvent } from './trading.js';
import type { CASServiceTicketResult } from '../auth/index.js';

/**
 * CoreAPI command payload sent via WebSocket.
 *
 * Wraps all WebSocket commands in the standard CoreAPI format used by XTB.
 * Each command includes an endpoint and account information, plus the specific
 * command payload (subscription, trade, auth, etc.).
 *
 * @example
 * ```ts
 * // Subscribe to tick data
 * const command: CoreAPICommand = {
 *   CoreAPI: {
 *     endpoint: 'meta1',
 *     accountId: 'meta1_12345678',
 *     getAndSubscribeElement: {
 *       eid: 2, // TICKS
 *       keys: ['9_CIG.PL_6']
 *     }
 *   }
 * };
 * ```
 */
export interface CoreAPICommand {
  CoreAPI: {
    /** Server endpoint (usually 'meta1') */
    endpoint: string;
    /** Account ID in format 'meta1_{accountNumber}' */
    accountId?: string;
    /** Subscribe to an element ID */
    subscribeElement?: { eid: number; keys?: string[] };
    /** Unsubscribe from an element ID */
    unsubscribeElement?: { eid: number; keys?: string[] };
    /** Get current data and subscribe to updates */
    getAndSubscribeElement?: { eid: number; keys?: string[] };
    /** Ping command for latency testing */
    ping?: Record<string, never>;
    /** Execute a trade transaction */
    tradeTransaction?: { newMarketOrder: INewMarketOrderEvent };
    /** Register client info - first step in auth flow */
    registerClientInfo?: { clientInfo: ClientInfo };
    /** Login with service ticket - second step in auth flow */
    logonWithServiceTicket?: { serviceTicket: string };
    /** Allow additional command types */
    [key: string]: unknown;
  };
}

/**
 * WebSocket request message format.
 *
 * Standard request format sent to XTB WebSocket API.
 * Each request has a unique ID for matching responses.
 *
 * @example
 * ```ts
 * const request: WSRequest = {
 *   reqId: 'ping_1640995200_1',
 *   command: [{
 *     CoreAPI: {
 *       endpoint: 'meta1',
 *       ping: {}
 *     }
 *   }]
 * };
 * ```
 */
export interface WSRequest {
  /** Unique request ID for matching responses */
  reqId: string;
  /** Array of CoreAPI commands (usually contains one command) */
  command: CoreAPICommand[];
}

/**
 * WebSocket response message format.
 *
 * Standard response format received from XTB WebSocket API.
 * Contains either successful response data or error information.
 *
 * @example
 * ```ts
 * // Success response
 * const success: WSResponse = {
 *   reqId: 'ping_1640995200_1',
 *   response: [{ xpong: { time: 1640995200000 } }]
 * };
 *
 * // Error response
 * const error: WSResponse = {
 *   reqId: 'invalid_1640995200_2',
 *   error: { code: 'INVALID_COMMAND', message: 'Unknown command' }
 * };
 * ```
 */
export interface WSResponse {
  /** Request ID matching the original request */
  reqId: string;
  /** Response data array (if successful) */
  response?: unknown[];
  /** Alternative response data format */
  data?: unknown;
  /** Error information (if failed) */
  error?: { code: string; message: string };
}

/**
 * Element IDs for WebSocket data subscriptions.
 *
 * These IDs specify different types of real-time data available
 * through the XTB WebSocket API. Verified through live testing.
 *
 * @example
 * ```ts
 * // Subscribe to real-time quotes
 * await ws.send('subscribeTicks', {
 *   getAndSubscribeElement: {
 *     eid: SubscriptionEid.TICKS,
 *     keys: ['9_AAPL.US_6']
 *   }
 * });
 * ```
 */
export enum SubscriptionEid {
  /** EID 1: Open positions (xcfdtrade) — symbol, side, openPrice, volume, order ID */
  POSITIONS = 1,
  /** EID 2: Tick data (xcfdtick) — bid, ask, high, low, bidVolume, askVolume */
  TICKS = 2,
  /** EID 3: Symbols catalog (xcfdsymbol) — name, quoteId, idAssetClass, description, precision, groupId */
  SYMBOLS = 3,
  /** EID 4: Symbol groups (xsymbolgroup) — name, category, businessAssetClass */
  SYMBOL_GROUPS = 4,
  /** EID 5: Group settings (xgroupsettings) — lotMin, lotMax, lotStep, tradeable */
  GROUP_SETTINGS = 5,
  /** EID 6: Request status — subscribe to get trade confirmations and execution updates */
  REQUEST_STATUS = 6,
  // Note: EID 7-8 are COMMAND_FAILED, should not be used for subscriptions
  /** EID 1043: Total account balance (xtotalbalance) — balance, equity, margin, freeMargin */
  TOTAL_BALANCE = 1043,
}

/**
 * Authentication options for WebSocket client.
 *
 * Supports multiple authentication methods depending on what credentials you have.
 * The client will automatically perform the complete CAS authentication flow.
 *
 * @example
 * ```ts
 * // Method 1: Full login with email/password
 * const authByCredentials: WSAuthOptions = {
 *   credentials: {
 *     email: 'user@example.com',
 *     password: 'your-password'
 *   }
 * };
 *
 * // Method 2: Using existing TGT
 * const authByTGT: WSAuthOptions = {
 *   tgt: 'TGT-123456-abcdef...'
 * };
 *
 * // Method 3: Using existing service ticket
 * const authByTicket: WSAuthOptions = {
 *   serviceTicket: 'ST-789012-ghijkl...'
 * };
 * ```
 */
export interface WSAuthOptions {
  /** Direct service ticket (if you already have one from CAS) */
  serviceTicket?: string;
  /** Ticket Granting Ticket (if you have one, will be used to get service ticket) */
  tgt?: string;
  /** Email/password credentials (will perform full CAS login flow) */
  credentials?: {
    /** XTB account email */
    email: string;
    /** XTB account password */
    password: string;
  };
}

/**
 * WebSocket client configuration.
 *
 * Defines connection parameters, account information, and authentication options
 * for connecting to XTB's WebSocket API.
 *
 * @example
 * ```ts
 * // Demo account configuration
 * const demoConfig: WSClientConfig = {
 *   url: 'wss://api5demoa.x-station.eu/v1/xstation',
 *   accountNumber: 12345678,
 *   auth: {
 *     credentials: {
 *       email: 'demo@example.com',
 *       password: 'demo-password'
 *     }
 *   }
 * };
 *
 * // Real account configuration
 * const realConfig: WSClientConfig = {
 *   url: 'wss://api5reala.x-station.eu/v1/xstation',
 *   accountNumber: 87654321,
 *   pingInterval: 30000,
 *   auth: {
 *     credentials: {
 *       email: 'real@example.com',
 *       password: 'real-password'
 *     }
 *   }
 * };
 * ```
 */
export interface WSClientConfig {
  /** WebSocket URL (demo: wss://api5demoa.x-station.eu/v1/xstation, real: wss://api5reala.x-station.eu/v1/xstation) */
  url: string;
  /** XTB account number */
  accountNumber: number;
  /** Server endpoint (default: 'meta1') */
  endpoint?: string;
  /** Ping interval in milliseconds (default: 10000) */
  pingInterval?: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnection delay in milliseconds (default: 30000) */
  maxReconnectDelay?: number;
  /** Application name sent in registerClientInfo (default: 'xStation5') */
  appName?: string;
  /** Application version sent in registerClientInfo (default: '2.94.1') */
  appVersion?: string;
  /** Device string sent in registerClientInfo (default: 'Linux x86_64') */
  device?: string;
  /** Authentication options (required for most operations) */
  auth?: WSAuthOptions;
}

/**
 * Symbol key format used by XTB WebSocket API.
 *
 * Format: `{assetClassId}_{symbolName}_{groupId}`
 *
 * @example
 * ```ts
 * const stockKey: SymbolKey = '9_CIG.PL_6';     // Polish stock
 * const forexKey: SymbolKey = '1_EURUSD_1';     // Forex pair
 * const indexKey: SymbolKey = '4_US30_4';       // Dow Jones index
 * ```
 */
export type SymbolKey = string;

/**
 * Client information for registerClientInfo command.
 *
 * Must match xStation5 format exactly for authentication to succeed.
 * This identifies the client application to XTB servers.
 *
 * @example
 * ```ts
 * const clientInfo: ClientInfo = {
 *   appName: 'xStation5',    // default; configurable via WSClientConfig.appName
 *   appVersion: '2.94.1',   // default; configurable via WSClientConfig.appVersion
 *   appBuildNumber: '0',
 *   device: 'Linux x86_64', // default; configurable via WSClientConfig.device
 *   osVersion: '',
 *   comment: 'Node.js WebSocket Client',
 *   apiVersion: '2.73.0',
 *   osType: 0,    // 0 = Other/Linux
 *   deviceType: 1 // 1 = Desktop
 * };
 * ```
 */
export interface ClientInfo {
  /** Application name (should be 'xStation5') */
  appName: string;
  /** Application version */
  appVersion: string;
  /** Build number */
  appBuildNumber: string;
  /** Device description */
  device: string;
  /** Operating system version */
  osVersion: string;
  /** Optional comment */
  comment: string;
  /** API version */
  apiVersion: string;
  /** OS type (0=Other/Linux, 1=Windows, 2=Mac) */
  osType: number;
  /** Device type (1=Desktop, 2=Mobile, 3=Tablet) */
  deviceType: number;
}

/**
 * Login response data from successful authentication.
 *
 * Contains account information, available endpoints, and user details
 * returned after successful CAS authentication.
 *
 * @example
 * ```ts
 * const loginResult: XLoginResult = {
 *   accountList: [
 *     {
 *       accountNo: 12345678,
 *       currency: 'PLN',
 *       endpointType: 'meta1'
 *     }
 *   ],
 *   endpointList: ['meta1', 'meta2'],
 *   userData: {
 *     name: 'John',
 *     surname: 'Smith'
 *   }
 * };
 * ```
 */
export interface XLoginResult {
  /** List of available trading accounts */
  accountList: Array<{
    /** Account number */
    accountNo: number;
    /** Account base currency */
    currency: string;
    /** Endpoint type (server) */
    endpointType: string;
  }>;
  /** Available server endpoints */
  endpointList: string[];
  /** User information */
  userData: {
    /** User's first name */
    name: string;
    /** User's last name */
    surname: string;
  };
}

/**
 * Push message structure for real-time data updates.
 *
 * Push messages have `status: 1` and contain event arrays with real-time updates
 * for subscribed data types (ticks, positions, symbols, etc.).
 *
 * @example
 * ```ts
 * // Handle incoming push messages
 * ws.on('message', (msg) => {
 *   if ('status' in msg && msg.status === 1) {
 *     const pushMsg = msg as WSPushMessage;
 *     for (const event of pushMsg.events) {
 *       if (event.eid === SubscriptionEid.TICKS && event.row.value.xcfdtick) {
 *         const tick = event.row.value.xcfdtick;
 *         console.log(`${tick.symbol}: ${tick.bid}/${tick.ask}`);
 *       }
 *     }
 *   }
 * });
 * ```
 */
export interface WSPushMessage extends WSResponse {
  /** Status 1 indicates this is a push message */
  status: 1;
  /** Array of real-time events */
  events: Array<{
    /** Element ID indicating data type */
    eid: number;
    /** Event data */
    row: {
      /** Data key (often symbol key) */
      key: string;
      /** Event payload */
      value: {
        /** Tick/quote data for EID 2 (TICKS) */
        xcfdtick?: {
          /** Symbol name */
          symbol: string;
          /** Bid price */
          bid: number;
          /** Ask price */
          ask: number;
          /** Daily high */
          high?: number;
          /** Daily low */
          low?: number;
          /** Bid volume */
          bidVolume?: number;
          /** Ask volume */
          askVolume?: number;
          /** Timestamp */
          time?: number;
        };
        /** Position/trade data for EID 1 (POSITIONS) */
        xcfdtrade?: {
          /** Symbol name */
          symbol: string;
          /** Trade side (0=buy, 1=sell) */
          side: number;
          /** Open price */
          openPrice: number;
          /** Position volume */
          volume: number;
          /** Order/position ID */
          orderId: string;
        };
        /** Symbol/instrument data for EID 3 (SYMBOLS) */
        xcfdsymbol?: {
          /** Symbol name */
          name: string;
          /** Quote ID */
          quoteId: number;
          /** Asset class ID */
          idAssetClass: number;
          /** Description */
          description: string;
          /** Price precision */
          precision: number;
          /** Group ID */
          groupId: number;
        };
        /** Allow additional data types */
        [key: string]: unknown;
      };
    };
  }>;
}

/**
 * CAS login phase types.
 *
 * Indicates current status of CAS authentication flow.
 */
export type LoginPhase = 'TGT_CREATED' | 'TWO_FACTOR_REQUIRED';

/**
 * Successful CAS login result.
 *
 * Contains TGT (Ticket Granting Ticket) ready for service ticket generation.
 */
export interface CASLoginSuccess {
  type: 'success';
  /** Ticket Granting Ticket for service ticket requests */
  tgt: string;
  /** TGT expiration timestamp */
  expiresAt: number;
}

/**
 * CAS login requiring two-factor authentication.
 *
 * User must provide OTP code using one of the available methods.
 */
export interface CASLoginTwoFactorRequired {
  type: 'requires_2fa';
  /** Session ID for 2FA submission */
  sessionId: string;
  /** Available 2FA methods (TOTP, SMS, EMAIL) */
  methods: Array<'TOTP' | 'SMS' | 'EMAIL'>;
  /** Session expiration timestamp */
  expiresAt: number;
}

/**
 * Union type for CAS login results.
 *
 * Either successful login with TGT or 2FA challenge requiring OTP code.
 */
export type CASLoginResult = CASLoginSuccess | CASLoginTwoFactorRequired;

/**
 * CAS-specific error with error codes from XTB servers.
 *
 * Common codes: CAS_GET_TGT_UNAUTHORIZED, CAS_GET_TGT_TOO_MANY_OTP_ERROR,
 * CAS_GET_TGT_OTP_LIMIT_REACHED_ERROR, CAS_GET_TGT_OTP_ACCESS_BLOCKED_ERROR
 */
export class CASError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'CASError';
  }
}
