import { test, expect } from '@playwright/test';

/**
 * Baseline smoke test for the Playwright E2E harness.
 *
 * Purpose: prove that the Playwright config loads, browsers launch, and a
 * spec can run end-to-end. This is intentionally tiny — it is the foothold
 * for future E2E coverage, not coverage itself.
 *
 * The test skips gracefully when FoundryVTT is not reachable so it remains
 * green in CI environments without the live VTT instance / credentials.
 *
 * Tracked by issue #137.
 */

const FOUNDRY_URL = process.env.FOUNDRY_URL || 'http://localhost:30000';

/**
 * Probe FoundryVTT availability using Node's built-in fetch. Done inside
 * the test (not at module scope) so the probe error is attributed to this
 * spec rather than a load-time failure if the network call throws.
 */
async function isFoundryReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(FOUNDRY_URL, { signal: controller.signal });
      return res.status < 500;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

test('playwright harness loads and can reach a page', async ({ page }) => {
  const reachable = await isFoundryReachable();
  test.skip(
    !reachable,
    `FoundryVTT not reachable at ${FOUNDRY_URL} — baseline smoke test skipped (set FOUNDRY_URL or start the container to exercise it).`,
  );

  // Minimal interaction: navigate and assert we received a non-error
  // response and a string title. Deliberately does not assert
  // FoundryVTT-specific markup so it survives version changes.
  const response = await page.goto(FOUNDRY_URL);
  expect(response, 'page.goto returned a response').not.toBeNull();
  expect(response!.status(), 'response status is not a server error').toBeLessThan(500);

  const title = await page.title();
  expect(typeof title).toBe('string');
});
