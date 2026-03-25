/**
 * Minimal protobuf encoder/decoder for XTB gRPC-web protocol.
 *
 * No external dependencies — manual varint/length-delimited encoding
 * matching the wire format observed in HAR captures from xStation5.
 */

// ── Side enum ────────────────────────────────────────────────

export enum Side {
  BUY = 1,
  SELL = 2,
}

// ── gRPC-web endpoints ──────────────────────────────────────

export const GRPC_BASE_URL = 'https://ipax.xtb.com';

export const GRPC_AUTH_ENDPOINT =
  `${GRPC_BASE_URL}/pl.xtb.ipax.pub.grpc.auth.v2.AuthService/CreateAccessToken`;

export const GRPC_NEW_ORDER_ENDPOINT =
  `${GRPC_BASE_URL}/pl.xtb.ipax.pub.grpc.cashtradingneworder.v1.CashTradingNewOrderService/NewMarketOrder`;

export const GRPC_CONFIRM_ENDPOINT =
  `${GRPC_BASE_URL}/pl.xtb.ipax.pub.grpc.cashtradingconfirmation.v1.CashTradingConfirmationService/SubscribeNewMarketOrderConfirmation`;

export const GRPC_CLOSE_POSITION_ENDPOINT =
  `${GRPC_BASE_URL}/pl.xtb.ipax.pub.grpc.cashtradingneworder.v1.CashTradingNewOrderService/CloseSinglePosition`;

export const GRPC_WEB_TEXT_CONTENT_TYPE = 'application/grpc-web-text';

// ── Varint encoding/decoding ────────────────────────────────

export function encodeVarint(value: number): Uint8Array {
  const parts: number[] = [];
  while (value > 0x7f) {
    parts.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  parts.push(value & 0x7f);
  return new Uint8Array(parts);
}

export function decodeVarint(data: Uint8Array, pos: number = 0): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < data.length) {
    const byte = data[pos];
    result |= (byte & 0x7f) << shift;
    pos++;
    if (!(byte & 0x80)) {
      return [result, pos];
    }
    shift += 7;
  }
  throw new Error('Truncated varint');
}

// ── Field encoding ──────────────────────────────────────────

export function encodeFieldVarint(fieldNum: number, value: number): Uint8Array {
  const tag = encodeVarint((fieldNum << 3) | 0); // wire type 0
  const val = encodeVarint(value);
  return concat(tag, val);
}

export function encodeFieldBytes(fieldNum: number, data: Uint8Array): Uint8Array {
  const tag = encodeVarint((fieldNum << 3) | 2); // wire type 2
  const len = encodeVarint(data.length);
  return concat(tag, len, data);
}

// ── Message builders ────────────────────────────────────────

/**
 * Build NewMarketOrder protobuf message.
 *
 * Wire format (from HAR analysis):
 *   Field 1 (varint): instrumentId
 *   Field 2 (bytes):  order { Field 2 (bytes): volume { Field 1 (varint): value } }
 *   Field 3 (varint): side
 */
export function buildNewMarketOrder(
  instrumentId: number,
  volume: number,
  side: Side,
): Uint8Array {
  const volumeMsg = encodeFieldVarint(1, volume);
  const orderMsg = encodeFieldBytes(2, volumeMsg);
  return concat(
    encodeFieldVarint(1, instrumentId),
    encodeFieldBytes(2, orderMsg),
    encodeFieldVarint(3, side),
  );
}

/**
 * Build CreateAccessTokenRequest protobuf.
 *
 * Proto structure:
 *   message CreateAccessTokenRequest {
 *       string tgt = 1;
 *       Account account = 2;
 *   }
 *   message Account {
 *       string number = 1;
 *       string server = 2;
 *   }
 */
export function buildCreateAccessTokenRequest(
  tgt: string,
  accountNumber: string,
  accountServer: string,
): Uint8Array {
  const encoder = new TextEncoder();
  const accountMsg = concat(
    encodeFieldBytes(1, encoder.encode(accountNumber)),
    encodeFieldBytes(2, encoder.encode(accountServer)),
  );
  return concat(
    encodeFieldBytes(1, encoder.encode(tgt)),
    encodeFieldBytes(2, accountMsg),
  );
}

// ── gRPC frame handling ─────────────────────────────────────

/** Wrap protobuf message in a gRPC-web frame (flag=0 + 4-byte BE length + payload). */
export function buildGrpcFrame(protoMsg: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + protoMsg.length);
  frame[0] = 0; // flag: uncompressed data frame
  const view = new DataView(frame.buffer);
  view.setUint32(1, protoMsg.length, false); // big-endian length
  frame.set(protoMsg, 5);
  return frame;
}

/** Build gRPC-web-text body (base64-encoded gRPC frame). */
export function buildGrpcWebTextBody(protoMsg: Uint8Array): string {
  const frame = buildGrpcFrame(protoMsg);
  return uint8ToBase64(frame);
}

/** Parse one or more gRPC-web frames from response data. */
export function parseGrpcFrames(data: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let pos = 0;
  while (pos + 5 <= data.length) {
    const view = new DataView(data.buffer, data.byteOffset + pos + 1, 4);
    const length = view.getUint32(0, false);
    pos += 5;
    if (pos + length > data.length) break;
    frames.push(data.slice(pos, pos + length));
    pos += length;
  }
  return frames;
}

/** Extract JWT token from gRPC response bytes. */
export function extractJwt(data: Uint8Array): string | null {
  // Decode as latin-1 (each byte → same code point)
  let text = '';
  for (let i = 0; i < data.length; i++) {
    text += String.fromCharCode(data[i]);
  }
  const match = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return match ? match[0] : null;
}

// ── Helpers ─────────────────────────────────────────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
