import { describe, it, expect } from 'vitest';
import { CASClient } from '../../src/auth/cas-client.js';

describe('CASClient', () => {
  it('creates with default config', () => {
    const client = new CASClient();
    expect(client).toBeDefined();
  });

  it('creates with custom base URL', () => {
    const client = new CASClient({ baseUrl: 'https://custom.xtb.com/signon/' });
    expect(client).toBeDefined();
  });

  it('validates TGT expiration', () => {
    const client = new CASClient();

    const valid = {
      type: 'success' as const,
      tgt: 'TGT-test',
      expiresAt: Date.now() + 3600000
    };
    expect(client.isTgtValid(valid)).toBe(true);

    const expired = {
      type: 'success' as const,
      tgt: 'TGT-test',
      expiresAt: Date.now() - 1000
    };
    expect(client.isTgtValid(expired)).toBe(false);
  });
});
