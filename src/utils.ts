import type { IPrice, IVolume } from './types/index.js';

/** Create IPrice from decimal: priceFromDecimal(2.62, 2) → { value: 262, scale: 2 } */
export function priceFromDecimal(price: number, precision: number): IPrice {
  const value = Math.round(price * Math.pow(10, precision));
  return { value, scale: precision };
}

/** Convert IPrice to decimal: priceToDecimal({ value: 262, scale: 2 }) → 2.62 */
export function priceToDecimal(price: IPrice): number {
  return price.value * Math.pow(10, -price.scale);
}

/** Create IVolume: volumeFrom(19) → { value: 19, scale: 0 } */
export function volumeFrom(qty: number, scale = 0): IVolume {
  return { value: qty, scale };
}

/** Generate unique request ID */
export function generateReqId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

/** Build accountId: "meta1_{accountNumber}" */
export function buildAccountId(accountNumber: number, endpoint = 'meta1'): string {
  return `${endpoint}_${accountNumber}`;
}

/** Parse symbol key: "9_CIG.PL_6" → { assetClassId: 9, symbolName: "CIG.PL", groupId: 6 } */
export function parseSymbolKey(key: string) {
  const parts = key.split('_');
  if (parts.length < 3) return null;
  return {
    assetClassId: parseInt(parts[0], 10),
    symbolName: parts.slice(1, -1).join('_'),
    groupId: parseInt(parts[parts.length - 1], 10),
  };
}

/** Sleep helper */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
