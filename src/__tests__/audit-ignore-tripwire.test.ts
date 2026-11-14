/**
 * Tripwire for the `bun audit --ignore` exception in .github/workflows/security.yml (#247).
 *
 * The Dependency Audit job ignores GHSA-g3hv-75wg-m249 (minimatch ReDoS, fixed in 11.0.1)
 * because its only path is the devDependency typedoc, whose 0.28.x line declares
 * minimatch ^10 and crashes on minimatch 11 (TypeStrong/typedoc#3150). The ignore covers
 * the advisory for every package, so it stays correct only while typedoc is the sole lock
 * entry that asks for a pre-11 minimatch.
 *
 * Resolutions when this test fails:
 * - typedoc no longer asks for minimatch < 11 (Renovate bumped it): remove the `--ignore`
 *   from security.yml and delete this file. Updating the test instead leaves a stale
 *   exception in CI.
 * - another package now asks for minimatch < 11: bump or override that package; the
 *   `--ignore` would otherwise hide its advisory. Widening the allowed list here does not
 *   make that path safe.
 * - security.yml no longer carries the `--ignore`: delete this file.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ADVISORY = 'GHSA-g3hv-75wg-m249';
/** First minimatch major outside the advisory's range (>=7.0.0 <11.0.1). */
const FIXED_MAJOR = 11;
/** The one package the exception is meant for. */
const EXPECTED_DEPENDENT = 'typedoc';

const repoFile = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** Advisory IDs passed to `--ignore` on non-comment `bun audit` lines of a workflow. */
function ignoredAdvisories(workflow: string): string[] {
  return workflow
    .split('\n')
    .filter((line) => !line.trim().startsWith('#') && line.includes('bun audit'))
    .flatMap((line) => [...line.matchAll(/--ignore[= ](\S+)/g)])
    .flatMap((match) => (match[1] ?? '').split(','))
    .filter((id) => id.length > 0);
}

type LockEntry = [string, string, Record<string, Record<string, string> | undefined>?];

/** bun.lock is JSON with trailing commas. */
function parseBunLock(text: string): { packages: Record<string, LockEntry> } {
  return JSON.parse(text.replace(/,(\s*[}\]])/g, '$1'));
}

/** Lowest major a semver range admits, read from its first number ("^10.2.5" -> 10). */
function floorMajor(range: string): number {
  const match = range.match(/\d+/);
  return match ? Number(match[0]) : Number.NaN;
}

/** Names of lock packages whose declared minimatch range can resolve below FIXED_MAJOR. */
function vulnerableMinimatchDependents(lockText: string): string[] {
  const { packages } = parseBunLock(lockText);
  const names = Object.values(packages).flatMap(([ident, , meta]) => {
    const range = meta?.dependencies?.minimatch ?? meta?.optionalDependencies?.minimatch;
    if (range === undefined || floorMajor(range) >= FIXED_MAJOR) {
      return [];
    }
    return [ident.slice(0, ident.lastIndexOf('@'))];
  });
  return [...new Set(names)].sort();
}

/** Reasons the `--ignore` exception is no longer justified; empty while it still is. */
function staleIgnoreProblems(workflow: string, lockText: string): string[] {
  if (!ignoredAdvisories(workflow).includes(ADVISORY)) {
    return [];
  }
  const dependents = vulnerableMinimatchDependents(lockText);
  const problems: string[] = [];
  if (!dependents.includes(EXPECTED_DEPENDENT)) {
    problems.push(
      `${EXPECTED_DEPENDENT} no longer declares minimatch < ${FIXED_MAJOR}: remove ` +
        `--ignore=${ADVISORY} from .github/workflows/security.yml and delete this test`,
    );
  }
  const others = dependents.filter((name) => name !== EXPECTED_DEPENDENT);
  if (others.length > 0) {
    problems.push(
      `minimatch < ${FIXED_MAJOR} is also declared by ${others.join(', ')}; ` +
        `--ignore=${ADVISORY} would hide that path, so bump or override it`,
    );
  }
  return problems;
}

describe('bun audit --ignore tripwire (#247)', () => {
  const workflow = repoFile('.github/workflows/security.yml');
  const lock = repoFile('bun.lock');

  it(`security.yml ignores ${ADVISORY} on the bun audit step, so this tripwire is armed`, () => {
    // If the ignore was removed on purpose, delete this file.
    expect(ignoredAdvisories(workflow)).toContain(ADVISORY);
  });

  it(`the ignore is still justified: only ${EXPECTED_DEPENDENT} declares minimatch < ${FIXED_MAJOR}`, () => {
    expect(staleIgnoreProblems(workflow, lock)).toEqual([]);
  });

  describe('meta: the check fires on constructed inputs', () => {
    const ignoringWorkflow = [
      '# bun audit --ignore=GHSA-comment-only must not count',
      `        run: bun audit --audit-level=moderate --ignore=${ADVISORY}`,
    ].join('\n');
    const lockWith = (deps: Record<string, string>): string =>
      `{\n  "lockfileVersion": 1,\n  "packages": {\n${Object.entries(deps)
        .map(
          ([name, range]) =>
            `    "${name}": ["${name}@1.0.0", "", { "dependencies": { "minimatch": "${range}", }, }, "sha512-x"],\n`,
        )
        .join('')}  },\n}\n`;

    it('reads --ignore only from non-comment bun audit lines', () => {
      expect(ignoredAdvisories(ignoringWorkflow)).toEqual([ADVISORY]);
    });

    it('passes while typedoc is the only pre-11 dependent', () => {
      expect(
        staleIgnoreProblems(ignoringWorkflow, lockWith({ typedoc: '^10.2.5', other: '^11.0.5' })),
      ).toEqual([]);
    });

    it('fires once typedoc declares minimatch ^11', () => {
      const problems = staleIgnoreProblems(ignoringWorkflow, lockWith({ typedoc: '^11.0.5' }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`remove --ignore=${ADVISORY}`);
    });

    it('fires when another package declares minimatch < 11', () => {
      const problems = staleIgnoreProblems(
        ignoringWorkflow,
        lockWith({ typedoc: '^10.2.5', glob: '^10.2.2' }),
      );
      expect(problems).toEqual([expect.stringContaining('also declared by glob;')]);
    });

    it('stays silent when the workflow carries no ignore', () => {
      expect(
        staleIgnoreProblems('run: bun audit --audit-level=moderate', lockWith({ glob: '^10.0.0' })),
      ).toEqual([]);
    });
  });
});
