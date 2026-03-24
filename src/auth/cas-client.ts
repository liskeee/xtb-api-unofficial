/**
 * CAS (Central Authentication Service) client for XTB xStation5 WebSocket authentication.
 * Handles the complete auth flow: login → TGT → Service Ticket → WebSocket login.
 */

import { createHash } from 'crypto';
import type { CASLoginResult } from '../types/websocket.js';
import { CASError } from '../types/websocket.js';


export interface CASServiceTicketResult {
  serviceTicket: string;
  service: string;
}

export interface CASClientConfig {
  /** Base CAS URL. Default: https://xstation.xtb.com/signon/ */
  baseUrl?: string;
  /** Timezone offset for CAS v2. Default: auto-detected */
  timezoneOffset?: string;
  /** User-Agent header for CAS requests. Default: 'xStation5/2.94.1 (Linux x86_64)' */
  userAgent?: string;
}

/**
 * CAS authentication client for XTB xStation5.
 *
 * Flow:
 * 1. login(email, password) → TGT (Ticket Granting Ticket)
 * 2. getServiceTicket(tgt, 'xapi5') → ST (Service Ticket)
 * 3. Use ST with WebSocket loginWithServiceTicket
 *
 * Critical: Use service='xapi5' for WebSocket, NOT 'abigail' (that's for REST API)
 */
export class CASClient {
  private config: Required<CASClientConfig>;

  constructor(config: CASClientConfig = {}) {
    this.config = {
      baseUrl: 'https://xstation.xtb.com/signon/',
      timezoneOffset: this.getTimezoneOffset(),
      userAgent: 'xStation5/2.94.1 (Linux x86_64)',
      ...config,
    };
  }

  /**
   * Login with email/password using CAS v2 with v1 fallback.
   *
   * Tries CAS v2 first (supports 2FA), falls back to CAS v1 (no 2FA) if v2 unavailable.
   *
   * @param email - XTB account email
   * @param password - XTB account password
   * @returns Either success with TGT or 2FA challenge requiring OTP code
   * @throws CASError if credentials invalid, account blocked, or service unavailable
   */
  async login(email: string, password: string): Promise<CASLoginResult> {
    try {
      // Try CAS v2 first (supports 2FA)
      return await this.loginV2(email, password);
    } catch (error) {
      // If v2 fails due to service issues (not auth), try v1 fallback
      if (error instanceof CASError && !error.code.includes('UNAUTHORIZED')) {
        try {
          return await this.loginV1(email, password);
        } catch (v1Error) {
          // If both fail, throw the original v2 error
          throw error;
        }
      }
      throw error;
    }
  }

  /**
   * Login with email/password using CAS v2.
   *
   * @param email - XTB account email
   * @param password - XTB account password
   * @returns Either success with TGT or 2FA challenge requiring OTP code
   * @throws CASError if credentials invalid, account blocked, or service unavailable
   */
  private async loginV2(email: string, password: string): Promise<CASLoginResult> {
    const ticketsUrl = new URL('v2/tickets', this.config.baseUrl);
    const userAgent = this.config.userAgent;
    const fingerprint = this.generateFingerprint(userAgent);

    const payload = {
      username: email,         // [REDACTED] - user email
      password: password,      // [REDACTED] - user password
      fingerprint,
      rememberMe: false,
    };

    const response = await fetch(ticketsUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Time-Zone': this.config.timezoneOffset,
        'User-Agent': userAgent,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new CASError('CAS_GET_TGT_UNAUTHORIZED', 'Invalid credentials');
      }
      const errorText = await response.text();
      throw new CASError('CAS_LOGIN_FAILED', `CAS v2 login failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    // Handle success case (no 2FA required)
    if (result.loginPhase === 'TGT_CREATED' && result.ticket) {
      const tgt = result.ticket;
      const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours

      return {
        type: 'success',
        tgt,
        expiresAt,
      };
    }

    // Handle 2FA required case
    if (result.loginPhase === 'TWO_FACTOR_REQUIRED' && (result.loginTicket || result.sessionId)) {
      const sessionExpiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes for 2FA session
      const loginTicket = result.loginTicket || result.sessionId;

      return {
        type: 'requires_2fa',
        loginTicket,
        sessionId: result.sessionId || loginTicket, // backward compat
        methods: result.methods || ['TOTP'],
        expiresAt: sessionExpiresAt,
        twoFactorAuthType: result.twoFactorAuthType || 'SMS',
      };
    }

    // Handle specific error codes from XTB
    if (result.code) {
      switch (result.code) {
        case 'CAS_GET_TGT_UNAUTHORIZED':
          throw new CASError(result.code, 'Invalid email or password');
        case 'CAS_GET_TGT_TOO_MANY_OTP_ERROR':
          throw new CASError(result.code, `Too many OTP attempts. Wait ${result.data?.otpThrottleTimeRemaining || 60}s`);
        case 'CAS_GET_TGT_OTP_LIMIT_REACHED_ERROR':
          throw new CASError(result.code, 'OTP attempt limit reached. Try again later');
        case 'CAS_GET_TGT_OTP_ACCESS_BLOCKED_ERROR':
          throw new CASError(result.code, 'Account temporarily blocked due to too many failed OTP attempts');
        default:
          throw new CASError(result.code, result.message || 'CAS login failed');
      }
    }

    throw new CASError('CAS_UNEXPECTED_RESPONSE', `Unexpected login response: ${JSON.stringify(result)}`);
  }

  /**
   * Login using CAS v1 (fallback method, no 2FA support).
   *
   * @param email - XTB account email
   * @param password - XTB account password
   * @returns Success result with TGT (v1 doesn't support 2FA)
   * @throws CASError if credentials invalid or service unavailable
   */
  private async loginV1(email: string, password: string): Promise<CASLoginResult> {
    const ticketsUrl = new URL('v1/tickets', this.config.baseUrl);

    const formData = new URLSearchParams({
      username: email,     // [REDACTED] - user email
      password: password,  // [REDACTED] - user password
    });

    const response = await fetch(ticketsUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.config.userAgent,
      },
      body: formData,
      redirect: 'manual', // Don't follow redirects to extract Location header
    });

    if (response.status === 201) {
      // Success: Extract TGT from Location header
      const location = response.headers.get('location');
      if (!location) {
        throw new CASError('CAS_V1_NO_LOCATION', 'CAS v1 login succeeded but no Location header found');
      }

      // Extract TGT from Location: .../v1/tickets/TGT-xxx → "TGT-xxx"
      const tgtMatch = location.match(/\/tickets\/([^\/]+)$/);
      if (!tgtMatch) {
        throw new CASError('CAS_V1_INVALID_LOCATION', `CAS v1 Location header format invalid: ${location}`);
      }

      const tgt = tgtMatch[1];
      const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours

      return {
        type: 'success',
        tgt,
        expiresAt,
      };
    }

    if (response.status === 401) {
      throw new CASError('CAS_GET_TGT_UNAUTHORIZED', 'Invalid credentials');
    }

    const errorText = await response.text();
    throw new CASError('CAS_V1_LOGIN_FAILED', `CAS v1 login failed: ${response.status} ${errorText}`);
  }

  /**
   * Submit two-factor authentication code to complete login.
   *
   * Uses the SAME v2/tickets endpoint as login, with loginTicket + token payload.
   *
   * @param loginTicket - Login ticket (MID-xxx) from initial login response
   * @param code - OTP code (6 digits from TOTP/SMS/EMAIL)
   * @param twoFactorAuthType - 2FA method type (default: 'SMS')
   * @returns TGT and expiration timestamp if successful, or new 2FA challenge
   * @throws CASError if code is invalid, rate limited, or account blocked
   */
  async loginWithTwoFactor(loginTicket: string, code: string, twoFactorAuthType = 'SMS'): Promise<CASLoginResult> {
    // 2FA uses the SAME endpoint as login (v2/tickets), NOT v2/tickets/two-factor
    const ticketsUrl = new URL('v2/tickets', this.config.baseUrl);

    const userAgent = this.config.userAgent;
    const fingerprint = this.generateFingerprint(userAgent);

    const payload = {
      loginTicket,        // MID-xxx token from initial login
      token: code,        // OTP code
      fingerprint,
      twoFactorAuthType,  // "SMS", "TOTP", "EMAIL"
    };

    const response = await fetch(ticketsUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Time-Zone': this.config.timezoneOffset,
        'User-Agent': userAgent,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new CASError('CAS_2FA_REQUEST_FAILED', `2FA request failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    if (result.loginPhase === 'TGT_CREATED' && result.ticket) {
      let tgt = result.ticket;

      // Also check Set-Cookie header for CASTGT as fallback
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const castgtMatch = setCookie.match(/CASTGT=([^;]+)/);
        if (castgtMatch && !tgt) {
          tgt = castgtMatch[1];
        }
      }

      const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours

      return {
        type: 'success',
        tgt,
        expiresAt,
      };
    }

    // Handle other error cases
    if (result.code) {
      throw new CASError(result.code, result.message || 'Two-factor authentication failed');
    }

    throw new CASError('CAS_2FA_UNEXPECTED_RESPONSE', `Unexpected 2FA response: ${JSON.stringify(result)}`);
  }

  /**
   * Get Service Ticket using TGT.
   * Uses CAS v1 endpoint by default (compatible with both real and demo).
   *
   * @param tgt - Ticket Granting Ticket from login()
   * @param service - Service name. Use 'xapi5' for WebSocket, 'abigail' for REST API
   * @returns Service ticket for the specified service
   */
  async getServiceTicket(tgt: string, service = 'xapi5'): Promise<CASServiceTicketResult> {
    return this.getServiceTicketV1(tgt, service);
  }

  /**
   * Get Service Ticket via CAS v1 endpoint.
   * POST https://xstation.xtb.com/signon/v1/tickets/{TGT}
   * Body: service=xapi5 (application/x-www-form-urlencoded)
   */
  private async getServiceTicketV1(tgt: string, service: string): Promise<CASServiceTicketResult> {
    const ticketUrl = new URL(`v1/tickets/${tgt}`, this.config.baseUrl);

    const formData = new URLSearchParams({ service });

    const response = await fetch(ticketUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.config.userAgent,
        'Cookie': `CASTGC=${tgt}`,
      },
      body: formData,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new CASError('CAS_TGT_EXPIRED', 'TGT has expired or is invalid');
      }
      const errorText = await response.text();
      throw new CASError('CAS_SERVICE_TICKET_FAILED', `CAS v1 service ticket request failed: ${response.status} ${errorText}`);
    }

    const serviceTicket = await response.text();
    if (!serviceTicket || !serviceTicket.startsWith('ST-')) {
      throw new CASError('CAS_INVALID_SERVICE_TICKET', `Invalid service ticket received: ${serviceTicket}`);
    }

    return { serviceTicket: serviceTicket.trim(), service };
  }

  /**
   * Get Service Ticket via CAS v2 endpoint (alternative method).
   * POST https://xstation.xtb.com/signon/v2/serviceTicket
   * JSON: {tgt, service: "xapi5"} + Time-Zone header
   */
  async getServiceTicketV2(tgt: string, service = 'xapi5'): Promise<CASServiceTicketResult> {
    const ticketUrl = new URL('v2/serviceTicket', this.config.baseUrl);

    const payload = { tgt, service };

    const response = await fetch(ticketUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Time-Zone': this.config.timezoneOffset,
        'User-Agent': this.config.userAgent,
        'Cookie': `CASTGC=${tgt}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new CASError('CAS_TGT_EXPIRED', 'TGT has expired or is invalid');
      }
      const errorText = await response.text();
      throw new CASError('CAS_SERVICE_TICKET_FAILED', `CAS v2 service ticket request failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    const serviceTicket = result.serviceTicket || result.ticket;

    if (!serviceTicket || !serviceTicket.startsWith('ST-')) {
      throw new CASError('CAS_INVALID_SERVICE_TICKET', `Invalid service ticket received: ${serviceTicket}`);
    }

    return { serviceTicket, service };
  }

  /**
   * Refresh service ticket using existing TGT.
   *
   * Service tickets are single-use and expire after 2-5 minutes.
   * Use this method to get a fresh ST when the previous one is expired.
   *
   * @param tgt - Valid Ticket Granting Ticket
   * @param service - Service name (default: 'xapi5')
   * @returns Fresh service ticket
   * @throws CASError if TGT is invalid or expired
   */
  async refreshServiceTicket(tgt: string, service = 'xapi5'): Promise<string> {
    try {
      const result = await this.getServiceTicket(tgt, service);
      return result.serviceTicket;
    } catch (error) {
      if (error instanceof CASError && error.code === 'CAS_TGT_EXPIRED') {
        throw new CASError('CAS_TGT_EXPIRED', 'TGT has expired, please login again');
      }
      throw error;
    }
  }

  /**
   * Check if TGT is still valid (not expired).
   * Note: This only checks local expiration time, not server-side validity.
   */
  isTgtValid(tgtResult: CASLoginResult): boolean {
    return Date.now() < tgtResult.expiresAt;
  }

  /**
   * Extract TGT from successful login result.
   * @param loginResult - Result from login() method
   * @returns TGT string if login was successful, null if 2FA required
   */
  getTgtFromResult(loginResult: CASLoginResult): string | null {
    return loginResult.type === 'success' ? loginResult.tgt : null;
  }

  /**
   * Get current timezone offset in ±HHMM format for CAS v2.
   * Example: "+0100" for GMT+1, "-0500" for GMT-5
   */
  private getTimezoneOffset(): string {
    // Browser sends Time-Zone header as minutes offset (e.g. "60" for CET, "-300" for EST)
    // getTimezoneOffset() returns -60 for CET, we need positive → negate it
    return String(-new Date().getTimezoneOffset());
  }

  /**
   * Generate fingerprint (SHA-256 hash) from user agent.
   * Required by CAS v2 for improved security and reliability.
   */
  private generateFingerprint(userAgent: string): string {
    // [REDACTED] - fingerprint generation for security
    return createHash('sha256').update(userAgent).digest('hex').toUpperCase();
  }
}