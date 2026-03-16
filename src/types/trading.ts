import { Xs6Side } from './enums.js';

/**
 * Price representation with value and scale.
 *
 * XTB uses scaled integers for precise price representation.
 * Actual price = value × 10^(-scale)
 *
 * @example
 * ```ts
 * // Price of $2.62
 * const price: IPrice = { value: 262, scale: 2 };
 * const actualPrice = price.value * Math.pow(10, -price.scale); // 2.62
 * ```
 */
export interface IPrice {
  /** Price value as scaled integer */
  value: number;
  /** Decimal places (negative power of 10) */
  scale: number;
}

/**
 * Volume representation with value and scale.
 *
 * Similar to price, volume uses scaled representation for precision.
 * Actual volume = value × 10^(-scale)
 *
 * @example
 * ```ts
 * // 19 shares
 * const volume: IVolume = { value: 19, scale: 0 };
 *
 * // 1.5 lots
 * const fractionalVolume: IVolume = { value: 15, scale: 1 };
 * ```
 */
export interface IVolume {
  /** Volume value as scaled integer */
  value: number;
  /** Decimal places (negative power of 10) */
  scale: number;
}

/**
 * Trade size specification.
 *
 * Can be specified either by volume (shares/lots) or by monetary amount.
 * Use volume for equity trading, amount for currency-based sizing.
 *
 * @example
 * ```ts
 * // Buy 100 shares
 * const sizeByVolume: ISize = {
 *   volume: { value: 100, scale: 0 }
 * };
 *
 * // Buy $1000 worth
 * const sizeByAmount: ISize = {
 *   amount: 1000
 * };
 * ```
 */
export interface ISize {
  /** Trade volume in shares/lots */
  volume?: IVolume;
  /** Trade amount in currency */
  amount?: number;
}

/**
 * Stop loss configuration.
 *
 * Can be either a fixed price or a trailing stop based on pips.
 */
export interface IStopLossInput {
  /** Fixed stop loss price */
  price?: IPrice;
  /** Trailing stop configuration */
  trailingstopinput?: {
    /** Trailing distance in pips */
    pips?: number;
  };
}

/**
 * Take profit configuration.
 *
 * Specifies the price at which to close the position for profit.
 */
export interface ITakeProfitInput {
  /** Take profit price */
  price?: IPrice;
}

/**
 * Market order definition for WebSocket trading.
 *
 * Represents a complete market order with instrument, size, direction,
 * and optional stop loss/take profit levels.
 *
 * @example
 * ```ts
 * const buyOrder: INewMarketOrder = {
 *   instrumentid: 12345,
 *   size: { volume: { value: 100, scale: 0 } },
 *   side: Xs6Side.BUY,
 *   stoploss: { price: { value: 250, scale: 2 } }, // $2.50
 *   takeprofit: { price: { value: 280, scale: 2 } } // $2.80
 * };
 * ```
 */
export interface INewMarketOrder {
  /** Instrument ID from symbol search */
  instrumentid: number;
  /** Trade size (volume or amount) */
  size: ISize;
  /** Trade side (buy/sell) */
  side: Xs6Side;
  /** Optional stop loss configuration */
  stoploss?: IStopLossInput;
  /** Optional take profit configuration */
  takeprofit?: ITakeProfitInput;
}

/**
 * Account information for authentication.
 *
 * Used in trade events to specify which account to execute the trade on.
 */
export interface IXs6AuthAccount {
  /** Account number */
  number: number;
  /** Server endpoint (e.g., 'meta1') */
  server: string;
  /** Account base currency */
  currency: string;
}

/**
 * Complete market order event for WebSocket API.
 *
 * Wraps the order definition with account info and tracking ID.
 * This is what gets sent in the tradeTransaction WebSocket command.
 *
 * @example
 * ```ts
 * const orderEvent: INewMarketOrderEvent = {
 *   order: {
 *     instrumentid: 12345,
 *     size: { volume: { value: 100, scale: 0 } },
 *     side: Xs6Side.BUY
 *   },
 *   uiTrackingId: `trade_${Date.now()}`,
 *   account: {
 *     number: 12345678,
 *     server: 'meta1',
 *     currency: 'PLN'
 *   }
 * };
 * ```
 */
export interface INewMarketOrderEvent {
  /** Market order definition */
  order: INewMarketOrder;
  /** Optional UI tracking identifier */
  uiTrackingId?: string;
  /** Account to execute trade on */
  account: IXs6AuthAccount;
}

/**
 * Simplified trade options for high-level API.
 *
 * Provides an easy-to-use interface for common trading parameters
 * without dealing with the low-level scaled price representations.
 *
 * @example
 * ```ts
 * const options: TradeOptions = {
 *   stopLoss: 2.50,      // Stop at $2.50
 *   takeProfit: 3.00,    // Take profit at $3.00
 *   trailingStop: 10     // 10-pip trailing stop
 * };
 *
 * await client.buy('AAPL.US', 100, options);
 * ```
 */
export interface TradeOptions {
  /** Stop loss price (as decimal number) */
  stopLoss?: number;
  /** Take profit price (as decimal number) */
  takeProfit?: number;
  /** Trailing stop distance in pips */
  trailingStop?: number;
  /** Trade amount in currency (alternative to volume) */
  amount?: number;
}

/**
 * Open trading position information.
 *
 * Represents a currently open position with profit/loss calculations,
 * stop loss/take profit levels, and other position details.
 *
 * @example
 * ```ts
 * const position: Position = {
 *   symbol: 'AAPL.US',
 *   volume: 100,
 *   side: 'buy',
 *   openPrice: 150.25,
 *   currentPrice: 152.80,
 *   profitNet: 255.00,
 *   stopLoss: 148.00,
 *   takeProfit: 160.00
 * };
 * ```
 */
export interface Position {
  /** Symbol name */
  symbol: string;
  /** Instrument ID for this symbol */
  instrumentId?: number;
  /** Position volume (number of shares/lots) */
  volume: number;
  /** Current market price */
  currentPrice: number;
  /** Price at which position was opened */
  openPrice: number;
  /** Stop loss price (if set) */
  stopLoss?: number;
  /** Take profit price (if set) */
  takeProfit?: number;
  /** Profit/loss as percentage */
  profitPercent: number;
  /** Net profit/loss in account currency */
  profitNet: number;
  /** Swap/rollover fees */
  swap?: number;
  /** Position side */
  side: 'buy' | 'sell';
  /** Order/position ID */
  orderId?: string;
  /** Trading commission paid */
  commission?: number;
  /** Margin required for this position */
  margin?: number;
  /** Position open time (Unix timestamp) */
  openTime?: number;
}

/**
 * Account balance and equity information.
 *
 * Provides complete financial overview of the trading account.
 *
 * @example
 * ```ts
 * const balance: AccountBalance = {
 *   balance: 10000.00,     // Account balance
 *   equity: 10250.00,      // Current equity (balance + unrealized P&L)
 *   freeMargin: 8500.00,   // Available margin for new trades
 *   currency: 'USD',       // Account currency
 *   accountNumber: 12345678
 * };
 * ```
 */
export interface AccountBalance {
  /** Account balance (deposited funds) */
  balance: number;
  /** Current equity (balance + unrealized P&L) */
  equity: number;
  /** Free margin available for trading */
  freeMargin: number;
  /** Account base currency */
  currency: string;
  /** Account number */
  accountNumber: number;
}

/**
 * Trade execution result.
 *
 * Contains the outcome of a trade execution attempt, including
 * success status, order details, and error information if applicable.
 *
 * @example
 * ```ts
 * // Successful trade
 * const success: TradeResult = {
 *   success: true,
 *   orderId: 'ORD123456',
 *   symbol: 'AAPL.US',
 *   side: 'buy',
 *   volume: 100,
 *   price: 150.25
 * };
 *
 * // Failed trade
 * const failure: TradeResult = {
 *   success: false,
 *   symbol: 'INVALID',
 *   side: 'buy',
 *   error: 'Symbol not found'
 * };
 * ```
 */
export interface TradeResult {
  /** Whether trade was executed successfully */
  success: boolean;
  /** Order ID if trade was successful */
  orderId?: string;
  /** Symbol that was traded */
  symbol: string;
  /** Trade side (buy/sell) */
  side: 'buy' | 'sell';
  /** Volume traded */
  volume?: number;
  /** Execution price */
  price?: number;
  /** Error message if trade failed */
  error?: string;
}
