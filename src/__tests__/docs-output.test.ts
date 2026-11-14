import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pins where TypeDoc writes its output (issue #246).
 *
 * TypeDoc 0.28 defaults `cleanOutputDir` to true, so pointing it at `docs/`
 * deletes the hand-written ADRs, PRDs, PRPs and guides committed there. Every
 * place that configures the output directory must agree on a directory that
 * is not `docs/`, and the Pages workflow must upload the directory it built.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(`${repoRoot}${path}`, 'utf8');

/** `./build/docs/` and `build/docs` compare equal. */
const normalize = (path: string): string => path.replace(/^\.\//, '').replace(/\/+$/, '');

const outFlag = (command: string, source: string): string => {
  const match = command.match(/--out\s+['"]?([^\s'"\\]+)/);
  if (!match?.[1]) {
    throw new Error(`no --out flag found in ${source}`);
  }
  return normalize(match[1]);
};

const typedocOut = (): string => {
  const config = JSON.parse(read('typedoc.json')) as { out?: unknown };
  if (typeof config.out !== 'string') {
    throw new Error('typedoc.json has no string "out"');
  }
  return normalize(config.out);
};

describe('TypeDoc output directory', () => {
  it('typedoc.json does not write into the hand-written docs/ tree', () => {
    expect(typedocOut()).not.toBe('docs');
  });

  it('package.json docs script writes where typedoc.json does', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const script = pkg.scripts.docs;
    if (!script) {
      throw new Error('package.json has no "docs" script');
    }
    expect(outFlag(script, 'package.json scripts.docs')).toBe(typedocOut());
  });

  it('docs.yml uploads the directory its TypeDoc step builds', () => {
    const workflow = read('.github/workflows/docs.yml');
    const built = outFlag(workflow, '.github/workflows/docs.yml');
    const upload = workflow.match(
      /upload-pages-artifact@[^\n]*\n\s*with:\s*\n\s*path:\s*['"]?([^\s'"]+)/,
    );
    if (!upload?.[1]) {
      throw new Error('no upload-pages-artifact path in docs.yml');
    }
    expect(built).not.toBe('docs');
    expect(normalize(upload[1])).toBe(built);
  });
});
