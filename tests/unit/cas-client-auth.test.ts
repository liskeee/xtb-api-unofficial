import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CASClient } from '../../src/auth/cas-client.js';
import { CASError } from '../../src/types/websocket.js';

// Mock fetch for testing
global.fetch = vi.fn();
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

describe('CASClient 2FA Authentication', () => {
  let client: CASClient;

  beforeEach(() => {
    client = new CASClient();
    mockFetch.mockReset();
  });

  describe('Configurable userAgent', () => {
    it('uses default userAgent when not configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ loginPhase: 'TGT_CREATED', ticket: 'TGT-test' })
      } as Response);

      await client.login('test@example.com', 'password');

      const callArgs = mockFetch.mock.calls[0];
      expect((callArgs[1] as RequestInit).headers).toMatchObject({
        'User-Agent': 'xStation5/2.94.1 (Linux x86_64)',
      });
    });

    it('uses custom userAgent when configured', async () => {
      const customClient = new CASClient({ userAgent: 'CustomApp/1.0.0 (Windows NT 10.0)' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ loginPhase: 'TGT_CREATED', ticket: 'TGT-test' })
      } as Response);

      await customClient.login('test@example.com', 'password');

      const callArgs = mockFetch.mock.calls[0];
      expect((callArgs[1] as RequestInit).headers).toMatchObject({
        'User-Agent': 'CustomApp/1.0.0 (Windows NT 10.0)',
      });
    });
  });

  describe('Fingerprint Generation', () => {
    it('generates SHA-256 fingerprint from user agent', () => {
      // Access private method via reflection for testing
      const generateFingerprint = (client as any).generateFingerprint.bind(client);

      const userAgent = 'xStation5/2.94.1 (Linux x86_64)';
      const fingerprint = generateFingerprint(userAgent);

      expect(fingerprint).toBeDefined();
      expect(fingerprint).toMatch(/^[A-F0-9]{64}$/); // SHA-256 hex string
      expect(fingerprint).toBe(fingerprint.toUpperCase()); // Should be uppercase

      // Same input should produce same output
      const fingerprint2 = generateFingerprint(userAgent);
      expect(fingerprint).toBe(fingerprint2);
    });

    it('generates different fingerprints for different user agents', () => {
      const generateFingerprint = (client as any).generateFingerprint.bind(client);

      const ua1 = 'xStation5/2.94.1 (Linux x86_64)';
      const ua2 = 'xStation5/2.94.1 (Windows NT 10.0)';

      const fp1 = generateFingerprint(ua1);
      const fp2 = generateFingerprint(ua2);

      expect(fp1).not.toBe(fp2);
    });
  });

  describe('Login Phase Parsing', () => {
    it('handles TGT_CREATED response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loginPhase: 'TGT_CREATED',
          ticket: 'TGT-123456-abcdef'
        })
      } as Response);

      const result = await client.login('test@example.com', 'password');

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.tgt).toBe('TGT-123456-abcdef');
        expect(result.expiresAt).toBeGreaterThan(Date.now());
      }
    });

    it('handles TWO_FACTOR_REQUIRED response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loginPhase: 'TWO_FACTOR_REQUIRED',
          sessionId: 'session-123',
          methods: ['TOTP', 'SMS']
        })
      } as Response);

      const result = await client.login('test@example.com', 'password');

      expect(result.type).toBe('requires_2fa');
      if (result.type === 'requires_2fa') {
        expect(result.sessionId).toBe('session-123');
        expect(result.methods).toEqual(['TOTP', 'SMS']);
        expect(result.expiresAt).toBeGreaterThan(Date.now());
      }
    });

    it('falls back to CAS v1 when v2 fails', async () => {
      // First call (v2) fails with service error (not auth error)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service unavailable'
      } as Response);

      // Second call (v1) succeeds
      mockFetch.mockResolvedValueOnce({
        status: 201,
        headers: {
          get: (name: string) => name === 'location' ? 'https://xstation.xtb.com/signon/v1/tickets/TGT-789012-ghijkl' : null
        }
      } as Response);

      const result = await client.login('test@example.com', 'password');

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.tgt).toBe('TGT-789012-ghijkl');
      }
    });
  });

  describe('Error Code Mapping', () => {
    it('throws CAS_GET_TGT_UNAUTHORIZED for invalid credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'CAS_GET_TGT_UNAUTHORIZED',
          message: 'Invalid credentials'
        })
      } as Response);

      await expect(client.login('invalid@example.com', 'wrong'))
        .rejects.toThrow('Invalid email or password');
    });

    it('throws CAS_GET_TGT_TOO_MANY_OTP_ERROR for rate limiting', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'CAS_GET_TGT_TOO_MANY_OTP_ERROR',
          data: { otpThrottleTimeRemaining: 120 }
        })
      } as Response);

      await expect(client.login('test@example.com', 'password'))
        .rejects.toThrow('Too many OTP attempts. Wait 120s');
    });

    it('throws CAS_GET_TGT_OTP_LIMIT_REACHED_ERROR for limit reached', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'CAS_GET_TGT_OTP_LIMIT_REACHED_ERROR'
        })
      } as Response);

      await expect(client.login('test@example.com', 'password'))
        .rejects.toThrow('OTP attempt limit reached');
    });

    it('throws CAS_GET_TGT_OTP_ACCESS_BLOCKED_ERROR for blocked account', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'CAS_GET_TGT_OTP_ACCESS_BLOCKED_ERROR'
        })
      } as Response);

      await expect(client.login('test@example.com', 'password'))
        .rejects.toThrow('Account temporarily blocked');
    });
  });

  describe('TGT Extraction from v1 Location Header', () => {
    it('extracts TGT from valid Location header', async () => {
      const loginV1 = (client as any).loginV1.bind(client);

      mockFetch.mockResolvedValueOnce({
        status: 201,
        headers: {
          get: (name: string) =>
            name === 'location' ? 'https://xstation.xtb.com/signon/v1/tickets/TGT-987654-zyxwvu' : null
        }
      } as Response);

      const result = await loginV1('test@example.com', 'password');

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.tgt).toBe('TGT-987654-zyxwvu');
      }
    });

    it('throws error for missing Location header', async () => {
      const loginV1 = (client as any).loginV1.bind(client);

      mockFetch.mockResolvedValueOnce({
        status: 201,
        headers: {
          get: () => null
        }
      } as Response);

      await expect(loginV1('test@example.com', 'password'))
        .rejects.toThrow('no Location header found');
    });

    it('throws error for invalid Location header format', async () => {
      const loginV1 = (client as any).loginV1.bind(client);

      mockFetch.mockResolvedValueOnce({
        status: 201,
        headers: {
          get: (name: string) =>
            name === 'location' ? 'https://xstation.xtb.com/invalid/path' : null
        }
      } as Response);

      await expect(loginV1('test@example.com', 'password'))
        .rejects.toThrow('Location header format invalid');
    });
  });

  describe('Two-Factor Authentication', () => {
    it('submits 2FA code successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          loginPhase: 'TGT_CREATED',
          ticket: 'TGT-2fa-success'
        })
      } as Response);

      const result = await client.loginWithTwoFactor('session-123', '123456');

      expect(result.type).toBe('success');
      if (result.type === 'success') {
        expect(result.tgt).toBe('TGT-2fa-success');
      }
    });

    it('handles invalid 2FA code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 'CAS_GET_TGT_OTP_INVALID',
          message: 'Invalid OTP code'
        })
      } as Response);

      await expect(client.loginWithTwoFactor('session-123', 'invalid'))
        .rejects.toThrow('Invalid OTP code');
    });

    it('handles 2FA submission failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request'
      } as Response);

      await expect(client.loginWithTwoFactor('session-123', '123456'))
        .rejects.toThrow('2FA request failed: 400');
    });
  });

  describe('CASError Class', () => {
    it('creates CASError with code and message', () => {
      const error = new CASError('TEST_CODE', 'Test message');

      expect(error.name).toBe('CASError');
      expect(error.code).toBe('TEST_CODE');
      expect(error.message).toBe('Test message');
      expect(error instanceof Error).toBe(true);
    });

    it('preserves error code for identification', () => {
      const error = new CASError('CAS_GET_TGT_UNAUTHORIZED', 'Invalid credentials');

      expect(error.code).toBe('CAS_GET_TGT_UNAUTHORIZED');
    });
  });

  describe('TGT Validation', () => {
    it('validates unexpired TGT', () => {
      const validResult = {
        type: 'success' as const,
        tgt: 'TGT-test',
        expiresAt: Date.now() + 3600000
      };

      expect(client.isTgtValid(validResult)).toBe(true);
    });

    it('invalidates expired TGT', () => {
      const expiredResult = {
        type: 'success' as const,
        tgt: 'TGT-test',
        expiresAt: Date.now() - 1000
      };

      expect(client.isTgtValid(expiredResult)).toBe(false);
    });

    it('validates 2FA session expiration', () => {
      const twoFactorResult = {
        type: 'requires_2fa' as const,
        sessionId: 'session-123',
        methods: ['TOTP'] as const,
        expiresAt: Date.now() + 300000 // 5 minutes
      };

      expect(client.isTgtValid(twoFactorResult)).toBe(true);
    });
  });

  describe('TGT Helper Methods', () => {
    it('extracts TGT from success result', () => {
      const successResult = {
        type: 'success' as const,
        tgt: 'TGT-extracted',
        expiresAt: Date.now() + 3600000
      };

      const tgt = client.getTgtFromResult(successResult);
      expect(tgt).toBe('TGT-extracted');
    });

    it('returns null for 2FA result', () => {
      const twoFactorResult = {
        type: 'requires_2fa' as const,
        sessionId: 'session-123',
        methods: ['TOTP'] as const,
        expiresAt: Date.now() + 300000
      };

      const tgt = client.getTgtFromResult(twoFactorResult);
      expect(tgt).toBe(null);
    });
  });

  describe('Service Ticket Refresh', () => {
    it('refreshes service ticket with valid TGT', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'ST-refreshed-ticket'
      } as Response);

      const ticket = await client.refreshServiceTicket('TGT-valid');

      expect(ticket).toBe('ST-refreshed-ticket');
    });

    it('throws CAS_TGT_EXPIRED for invalid TGT', async () => {
      // Mock the service ticket request to return 401 Unauthorized
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      } as Response);

      await expect(client.refreshServiceTicket('TGT-expired'))
        .rejects.toThrow('TGT has expired, please login again');
    });
  });
});