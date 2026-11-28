#!/usr/bin/env node

/** Read-only connectivity checks for every configured target. */
import '../src/load-env.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config/index.js';
import { FoundrySessionManager } from '../src/sessions/index.js';

export async function testConnection(): Promise<void> {
  console.log('FoundryVTT MCP connection checks\n');
  const sessions = new FoundrySessionManager(config.targets, { monitorIntervalMs: 0 });
  let failures = 0;
  try {
    await sessions.start();
    for (const session of sessions.all()) {
      const status = session.status();
      console.log(`Target: ${status.target_id} (${status.provider})`);
      console.log(`State: ${status.state}`);
      if (status.world) {
        console.log(`World: ${status.world.id} / system: ${status.system?.id ?? 'unknown'}`);
      }
      if (status.state !== 'ready') {
        failures++;
        console.log(`Connection failed: ${status.error ?? 'Target is unavailable'}\n`);
        continue;
      }
      console.log(`Capabilities: ${status.capabilities.join(', ')}`);
      if (session.provider.capabilities.has('core.read')) {
        try {
          const actors = await session.run((provider) => provider.searchActors({ limit: 3 }));
          console.log(`Actor read succeeded: ${actors.actors.length} result(s)`);
          if (actors.total === 0) {
            console.log('No actors found (the world may have none)');
          }
        } catch (error) {
          failures++;
          console.log(
            `Actor read failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }
      // The historical REST transport must roll on the authenticated server.
      // A local fallback indicates the REST dice endpoint was unavailable.
      if (session.config.provider.kind === 'legacy-rest') {
        try {
          const roll = await session.run((provider) => provider.rollDice('1d20'));
          if (roll.source !== 'server') {
            failures++;
            console.log('REST dice roll failed: the provider fell back to local rolling');
          }
        } catch (error) {
          failures++;
          console.log(
            `REST dice roll failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }
      console.log(`Integration status: ${JSON.stringify(status.integrations)}`);
      if (status.integrationError) {
        console.log(`Optional integrations unavailable: ${status.integrationError}`);
      }
      console.log('');
    }
  } finally {
    await sessions.close();
  }
  console.log(
    `Checked ${config.targets.length} target(s); ${failures} connection/read failure(s).`,
  );
  process.exitCode = failures > 0 ? 1 : 0;
}

const entrypoint = process.argv[1];
if (entrypoint && realpathSync(entrypoint) === fileURLToPath(import.meta.url)) {
  testConnection().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Connection checks failed');
    process.exitCode = 1;
  });
}
