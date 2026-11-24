import { describe, expect, it } from 'vitest';
import { resolveTransportPlan } from '../transport.js';

const FOUNDRY = 'http://foundry.example:30000';
const BRIDGE = 'http://bridge.example:3030';

describe('resolveTransportPlan', () => {
  it('is Socket.IO only when FOUNDRY_API_KEY is unset', () => {
    const plan = resolveTransportPlan({ url: FOUNDRY, username: 'gm', password: 'pw' });
    expect(plan).toEqual({ mode: 'socket', warnings: [] });
  });

  it('is dual when the key, a bridge URL and Socket.IO credentials are all set', () => {
    const plan = resolveTransportPlan({
      url: FOUNDRY,
      apiKey: 'key',
      restUrl: BRIDGE,
      username: 'gm',
      password: 'pw',
    });
    expect(plan).toEqual({ mode: 'dual', restBaseUrl: BRIDGE, warnings: [] });
  });

  it('accepts FOUNDRY_USER_ID in place of FOUNDRY_USERNAME for dual mode', () => {
    const plan = resolveTransportPlan({
      url: FOUNDRY,
      apiKey: 'key',
      restUrl: BRIDGE,
      userId: 'abcdefghijklmnop',
      password: 'pw',
    });
    expect(plan.mode).toBe('dual');
  });

  it('keeps the REST-only mode for a key without Socket.IO credentials, with a deprecation warning', () => {
    const plan = resolveTransportPlan({ url: FOUNDRY, apiKey: 'key' });
    expect(plan.mode).toBe('rest');
    // Without FOUNDRY_REST_URL the REST client keeps using FOUNDRY_URL, as before.
    expect(plan.restBaseUrl).toBe(FOUNDRY);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/deprecated/i);
    expect(plan.warnings[0]).toContain('FOUNDRY_REST_URL');
  });

  it('sends REST-only requests to FOUNDRY_REST_URL when it is set', () => {
    const plan = resolveTransportPlan({ url: FOUNDRY, apiKey: 'key', restUrl: BRIDGE });
    expect(plan.mode).toBe('rest');
    expect(plan.restBaseUrl).toBe(BRIDGE);
    expect(plan.warnings[0]).toMatch(/deprecated/i);
  });

  it('treats a password without a user as no Socket.IO credentials', () => {
    const plan = resolveTransportPlan({
      url: FOUNDRY,
      apiKey: 'key',
      restUrl: BRIDGE,
      password: 'pw',
    });
    expect(plan.mode).toBe('rest');
  });

  it('keeps REST-only for a key plus credentials but no bridge URL, and says how to get dual mode', () => {
    // Today FOUNDRY_URL points at the bridge in this configuration; logging in
    // to it over Socket.IO would fail, so the mode must not change under it.
    const plan = resolveTransportPlan({
      url: FOUNDRY,
      apiKey: 'key',
      username: 'gm',
      password: 'pw',
    });
    expect(plan.mode).toBe('rest');
    expect(plan.restBaseUrl).toBe(FOUNDRY);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('FOUNDRY_REST_URL');
  });

  it('warns that the augment stays off when FOUNDRY_REST_URL is set without a key', () => {
    const plan = resolveTransportPlan({
      url: FOUNDRY,
      restUrl: BRIDGE,
      username: 'gm',
      password: 'pw',
    });
    expect(plan.mode).toBe('socket');
    expect(plan.restBaseUrl).toBeUndefined();
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('FOUNDRY_API_KEY');
  });

  it('treats empty strings as unset', () => {
    const plan = resolveTransportPlan({
      url: FOUNDRY,
      apiKey: '',
      restUrl: '',
      username: 'gm',
      password: 'pw',
    });
    expect(plan).toEqual({ mode: 'socket', warnings: [] });
  });
});
