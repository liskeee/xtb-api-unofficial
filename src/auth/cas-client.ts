/**
 * CAS (Central Authentication Service) client for XTB xStation5 WebSocket authentication.
 * Handles the complete auth flow: login → TGT → Service Ticket → WebSocket login.
 */

export interface CASLoginResult {
  tgt: string;
  /** TGT expires after this timestamp */
  expiresAt: number;
}

export interface CASServiceTicketResult {
  serviceTicket: string;
  service: string;
}

export interface CASClientConfig {
  /** Base CAS URL. Default: https://xstation.xtb.com/signon/ */
  baseUrl?: string;
  /** Timezone offset for CAS v2. Default: auto-detected */
  timezoneOffset?: string;
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
      ...config,
    };
  }

  /**
   * Login with email/password to get TGT (Ticket Granting Ticket).
   *
   * @param email - XTB account email
   * @param password - XTB account password
   * @returns TGT and expiration timestamp
   */
  async login(email: string, password: string): Promise<CASLoginResult> {
    const loginUrl = new URL('login', this.config.baseUrl);

    const formData = new URLSearchParams({
      username: email,
      password: password,
      lt: '', // CAS Login Ticket - usually auto-generated
      execution: 'e1s1',
      _eventId: 'submit',
    });

    const response = await fetch(loginUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'xStation5/2.94.1 (Linux x86_64)',
      },
      body: formData,
      redirect: 'manual', // Don't follow redirects to capture cookies
    });

    if (!response.ok) {
      throw new Error(`CAS login failed: ${response.status} ${response.statusText}`);
    }

    // Extract TGT from Set-Cookie header (CASTGC cookie)
    const cookies = response.headers.get('set-cookie');
    if (!cookies) {
      throw new Error('No cookies returned from CAS login - authentication failed');
    }

    const castgcMatch = cookies.match(/CASTGC=([^;]+)/);
    if (!castgcMatch) {
      throw new Error('CASTGC cookie not found - authentication failed');
    }

    const tgt = castgcMatch[1];

    // TGT typically expires in 8-12 hours, estimate 8 hours
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;

    return { tgt, expiresAt };
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
        'User-Agent': 'xStation5/2.94.1 (Linux x86_64)',
        'Cookie': `CASTGC=${tgt}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`CAS v1 service ticket request failed: ${response.status} ${response.statusText}`);
    }

    const serviceTicket = await response.text();
    if (!serviceTicket || !serviceTicket.startsWith('ST-')) {
      throw new Error(`Invalid service ticket received: ${serviceTicket}`);
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
        'User-Agent': 'xStation5/2.94.1 (Linux x86_64)',
        'Cookie': `CASTGC=${tgt}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`CAS v2 service ticket request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const serviceTicket = result.serviceTicket || result.ticket;

    if (!serviceTicket || !serviceTicket.startsWith('ST-')) {
      throw new Error(`Invalid service ticket received: ${serviceTicket}`);
    }

    return { serviceTicket, service };
  }

  /**
   * Check if TGT is still valid (not expired).
   * Note: This only checks local expiration time, not server-side validity.
   */
  isTgtValid(tgtResult: CASLoginResult): boolean {
    return Date.now() < tgtResult.expiresAt;
  }

  /**
   * Get current timezone offset in ±HHMM format for CAS v2.
   * Example: "+0100" for GMT+1, "-0500" for GMT-5
   */
  private getTimezoneOffset(): string {
    const offset = new Date().getTimezoneOffset();
    const sign = offset <= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
    const minutes = String(absOffset % 60).padStart(2, '0');
    return `${sign}${hours}${minutes}`;
  }
}