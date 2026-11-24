/**
 * Vitest global setup for integration tests.
 * Waits for the FoundryVTT container to be ready before running tests.
 */

import type { TestProject } from 'vitest/node';

const FOUNDRY_URL = process.env.FOUNDRY_URL || 'http://localhost:30001';
const MAX_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

async function waitForContainer(): Promise<void> {
  const start = Date.now();
  const joinUrl = `${FOUNDRY_URL}/join`;

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(joinUrl);
      if (res.ok || res.status === 200 || res.status === 302) {
        console.log(`FoundryVTT ready at ${FOUNDRY_URL} (${Date.now() - start}ms)`);
        return;
      }
    } catch {
      // Container not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`FoundryVTT did not become ready at ${FOUNDRY_URL} within ${MAX_WAIT_MS}ms`);
}

declare module 'vitest' {
  export interface ProvidedContext {
    /**
     * FOUNDRY_URL as the shell set it ('' when unset). Test workers cannot read
     * it from process.env: the `env` block in vitest.integration.config.ts
     * overrides FOUNDRY_URL there. Read by parity.integration.test.ts.
     */
    shellFoundryUrl: string;
  }
}

export async function setup(project: TestProject): Promise<void> {
  project.provide('shellFoundryUrl', process.env.FOUNDRY_URL ?? '');
  console.log(`Waiting for FoundryVTT at ${FOUNDRY_URL}...`);
  await waitForContainer();
}
