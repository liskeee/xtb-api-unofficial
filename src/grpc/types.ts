/** Configuration for gRPC-web client. */
export interface GrpcClientConfig {
  /** CDP HTTP endpoint (default: http://localhost:18800) */
  cdpUrl?: string;
  /** XTB account number (default: 51984891) */
  accountNumber?: string;
  /** XTB account server (default: XS-real1) */
  accountServer?: string;
}

/** Result of a gRPC-web trade execution. */
export interface GrpcTradeResult {
  success: boolean;
  orderId?: string;
  grpcStatus: number;
  error?: string;
}
