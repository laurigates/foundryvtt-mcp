#!/usr/bin/env node

/**
 * Pack-and-install smoke test.
 *
 * Validates the *published* package shape, not just the source build:
 *   1. Every non-negation entry in `package.json` "files" resolves to a real
 *      path (or matches at least one file via glob) in the source tree.
 *   2. `npm pack` produces a tarball.
 *   3. The tarball can be installed as a dependency in a fresh consumer
 *      project.
 *   4. The historical client import and its declarations remain available.
 *   5. `node node_modules/<pkg>/dist/index.js` from the consumer reaches the
 *      startup banner — same contract as smoke-test.js.
 *
 * Catches packaging-shape regressions that smoke-test.js cannot: smoke-test
 * runs against the source tree, where every file is present regardless of
 * `files`. This script runs against the tarball end-users actually get via
 * `bunx`/`npx foundryvtt-mcp` / `npm install foundryvtt-mcp`. The motivating
 * scenario: shipping a release with a missing subdirectory in `files`, which
 * crashes at startup with ERR_MODULE_NOT_FOUND only when consumers install it.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const pkgJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

const BANNER = '🎲 FoundryVTT MCP Server starting...';
const STARTUP_TIMEOUT_MS = 5000;
const SIGKILL_GRACE_MS = 2000;

const cleanupPaths = [];
function registerCleanup(path) {
  cleanupPaths.push(path);
}
function cleanupAll() {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
}

// Best-effort cleanup on interruption (Ctrl+C, CI cancellation, hangup).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    cleanupAll();
    process.exit(1);
  });
}

function fail(message, extra = '') {
  console.error(`❌ smoke-pack failed: ${message}`);
  if (extra) {
    console.error(extra);
  }
  cleanupAll();
  process.exit(1);
}

// ── 1. Validate `files` entries reference real paths or globs that match ──
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walk(abs));
    } else {
      out.push(abs);
    }
  }
  return out;
}

function globToRegExp(pattern) {
  // Minimal glob -> regex: ** matches anything, * matches a single segment,
  // ? matches a single char. Sufficient for typical "files" entries like
  // "dist/**/*.js" or "build/handlers/".
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^$()|{}[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function validateFilesEntries() {
  const entries = pkgJson.files ?? [];
  const checked = [];
  for (const entry of entries) {
    if (entry.startsWith('!')) {
      continue;
    }
    const cleaned = entry.replace(/\/$/, '');
    const hasGlob = /[*?[\]]/.test(cleaned);
    if (!hasGlob) {
      const absPath = join(repoRoot, cleaned);
      if (!existsSync(absPath)) {
        fail(
          `package.json "files" entry "${entry}" references a path that does not exist: ${cleaned}`,
        );
      }
      checked.push(entry);
      continue;
    }
    // Glob — find the longest leading literal prefix and walk it.
    const segments = cleaned.split('/');
    const literalSegments = [];
    for (const seg of segments) {
      if (/[*?[\]]/.test(seg)) {
        break;
      }
      literalSegments.push(seg);
    }
    const rootDir = join(repoRoot, ...literalSegments);
    if (!existsSync(rootDir)) {
      fail(`package.json "files" entry "${entry}" — root dir does not exist: ${rootDir}`);
    }
    const re = globToRegExp(cleaned);
    const matches = walk(rootDir).some((abs) => re.test(relative(repoRoot, abs)));
    if (!matches) {
      fail(`package.json "files" entry "${entry}" matched zero files`);
    }
    checked.push(entry);
  }
  console.log(`✅ All ${checked.length} "files" entries reference existing paths or globs`);
}

// ── 2. Pack ───────────────────────────────────────────────────────────────
function packTarball() {
  const tmp = mkdtempSync(join(tmpdir(), 'foundryvtt-mcp-pack-'));
  registerCleanup(tmp);
  const result = spawnSync('npm', ['pack', '--pack-destination', tmp, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail(`npm pack failed (exit ${result.status})`, result.stderr);
  }
  let tarballName;
  try {
    const packInfo = JSON.parse(result.stdout);
    tarballName = Array.isArray(packInfo) ? packInfo[0]?.filename : packInfo?.filename;
  } catch (err) {
    fail(`failed to parse npm pack --json output: ${err.message}`, result.stdout);
  }
  if (!tarballName) {
    fail('npm pack did not report a tarball name', result.stdout);
  }
  const tarball = join(tmp, tarballName);
  if (!existsSync(tarball)) {
    fail(`reported tarball does not exist on disk: ${tarball}`);
  }
  console.log(`📦 Packed tarball: ${tarball}`);
  return tarball;
}

// ── 3. Install into a fresh consumer project ──────────────────────────────
function installInConsumer(tarball) {
  const consumer = mkdtempSync(join(tmpdir(), 'foundryvtt-mcp-consumer-'));
  registerCleanup(consumer);

  // Minimal consumer package.json — avoids npm init prompts and lifecycle scripts.
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'foundryvtt-mcp-pack-test', version: '0.0.0', private: true }, null, 2)}\n`,
  );

  const install = spawnSync(
    'npm',
    ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error', tarball],
    { cwd: consumer, encoding: 'utf8' },
  );
  if (install.status !== 0) {
    fail(`npm install <tarball> failed (exit ${install.status})`, install.stderr);
  }

  const installedRoot = join(consumer, 'node_modules', pkgJson.name);
  const serverPath = join(installedRoot, 'dist', 'index.js');
  if (!existsSync(serverPath)) {
    fail(`server entrypoint missing in installed package: ${serverPath}`);
  }
  verifyLegacyClientImport(installedRoot, consumer);
  const integrationSmoke = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'smoke-integrations.js'), installedRoot],
    {
      cwd: consumer,
      encoding: 'utf8',
      timeout: 20000,
    },
  );
  if (integrationSmoke.status !== 0) {
    fail('Installed integration smoke failed', integrationSmoke.stderr || integrationSmoke.stdout);
  }
  process.stdout.write(integrationSmoke.stdout);
  console.log(`📥 Installed at: ${installedRoot}`);
  return { consumer, serverPath };
}

// Import the public legacy subpath from the consumer, not the source tree.
// Constructing a client and probing an injected getter makes no network request.
function verifyLegacyClientImport(installedRoot, consumer) {
  for (const declaration of [
    'foundry/client.d.ts',
    'foundry/rest-probe.d.ts',
    'foundry/types.d.ts',
    'providers/document-provider.d.ts',
    'providers/types.d.ts',
  ]) {
    if (!existsSync(join(installedRoot, 'dist', declaration))) {
      fail(`legacy client declaration missing in installed package: dist/${declaration}`);
    }
  }
  const source = `
    import assert from 'node:assert/strict';
    import { FoundryClient, probeRestModule } from ${JSON.stringify(`${pkgJson.name}/dist/foundry/client.js`)};
    assert.equal(typeof FoundryClient, 'function');
    assert.equal(typeof probeRestModule, 'function');
    const client = new FoundryClient({ baseUrl: 'http://127.0.0.1:1' });
    try {
      assert.equal(client.isConnected(), false);
      for (const method of ['connect', 'disconnect', 'testConnection', 'searchActors', 'getActor',
        'searchItems', 'searchCompendium', 'getWorldInfo', 'rollDice', 'get', 'post', 'put', 'delete']) {
        assert.equal(typeof client[method], 'function', 'Missing legacy method: ' + method);
      }
      const world = await probeRestModule(async (url) => {
        assert.equal(url, '/api/world');
        // The probe validates the module's { success: true, data } envelope, so a
        // bare { data } body is rejected as an incompatible server (#330).
        return { data: { success: true, data: { id: 'legacy-import-smoke' } } };
      });
      assert.equal(world.id, 'legacy-import-smoke');
    } finally {
      await client.disconnect();
    }
    console.log('Legacy client import smoke passed: public exports, methods and declarations.');
  `;
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('FOUNDRY_')),
  );
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: consumer,
    env: { ...childEnv, FOUNDRY_URL: 'http://127.0.0.1:1', LOG_LEVEL: 'error' },
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.status !== 0) {
    fail(
      'Installed legacy client import smoke failed',
      result.stderr || result.error?.message || result.stdout,
    );
  }
  process.stdout.write(result.stdout);
}

// ── 5. Spawn the installed server and wait for the banner ────────────────
function runInstalledServer({ consumer, serverPath }) {
  return new Promise((resolve) => {
    const child = spawn('node', [serverPath], {
      cwd: consumer,
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

    const finish = (success, message) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);

      const stillAlive = success && child.exitCode === null && child.signalCode === null;

      if (success && stillAlive) {
        console.log(`✅ Pack smoke test passed: ${message}`);
        terminate(0);
        return;
      }

      console.error(`❌ Pack smoke test failed: ${message}`);
      if (stderr) {
        console.error('--- stderr ---');
        console.error(stderr);
      }
      if (stdout) {
        console.error('--- stdout ---');
        console.error(stdout);
      }
      terminate(1);
    };

    const terminate = (exitCode) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        cleanupAll();
        if (exitCode !== 0) {
          process.exit(exitCode);
        }
        resolve();
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
        cleanupAll();
        if (exitCode !== 0) {
          process.exit(exitCode);
        }
        resolve();
      });
    };

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
      if (resolved) {
        return;
      }
      finish(false, `server exited prematurely (code=${code}, signal=${signal})`);
    });
    child.on('error', (err) => {
      if (resolved) {
        return;
      }
      finish(false, `failed to spawn server: ${err.message}`);
    });

    const timeout = setTimeout(() => {
      if (resolved) {
        return;
      }
      finish(false, `timed out after ${STARTUP_TIMEOUT_MS}ms waiting for banner`);
    }, STARTUP_TIMEOUT_MS);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
validateFilesEntries();
const tarball = packTarball();
const installed = installInConsumer(tarball);
await runInstalledServer(installed);
