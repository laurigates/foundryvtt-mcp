#!/usr/bin/env node

/**
 * Regression smoke test for dotenv load ordering (issue #206).
 *
 * The documented configuration path — a `.env` file in the working directory —
 * was silently dead. `src/index.ts` called `dotenv.config()` in its module
 * body, but ESM evaluates every imported module *before* that body runs, and
 * `utils/logger.ts` builds its logger at module scope from `config.logLevel`,
 * which resolves the whole configuration eagerly. Configuration was therefore
 * validated against a `process.env` that had never seen the `.env` file, and
 * startup died with "Configuration validation failed" while pointing the user
 * at the very file it had ignored.
 *
 * This test spawns the built server from a scratch directory whose only source
 * of configuration is a `.env` file, with every FOUNDRY_* variable stripped
 * from the inherited environment, and asserts the startup banner appears.
 *
 * A unit test cannot cover this: the defect is in module evaluation order in a
 * real process, which any test that imports the modules has already perturbed.
 *
 * Exits 0 on success, non-zero on any failure.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const serverPath = join(repoRoot, 'dist', 'index.js');

const BANNER = '🎲 FoundryVTT MCP Server starting...';
const CONFIG_FAILURE = 'Configuration validation failed';
const STARTUP_TIMEOUT_MS = 5000;
const SIGKILL_GRACE_MS = 2000;

if (!existsSync(serverPath)) {
  console.error(`❌ Built server not found at ${serverPath}`);
  console.error('   Run `bun run build` before invoking the smoke test.');
  process.exit(2);
}

// Scratch working directory whose only configuration is the dotenv file.
const workDir = mkdtempSync(join(tmpdir(), 'fvtt-mcp-dotenv-'));
writeFileSync(
  join(workDir, '.env'),
  [
    // Port 1 is unbindable, so the connection attempt fails fast — well after
    // the banner this test waits for.
    'FOUNDRY_URL=http://127.0.0.1:1',
    'FOUNDRY_USERNAME=dotenv-smoke',
    'FOUNDRY_PASSWORD=dotenv-smoke',
    'LOG_LEVEL=error',
    '',
  ].join('\n'),
);

// Strip every FOUNDRY_*/LOG_LEVEL variable so the dotenv file is the sole
// source of configuration — an inherited FOUNDRY_URL would make this pass
// regardless of whether the file was read.
const childEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith('FOUNDRY_') && key !== 'LOG_LEVEL',
  ),
);

const child = spawn('node', [serverPath], {
  cwd: workDir,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
let stdout = '';
let resolved = false;

child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
  if (resolved) return;
  if (stderr.includes(CONFIG_FAILURE)) {
    finish(false, 'configuration validation failed — the .env file was not loaded in time');
    return;
  }
  if (stderr.includes(BANNER)) {
    finish(true, 'server started with configuration sourced from .env');
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

  if (success) {
    console.log(`✅ dotenv smoke test passed: ${message}`);
    terminate(0);
    return;
  }

  console.error(`❌ dotenv smoke test failed: ${message}`);
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
  const cleanup = () => {
    rmSync(workDir, { recursive: true, force: true });
    process.exit(exitCode);
  };

  if (child.exitCode !== null || child.signalCode !== null) {
    cleanup();
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
    cleanup();
  });
}
