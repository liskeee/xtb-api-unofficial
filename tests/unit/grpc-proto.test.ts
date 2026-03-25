import { describe, it, expect } from 'vitest';
import {
  encodeVarint,
  decodeVarint,
  encodeFieldVarint,
  encodeFieldBytes,
  buildNewMarketOrder,
  buildCreateAccessTokenRequest,
  buildGrpcFrame,
  buildGrpcWebTextBody,
  extractJwt,
  Side,
} from '../../src/grpc/proto.js';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('proto: varint encoding', () => {
  it('encodes small values', () => {
    expect(toHex(encodeVarint(0))).toBe('00');
    expect(toHex(encodeVarint(1))).toBe('01');
    expect(toHex(encodeVarint(127))).toBe('7f');
  });

  it('encodes multi-byte values', () => {
    expect(toHex(encodeVarint(128))).toBe('8001');
    expect(toHex(encodeVarint(300))).toBe('ac02');
    expect(toHex(encodeVarint(9438))).toBe('de49');
  });

  it('roundtrips through decode', () => {
    for (const val of [0, 1, 127, 128, 300, 9438, 65535]) {
      const encoded = encodeVarint(val);
      const [decoded, pos] = decodeVarint(encoded);
      expect(decoded).toBe(val);
      expect(pos).toBe(encoded.length);
    }
  });
});

describe('proto: buildNewMarketOrder', () => {
  it('SELL 2 CIG.PL (id=9438) matches known wire format', () => {
    const msg = buildNewMarketOrder(9438, 2, Side.SELL);
    expect(toHex(msg)).toBe('08de491204120208021802');
  });

  it('BUY 1 produces different output', () => {
    const buy = buildNewMarketOrder(9438, 1, Side.BUY);
    const sell = buildNewMarketOrder(9438, 2, Side.SELL);
    expect(toHex(buy)).not.toBe(toHex(sell));
    // BUY side = 1
    expect(buy[buy.length - 1]).toBe(1);
  });
});

describe('proto: buildCreateAccessTokenRequest', () => {
  it('produces non-empty bytes with TGT and account info', () => {
    const msg = buildCreateAccessTokenRequest('TGT-123', '51984891', 'XS-real1');
    expect(msg.length).toBeGreaterThan(0);
    // Should contain the TGT string
    const text = new TextDecoder().decode(msg);
    expect(text).toContain('TGT-123');
    expect(text).toContain('51984891');
    expect(text).toContain('XS-real1');
  });
});

describe('proto: gRPC frame', () => {
  it('builds frame with 5-byte header', () => {
    const payload = new Uint8Array([0x08, 0x01]);
    const frame = buildGrpcFrame(payload);
    expect(frame[0]).toBe(0); // flag
    expect(frame[1]).toBe(0);
    expect(frame[2]).toBe(0);
    expect(frame[3]).toBe(0);
    expect(frame[4]).toBe(2); // length
    expect(frame[5]).toBe(0x08);
    expect(frame[6]).toBe(0x01);
  });

  it('buildGrpcWebTextBody produces valid base64', () => {
    const msg = buildNewMarketOrder(9438, 2, Side.SELL);
    const body = buildGrpcWebTextBody(msg);
    // Should be valid base64
    expect(() => atob(body)).not.toThrow();
    // Should decode to gRPC frame (starts with flag=0)
    const decoded = Uint8Array.from(atob(body), c => c.charCodeAt(0));
    expect(decoded[0]).toBe(0);
  });
});

describe('proto: extractJwt', () => {
  it('extracts JWT from response bytes', () => {
    const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_here';
    const encoder = new TextEncoder();
    const data = encoder.encode(`\x00\x00\x00\x00\x10${fakeJwt}\r\ngrpc-status: 0`);
    const result = extractJwt(data);
    expect(result).toBe(fakeJwt);
  });

  it('returns null when no JWT present', () => {
    const data = new TextEncoder().encode('no jwt here');
    expect(extractJwt(data)).toBeNull();
  });
});
