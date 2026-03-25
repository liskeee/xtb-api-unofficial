/**
 * gRPC-web client for XTB xStation5 trading via Chrome DevTools Protocol.
 *
 * Requires Chrome with xStation5 open and remote debugging enabled.
 * Communicates through the Web Worker context which has clean fetch access
 * to ipax.xtb.com (the gRPC-web backend).
 *
 * Architecture:
 *   Node.js → CDP WebSocket → Chrome tab/worker → gRPC-web → ipax.xtb.com
 */

import WebSocket from 'ws';
import type { GrpcClientConfig, GrpcTradeResult } from './types.js';
import {
  GRPC_AUTH_ENDPOINT,
  GRPC_NEW_ORDER_ENDPOINT,
  GRPC_WEB_TEXT_CONTENT_TYPE,
  Side,
  buildCreateAccessTokenRequest,
  buildGrpcWebTextBody,
  buildNewMarketOrder,
  extractJwt,
} from './proto.js';

/** JWT cache lifetime in milliseconds. */
const JWT_VALIDITY_MS = 5 * 60 * 1000;

interface CDPTarget {
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export class GrpcClient {
  private cdpUrl: string;
  private accountNumber: string;
  private accountServer: string;
  private jwt: string | null = null;
  private jwtTimestamp = 0;
  private workerWsUrl: string | null = null;
  private pageWsUrl: string | null = null;
  private cdpMsgId = 0;

  constructor(config: GrpcClientConfig = {}) {
    this.cdpUrl = config.cdpUrl ?? 'http://localhost:18800';
    this.accountNumber = config.accountNumber ?? '51984891';
    this.accountServer = config.accountServer ?? 'XS-real1';
  }

  // ── CDP Discovery ──────────────────────────────────────────

  private async discoverTargets(): Promise<[string | null, string | null]> {
    const resp = await fetch(`${this.cdpUrl}/json/list`);
    const targets: CDPTarget[] = await resp.json();

    let pageWs: string | null = null;
    let workerWs: string | null = null;

    for (const target of targets) {
      const url = target.url ?? '';
      const type = target.type ?? '';
      const wsUrl = target.webSocketDebuggerUrl ?? '';
      if (!wsUrl) continue;

      if (type === 'page' && (url.toLowerCase().includes('xstation5') || url.toLowerCase().includes('xtb'))) {
        pageWs = wsUrl;
      }
      if (type === 'worker' && (url.toLowerCase().includes('worker') || url.toLowerCase().includes('socket'))) {
        workerWs = wsUrl;
      }
    }

    // Fallback: use first page if no xStation5 found
    if (!pageWs) {
      for (const target of targets) {
        if (target.type === 'page' && target.webSocketDebuggerUrl) {
          pageWs = target.webSocketDebuggerUrl;
          break;
        }
      }
    }

    return [pageWs, workerWs];
  }

  private nextId(): number {
    return ++this.cdpMsgId;
  }

  // ── CDP Communication ──────────────────────────────────────

  private cdpSend(
    ws: WebSocket,
    method: string,
    params?: Record<string, unknown>,
    timeout = 15_000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const msgId = this.nextId();
      const msg: Record<string, unknown> = { id: msgId, method };
      if (params) msg.params = params;

      const timer = setTimeout(() => {
        ws.removeListener('message', handler);
        reject(new Error(`CDP timeout waiting for response to ${method}`));
      }, timeout);

      const handler = (raw: WebSocket.Data) => {
        const response = JSON.parse(raw.toString());
        if (response.id !== msgId) return;
        clearTimeout(timer);
        ws.removeListener('message', handler);
        if (response.error) {
          reject(new Error(`CDP error (${method}): ${JSON.stringify(response.error)}`));
        } else {
          resolve(response.result ?? {});
        }
      };

      ws.on('message', handler);
      ws.send(JSON.stringify(msg));
    });
  }

  private async evaluateJs(
    ws: WebSocket,
    expression: string,
    awaitPromise = true,
    timeout = 15_000,
  ): Promise<unknown> {
    const params: Record<string, unknown> = {
      expression,
      returnByValue: true,
    };
    if (awaitPromise) params.awaitPromise = true;

    const result = await this.cdpSend(ws, 'Runtime.evaluate', params, timeout) as Record<string, unknown>;

    if ('exceptionDetails' in result) {
      const exc = result.exceptionDetails as Record<string, unknown>;
      const text = (exc.text ?? '') as string;
      const exception = (exc.exception ?? {}) as Record<string, unknown>;
      const desc = (exception.description ?? exception.value ?? '') as string;
      throw new Error(`JS error: ${text} — ${desc}`);
    }

    return ((result.result ?? {}) as Record<string, unknown>).value;
  }

  // ── gRPC-web via CDP ───────────────────────────────────────

  private async grpcCallViaWorker(
    workerWsUrl: string,
    endpoint: string,
    bodyB64: string,
    jwt?: string,
  ): Promise<Uint8Array> {
    const headers: Record<string, string> = {
      'Content-Type': GRPC_WEB_TEXT_CONTENT_TYPE,
      'Accept': GRPC_WEB_TEXT_CONTENT_TYPE,
      'X-Grpc-Web': '1',
      'x-user-agent': 'grpc-web-javascript/0.1',
    };
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

    const js = `
      (async () => {
        const resp = await fetch("${endpoint}", {
          method: "POST",
          headers: ${JSON.stringify(headers)},
          body: "${bodyB64}",
          credentials: "include",
        });
        return await resp.text();
      })()
    `;

    const ws = new WebSocket(workerWsUrl);
    try {
      await waitForOpen(ws);
      const result = await this.evaluateJs(ws, js, true, 20_000);
      if (!result) throw new Error('Worker fetch returned empty response');
      return base64ToUint8(result as string);
    } finally {
      ws.close();
    }
  }

  private async grpcCallViaIsolatedWorld(
    pageWsUrl: string,
    endpoint: string,
    bodyB64: string,
    jwt?: string,
  ): Promise<Uint8Array> {
    const headers: Record<string, string> = {
      'Content-Type': GRPC_WEB_TEXT_CONTENT_TYPE,
      'Accept': GRPC_WEB_TEXT_CONTENT_TYPE,
      'X-Grpc-Web': '1',
      'x-user-agent': 'grpc-web-javascript/0.1',
    };
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

    const js = `
      (async () => {
        const resp = await fetch("${endpoint}", {
          method: "POST",
          headers: ${JSON.stringify(headers)},
          body: "${bodyB64}",
          credentials: "include",
        });
        return await resp.text();
      })()
    `;

    const ws = new WebSocket(pageWsUrl);
    try {
      await waitForOpen(ws);
      const frameTree = await this.cdpSend(ws, 'Page.getFrameTree') as Record<string, unknown>;
      const frameId = ((frameTree.frameTree as Record<string, unknown>).frame as Record<string, string>).id;

      const world = await this.cdpSend(ws, 'Page.createIsolatedWorld', {
        frameId,
        worldName: 'grpc_client',
        grantUniveralAccess: true,
      }) as Record<string, number>;
      const contextId = world.executionContextId;

      const result = await this.cdpSend(ws, 'Runtime.evaluate', {
        expression: js,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      }, 20_000) as Record<string, unknown>;

      if ('exceptionDetails' in result) {
        const exc = result.exceptionDetails as Record<string, unknown>;
        const desc = ((exc.exception as Record<string, string>)?.description ?? (exc as Record<string, string>).text ?? 'unknown');
        throw new Error(`Isolated world JS error: ${desc}`);
      }

      const b64Result = ((result.result ?? {}) as Record<string, unknown>).value as string | undefined;
      if (!b64Result) throw new Error('Isolated world fetch returned empty response');
      return base64ToUint8(b64Result);
    } finally {
      ws.close();
    }
  }

  private async grpcCallViaPage(
    pageWsUrl: string,
    endpoint: string,
    bodyB64: string,
    jwt?: string,
  ): Promise<Uint8Array> {
    const headers: Record<string, string> = {
      'Content-Type': GRPC_WEB_TEXT_CONTENT_TYPE,
      'Accept': GRPC_WEB_TEXT_CONTENT_TYPE,
      'X-Grpc-Web': '1',
      'x-user-agent': 'grpc-web-javascript/0.1',
    };
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

    const js = `
      (async () => {
        let cleanFetch = window.fetch;
        try {
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          document.body.appendChild(iframe);
          cleanFetch = iframe.contentWindow.fetch.bind(iframe.contentWindow);
          document.body.removeChild(iframe);
        } catch(e) {}
        const resp = await cleanFetch("${endpoint}", {
          method: "POST",
          headers: ${JSON.stringify(headers)},
          body: "${bodyB64}",
          credentials: "include",
        });
        return await resp.text();
      })()
    `;

    const ws = new WebSocket(pageWsUrl);
    try {
      await waitForOpen(ws);
      const result = await this.evaluateJs(ws, js, true, 20_000);
      if (!result) throw new Error('Page fetch returned empty response');
      return base64ToUint8(result as string);
    } finally {
      ws.close();
    }
  }

  private async grpcCall(
    endpoint: string,
    bodyB64: string,
    jwt?: string,
  ): Promise<Uint8Array> {
    if (!this.pageWsUrl) {
      [this.pageWsUrl, this.workerWsUrl] = await this.discoverTargets();
    }

    // Approach 1: Worker (clean fetch)
    if (this.workerWsUrl) {
      try {
        return await this.grpcCallViaWorker(this.workerWsUrl, endpoint, bodyB64, jwt);
      } catch {
        // fall through to approach 2
      }
    }

    // Approach 2: Isolated world on page
    if (this.pageWsUrl) {
      try {
        return await this.grpcCallViaIsolatedWorld(this.pageWsUrl, endpoint, bodyB64, jwt);
      } catch {
        // fall through to approach 3
      }

      // Approach 3: Direct page eval with iframe fetch restoration
      try {
        return await this.grpcCallViaPage(this.pageWsUrl, endpoint, bodyB64, jwt);
      } catch (e) {
        throw new Error(`All CDP fetch approaches failed. Last error: ${e}`);
      }
    }

    throw new Error(
      `No CDP targets available. Is Chrome running with --remote-debugging-port on ${this.cdpUrl}?`,
    );
  }

  // ── Public API ─────────────────────────────────────────────

  /** Discover xStation5 tab and Worker via CDP. */
  async connect(): Promise<void> {
    const [pageWs, workerWs] = await this.discoverTargets();
    this.pageWsUrl = pageWs;
    this.workerWsUrl = workerWs;

    if (!pageWs) {
      throw new Error(
        `No Chrome page target found. Is Chrome running with --remote-debugging-port on ${this.cdpUrl}?`,
      );
    }
  }

  /**
   * Get JWT with account scope via CreateAccessToken gRPC call.
   * @param tgt - TGT (Ticket Granting Ticket) from CAS authentication.
   * @returns JWT string with acn/acs fields for trading.
   */
  async getJwt(tgt: string): Promise<string> {
    const now = Date.now();
    if (this.jwt && (now - this.jwtTimestamp) < JWT_VALIDITY_MS) {
      return this.jwt;
    }

    const protoMsg = buildCreateAccessTokenRequest(
      tgt,
      this.accountNumber,
      this.accountServer,
    );
    const bodyB64 = buildGrpcWebTextBody(protoMsg);

    const responseBytes = await this.grpcCall(GRPC_AUTH_ENDPOINT, bodyB64);

    const jwt = extractJwt(responseBytes);
    if (!jwt) {
      throw new Error(
        `Failed to extract JWT from CreateAccessToken response (${responseBytes.length} bytes). ` +
        'Check that TGT is valid and account info is correct.',
      );
    }

    this.jwt = jwt;
    this.jwtTimestamp = now;
    return jwt;
  }

  /** Execute BUY market order. */
  async buy(instrumentId: number, volume: number): Promise<GrpcTradeResult> {
    return this.executeOrder(instrumentId, volume, Side.BUY);
  }

  /** Execute SELL market order. */
  async sell(instrumentId: number, volume: number): Promise<GrpcTradeResult> {
    return this.executeOrder(instrumentId, volume, Side.SELL);
  }

  /**
   * Execute market order via gRPC-web NewMarketOrder.
   * @param instrumentId - gRPC instrument ID (e.g., 9438 for CIG.PL)
   * @param volume - Number of shares
   * @param side - Side.BUY or Side.SELL
   */
  async executeOrder(
    instrumentId: number,
    volume: number,
    side: Side,
  ): Promise<GrpcTradeResult> {
    if (!this.jwt) {
      throw new Error('No JWT — call getJwt(tgt) first');
    }

    const protoMsg = buildNewMarketOrder(instrumentId, volume, side);
    const bodyB64 = buildGrpcWebTextBody(protoMsg);

    let responseBytes: Uint8Array;
    try {
      responseBytes = await this.grpcCall(GRPC_NEW_ORDER_ENDPOINT, bodyB64, this.jwt);
    } catch (e) {
      return { success: false, grpcStatus: 0, error: String(e) };
    }

    return this.parseTradeResponse(responseBytes);
  }

  /** Clean up resources. */
  async disconnect(): Promise<void> {
    this.jwt = null;
    this.jwtTimestamp = 0;
    this.pageWsUrl = null;
    this.workerWsUrl = null;
  }

  // ── Response parsing ───────────────────────────────────────

  private parseTradeResponse(responseBytes: Uint8Array): GrpcTradeResult {
    // Decode as latin-1
    let responseText = '';
    for (let i = 0; i < responseBytes.length; i++) {
      responseText += String.fromCharCode(responseBytes[i]);
    }

    // Success: grpc-status 0 or data frame (0x00 prefix)
    if (responseText.includes('grpc-status: 0') || (responseBytes.length > 5 && responseBytes[0] === 0)) {
      const uuidMatch = responseText.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
      return {
        success: true,
        orderId: uuidMatch?.[0],
        grpcStatus: 0,
      };
    }

    // Error cases
    let errorMsg = `gRPC order rejected: ${responseText.slice(0, 200)}`;
    if (responseText.includes('RBAC')) {
      errorMsg = 'gRPC RBAC: access denied — JWT may be expired';
    } else if (responseText.includes('grpc-message:')) {
      for (const line of responseText.split('\r\n')) {
        if (line.startsWith('grpc-message:')) {
          errorMsg = `gRPC error: ${line}`;
          break;
        }
      }
    }

    let grpcStatus = 0;
    const statusMatch = responseText.match(/grpc-status:\s*(\d+)/);
    if (statusMatch) {
      grpcStatus = parseInt(statusMatch[1], 10);
    }

    return { success: false, grpcStatus, error: errorMsg };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
