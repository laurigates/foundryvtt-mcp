/**
 * Pins issue #251: in docker-compose.test.yml the fvtt-test service must take
 * FOUNDRY_LICENSE_KEY / FOUNDRY_USERNAME / FOUNDRY_PASSWORD from
 * `.env.integration` (its `env_file:`), never from its `environment:` block.
 *
 * Compose gives `environment:` precedence over `env_file:`, and `${VAR}`
 * interpolation reads the shell and a project-root `.env`, never an
 * `env_file:` entry. integration-test.yml writes the CI secrets only into
 * `.env.integration`, so any of these three keys in `environment:` hands the
 * felddy container an empty licence key and placeholder foundryvtt.com
 * credentials instead of the secrets.
 *
 * No YAML parser is a direct dependency, so the service block is scoped with
 * the small indentation-based reader below, which is itself tested on an
 * inline fixture.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const COMPOSE_PATH = fileURLToPath(new URL('../../docker-compose.test.yml', import.meta.url));
const SERVICE = 'fvtt-test';
const CREDENTIAL_VARS = ['FOUNDRY_LICENSE_KEY', 'FOUNDRY_USERNAME', 'FOUNDRY_PASSWORD'] as const;

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isSkippable = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
};

/** Lines nested under the key line at `start` (deeper indent), comments and blanks dropped. */
function childLines(lines: string[], start: number): string[] {
  const keyIndent = indentOf(lines[start] ?? '');
  const children: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (isSkippable(line)) {
      continue;
    }
    if (indentOf(line) <= keyIndent) {
      break;
    }
    children.push(line);
  }
  return children;
}

function findKey(lines: string[], key: string, indent: number): number {
  return lines.findIndex(
    (line) => !isSkippable(line) && indentOf(line) === indent && line.trim().startsWith(`${key}:`),
  );
}

/**
 * Returns the entries of `services.<service>.<key>` as strings: list items
 * without their `- ` marker, map entries as `KEY: value`, or a scalar value on
 * the key line itself. Throws when the service or key is missing.
 */
function readServiceEntries(compose: string, service: string, key: string): string[] {
  const lines = compose.split('\n');
  const servicesAt = findKey(lines, 'services', 0);
  if (servicesAt === -1) {
    throw new Error('no top-level services: key');
  }

  const serviceLines = childLines(lines, servicesAt);
  const serviceIndent = indentOf(serviceLines[0] ?? '');
  const serviceAt = findKey(serviceLines, service, serviceIndent);
  if (serviceAt === -1) {
    throw new Error(`no service ${service}`);
  }

  const body = childLines(serviceLines, serviceAt);
  const bodyIndent = indentOf(body[0] ?? '');
  const keyAt = findKey(body, key, bodyIndent);
  if (keyAt === -1) {
    throw new Error(`service ${service} has no ${key}: key`);
  }

  const inline = (body[keyAt] ?? '')
    .trim()
    .slice(key.length + 1)
    .trim();
  if (inline !== '') {
    return [inline];
  }
  return childLines(body, keyAt).map((line) => unquote(line.trim().replace(/^-\s*/, '')));
}

/**
 * Strips one layer of surrounding YAML quotes (`"..."` or `'...'`). Compose
 * reads `- "FOUNDRY_USERNAME=x"` as `FOUNDRY_USERNAME=x`, so a quoted entry
 * must not hide the variable name from the assertions below.
 */
const unquote = (text: string): string => text.replace(/^(["'])(.*)\1$/, '$2');

/** The variable name an `environment:` entry sets (`KEY=value` or `KEY: value`, key optionally quoted). */
const definedName = (entry: string): string => unquote((entry.split(/[=:]/, 1)[0] ?? '').trim());

const FIXTURE = `services:
  other:
    environment:
      - FOUNDRY_USERNAME=elsewhere
  fvtt-test:
    image: example
    environment:
      - FOUNDRY_LICENSE_KEY=\${FOUNDRY_LICENSE_KEY}
      # a comment between entries
      - FOUNDRY_VERSION=\${FOUNDRY_VERSION:-14.367}

      - CONTAINER_PRESERVE_CONFIG=false
    env_file:
      - .env.integration
  quoted:
    environment:
      - "FOUNDRY_USERNAME=test-user"
      - 'FOUNDRY_PASSWORD=test-password'
  quotedmap:
    environment:
      "FOUNDRY_LICENSE_KEY": key
  mapform:
    environment:
      FOUNDRY_PASSWORD: \${FOUNDRY_PASSWORD}
    env_file: .env.scalar
`;

describe('readServiceEntries (inline fixture)', () => {
  it('reads list-form environment entries of the named service only, skipping comments and blanks', () => {
    expect(readServiceEntries(FIXTURE, 'fvtt-test', 'environment')).toEqual([
      `FOUNDRY_LICENSE_KEY=\${FOUNDRY_LICENSE_KEY}`,
      `FOUNDRY_VERSION=\${FOUNDRY_VERSION:-14.367}`,
      'CONTAINER_PRESERVE_CONFIG=false',
    ]);
  });

  it('reads list-form env_file', () => {
    expect(readServiceEntries(FIXTURE, 'fvtt-test', 'env_file')).toEqual(['.env.integration']);
  });

  it('reads map-form environment and scalar env_file', () => {
    expect(readServiceEntries(FIXTURE, 'mapform', 'environment')).toEqual([
      `FOUNDRY_PASSWORD: \${FOUNDRY_PASSWORD}`,
    ]);
    expect(readServiceEntries(FIXTURE, 'mapform', 'env_file')).toEqual(['.env.scalar']);
  });

  it('throws on a missing service or key instead of returning nothing', () => {
    expect(() => readServiceEntries(FIXTURE, 'absent', 'environment')).toThrow(/no service/);
    expect(() => readServiceEntries(FIXTURE, 'other', 'env_file')).toThrow(/no env_file/);
  });

  it('extracts the defined variable name from both entry forms', () => {
    expect(definedName(`FOUNDRY_USERNAME=\${FOUNDRY_USERNAME:-test-user}`)).toBe(
      'FOUNDRY_USERNAME',
    );
    expect(definedName(`FOUNDRY_PASSWORD: \${FOUNDRY_PASSWORD}`)).toBe('FOUNDRY_PASSWORD');
  });

  it('strips one layer of double or single quotes, as compose does', () => {
    const quoted = readServiceEntries(FIXTURE, 'quoted', 'environment');
    expect(quoted).toEqual(['FOUNDRY_USERNAME=test-user', 'FOUNDRY_PASSWORD=test-password']);
    expect(quoted.map(definedName)).toEqual(['FOUNDRY_USERNAME', 'FOUNDRY_PASSWORD']);
    expect(readServiceEntries(FIXTURE, 'quotedmap', 'environment').map(definedName)).toEqual([
      'FOUNDRY_LICENSE_KEY',
    ]);
  });
});

describe(`docker-compose.test.yml ${SERVICE} credentials (#251)`, () => {
  const compose = readFileSync(COMPOSE_PATH, 'utf8');
  const environment = readServiceEntries(compose, SERVICE, 'environment');

  it('parses a non-empty environment: block (guards against a reader that finds nothing)', () => {
    expect(environment).toContain('CONTAINER_PRESERVE_CONFIG=false');
  });

  it('loads .env.integration through env_file:', () => {
    expect(readServiceEntries(compose, SERVICE, 'env_file')).toContain('.env.integration');
  });

  it.each(
    CREDENTIAL_VARS,
  )('does not set %s in environment: (it would override env_file:)', (name) => {
    expect(environment.filter((entry) => definedName(entry) === name)).toEqual([]);
  });

  it.each(CREDENTIAL_VARS)('does not interpolate %s anywhere in environment:', (name) => {
    const interpolation = new RegExp(`\\$\\{?${name}\\b`);
    expect(environment.filter((entry) => interpolation.test(entry))).toEqual([]);
  });
});
