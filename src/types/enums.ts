/**
 * Trade side enumeration for buy/sell operations.
 *
 * Used in trading commands to specify whether to buy or sell an instrument.
 *
 * @example
 * ```ts
 * const buyOrder: INewMarketOrder = {
 *   instrumentid: 12345,
 *   size: { volume: { value: 100, scale: 0 } },
 *   side: Xs6Side.BUY
 * };
 * ```
 */
export enum Xs6Side {
  /** No side specified (default/unset) */
  SIDE_NOT_SET = 0,
  /** Buy side - open long position */
  BUY = 1,
  /** Sell side - open short position */
  SELL = 2,
}

/**
 * Trade command types for different order types.
 *
 * Specifies the type of order to execute - market orders execute immediately,
 * while limit and stop orders wait for specific price conditions.
 */
export enum TradeCommand {
  /** Market buy order - execute immediately at current market price */
  BUY = 0,
  /** Market sell order - execute immediately at current market price */
  SELL = 1,
  /** Limit buy order - execute when price drops to or below specified level */
  BUY_LIMIT = 2,
  /** Limit sell order - execute when price rises to or above specified level */
  SELL_LIMIT = 3,
  /** Stop buy order - execute when price rises to or above specified level */
  BUY_STOP = 4,
  /** Stop sell order - execute when price drops to or below specified level */
  SELL_STOP = 5,
}

/**
 * Trade type classification for order execution.
 *
 * Determines how the order will be executed in the market.
 */
export enum TradeType {
  /** Market order - execute immediately at best available price */
  MARKET = 0,
  /** Limit order - execute only at specified price or better */
  LIMIT = 1,
  /** Stop order - execute when price reaches specified trigger level */
  STOP = 2,
}

/**
 * Field identifiers for trade request data.
 *
 * Used internally by the WebSocket protocol to identify different
 * parts of a trade request message.
 */
export enum RequestTradeData {
  TYPE = 1,
  TRADE_TYPE = 2,
  SIDE = 3,
  VOLUME = 4,
  AMOUNT = 5,
  /** Stop Loss */
  SL = 6,
  /** Take Profit */
  TP = 7,
  OFFSET = 8,
  PRICE = 9,
  EXPIRATION = 10,
  ORDER_ID = 11,
  INSTRUMENT_ID = 12,
  /** Stop Loss Amount */
  SL_AMOUNT = 13,
  /** Take Profit Amount */
  TP_AMOUNT = 14,
  SYMBOL_KEY = 15,
}

/**
 * Symbol trading session status.
 *
 * Indicates whether an instrument is currently available for trading.
 */
export enum SymbolSessionType {
  /** Market is closed - trading not available */
  CLOSED = 0,
  /** Market is open - trading available */
  OPEN = 1,
  /** Pre-market or after-hours session */
  LOBBY = 2,
}

/**
 * WebSocket connection status enumeration.
 *
 * Tracks the current state of the WebSocket connection to XTB servers.
 *
 * @example
 * ```ts
 * ws.on('statusUpdate', (status) => {
 *   switch (status) {
 *     case SocketStatus.CONNECTED:
 *       console.log('WebSocket connected');
 *       break;
 *     case SocketStatus.DISCONNECTED:
 *       console.log('WebSocket disconnected');
 *       break;
 *   }
 * });
 * ```
 */
export enum SocketStatus {
  /** Establishing WebSocket connection */
  CONNECTING = 'CONNECTING',
  /** WebSocket connected and ready */
  CONNECTED = 'CONNECTED',
  /** Closing WebSocket connection */
  DISCONNECTING = 'DISCONNECTING',
  /** WebSocket connection closed */
  CLOSED = 'CLOSED',
  /** WebSocket connection error */
  ERROR = 'SOCKET_ERROR',
}

/**
 * XTB trading environment type.
 *
 * Specifies whether to connect to real trading or demo environment.
 *
 * @example
 * ```ts
 * const demoUrl = 'wss://api5demoa.x-station.eu/v1/xstation'; // XTBEnvironment.DEMO
 * const realUrl = 'wss://api5reala.x-station.eu/v1/xstation'; // XTBEnvironment.REAL
 * ```
 */
export enum XTBEnvironment {
  /** Real trading environment - executes real trades with real money */
  REAL = 'real',
  /** Demo trading environment - paper trading with virtual money */
  DEMO = 'demo',
}
