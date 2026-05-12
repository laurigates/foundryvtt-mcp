/**
 * Integration tests for MCP resource URIs.
 *
 * Covers every `foundry://` resource exposed by `src/tools/resources.ts` and
 * served by `handleReadResource` in `src/tools/handlers/resources.ts`.
 *
 * Each URI is asserted for the MCP `contents[]` shape: an array containing at
 * least one entry with `uri`, `mimeType`, and a `text` (or `blob`) payload.
 *
 * Some URIs may legitimately return an empty / null-like payload when the
 * corresponding world state isn't populated:
 *   - `foundry://scenes/current` — no active scene
 *   - `foundry://combat`        — no active combat encounter
 *   - `foundry://system/diagnostics` — REST API module not installed
 *
 * For these the test asserts the graceful-null contract (still a well-formed
 * contents[] entry whose JSON parses successfully) rather than presence of
 * a particular collection.
 *
 * Tracks issue: #135
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiagnosticsClient } from '../../src/diagnostics/client.js';
import type { FoundryClient } from '../../src/foundry/client.js';
import { handleReadResource } from '../../src/tools/handlers/resources.js';
import { getAllResources } from '../../src/tools/resources.js';
import { createConnectedClient } from './setup.js';

// Allow a quick local skip without spinning the container. CI / docker harness
// leaves this unset, so the test runs there.
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === '1';

// URIs whose payload may legitimately be empty / null-shaped against a freshly
// seeded test world.
const GRACEFUL_NULL_URIS = new Set([
  'foundry://scenes/current',
  'foundry://combat',
  'foundry://system/diagnostics',
]);

interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

describe.skipIf(SKIP_INTEGRATION)('Resource URIs', () => {
  let foundryClient: FoundryClient;
  let diagnosticsClient: DiagnosticsClient;

  beforeAll(async () => {
    foundryClient = await createConnectedClient();
    diagnosticsClient = new DiagnosticsClient(foundryClient);
  });

  afterAll(async () => {
    if (foundryClient) {
      await foundryClient.disconnect();
    }
  });

  it('exposes 9 resource URIs from getAllResources()', () => {
    const resources = getAllResources();
    expect(resources).toHaveLength(9);
  });

  // Parameterised over every declared resource URI so adding a new one
  // automatically requires a new integration test entry (or a `it.each`
  // failure on count drift).
  it.each(getAllResources().map((r) => [r.uri, r.mimeType] as const))(
    'reads %s as %s',
    async (uri, expectedMimeType) => {
      const result = await handleReadResource(uri, foundryClient, diagnosticsClient);

      // MCP contract: contents[] is always an array with at least one entry.
      expect(result).toBeDefined();
      expect(result).toHaveProperty('contents');
      expect(Array.isArray(result.contents)).toBe(true);
      expect(result.contents.length).toBeGreaterThan(0);

      const entry = result.contents[0] as ResourceContent;

      // Every entry echoes its own URI back so callers can correlate.
      expect(entry.uri).toBe(uri);
      expect(entry.mimeType).toBe(expectedMimeType);

      // Either `text` or `blob` must be populated.
      const hasPayload =
        (typeof entry.text === 'string' && entry.text.length > 0) ||
        (typeof entry.blob === 'string' && entry.blob.length > 0);
      expect(hasPayload).toBe(true);

      // JSON resources should parse cleanly even when the underlying data is
      // empty (graceful-null URIs). This is the contract assertion that lets
      // RU-4 / RU-7 / RU-9 return a `null` / `message` shape without failing.
      if (entry.mimeType === 'application/json' && typeof entry.text === 'string') {
        const parsed = JSON.parse(entry.text);
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe('object');
        expect(parsed).not.toBeNull();

        if (GRACEFUL_NULL_URIS.has(uri)) {
          // Graceful-null URIs: the JSON parses, payload is well-formed, but
          // we don't require any particular collection to be populated. The
          // implementation returns either the real data or a sentinel object
          // (e.g. `{ currentScene: null, message: 'No active scene' }`).
          // Either is acceptable — just ensure something exists.
          expect(Object.keys(parsed).length).toBeGreaterThan(0);
        } else {
          // Non-graceful URIs always carry a `lastUpdated` timestamp.
          expect(parsed).toHaveProperty('lastUpdated');
          expect(typeof parsed.lastUpdated).toBe('string');
        }
      }
    },
  );

  it('rejects an unknown foundry:// URI', async () => {
    await expect(
      handleReadResource('foundry://does-not-exist', foundryClient, diagnosticsClient),
    ).rejects.toThrow();
  });
});
