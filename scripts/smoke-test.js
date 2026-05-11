#!/usr/bin/env node

/**
 * Startup smoke test for the built MCP server.
 *
 * Spawns `node dist/index.js` with placeholder env vars and verifies that:
 *   1. The startup banner appears on stderr within a short timeout.
 *   2. The process is still alive when the banner is observed.
 *   3. The process can be terminated cleanly with SIGTERM.
 *
 * Exits 0 on success, non-zero on any failure. Designed to catch regressions
 * in `new FoundryMCPServer()` initialisation that the existing service-mocked
 * Vitest suite cannot detect (e.g. SDK API shape changes, Server constructor
 * argument shape, ESM import-time failures).
 *
 * The test does NOT require a live FoundryVTT instance — the banner is emitted
 * before `foundryClient.connect()` runs, so the inevitable connection failure
 * against placeholder env vars happens *after* the smoke test has already
 * observed the banner and SIGTERMed the child.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'index.js');

const BANNER = '🎲 FoundryVTT MCP Server starting...';
const STARTUP_TIMEOUT_MS = 5000;
const SIGKILL_GRACE_MS = 2000;

if (!existsSync(serverPath)) {
  console.error(`❌ Built server not found at ${serverPath}`);
  console.error('   Run `bun run build` before invoking the smoke test.');
  process.exit(2);
}

const child = spawn('node', [serverPath], {
  cwd: repoRoot,
  env: {
    ...process.env,
    FOUNDRY_URL: 'http://127.0.0.1:1',
    FOUNDRY_USERNAME: 'smoke',
    FOUNDRY_PASSWORD: 'smoke',
    LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
let stdout = '';
let resolved = false;
let bannerSeen = false;

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
  if (!bannerSeen && stderr.includes(BANNER)) {
    bannerSeen = true;
    finish(true, 'banner observed; process alive');
  }
});

child.on('exit', (code, signal) => {
  if (resolved) return;
  finish(false, `server exited prematurely (code=${code}, signal=${signal})`);
});

child.on('error', (err) => {
  if (resolved) return;
  finish(false, `failed to spawn server: ${err.message}`);
});

const timeout = setTimeout(() => {
  if (resolved) return;
  finish(false, `timed out after ${STARTUP_TIMEOUT_MS}ms waiting for banner`);
}, STARTUP_TIMEOUT_MS);

function finish(success, message) {
  if (resolved) return;
  resolved = true;
  clearTimeout(timeout);

  const stillAlive = success && child.exitCode === null && child.signalCode === null;

  if (success && stillAlive) {
    console.log(`✅ Smoke test passed: ${message}`);
    terminate(0);
    return;
  }

  console.error(`❌ Smoke test failed: ${message}`);
  if (stderr) {
    console.error('--- stderr ---');
    console.error(stderr);
  }
  if (stdout) {
    console.error('--- stdout ---');
    console.error(stdout);
  }
  terminate(1);
}

function terminate(exitCode) {
  if (child.exitCode !== null || child.signalCode !== null) {
    process.exit(exitCode);
    return;
  }

  child.kill('SIGTERM');
  const killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, SIGKILL_GRACE_MS);

  child.once('exit', () => {
    clearTimeout(killTimer);
    process.exit(exitCode);
  });
}
