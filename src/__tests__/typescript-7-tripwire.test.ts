import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Tripwire: TypeScript stays on 6.x only because TypeDoc (`just docs`) does
// not yet accept TypeScript 7. TypeDoc 0.28.20's peer range ends at 6.0.x.
// When a TypeDoc bump lands whose peer range admits 7.x, this test fails.
//
// Resolution when it fails: bump `typescript` to 7 in package.json, run
// `just qa` and `just docs`, then delete this file in the same PR.
const TYPEDOC_PKG = new URL('../../node_modules/typedoc/package.json', import.meta.url);

function acceptsTypeScript7(range: string): boolean {
  return range
    .split('||')
    .map((part) => part.trim())
    .some((part) => /^(\^|~|>=?)?\s*7(\.|$)/.test(part) || /^>=?\s*[0-6]\./.test(part));
}

describe('TypeScript 7 tripwire (TypeDoc peer range)', () => {
  it('detects 7.x in a peer range (guard has teeth)', () => {
    expect(acceptsTypeScript7('5.9.x || 6.0.x || 7.0.x')).toBe(true);
    expect(acceptsTypeScript7('>=5.0.0')).toBe(true);
    expect(acceptsTypeScript7('5.9.x || 6.0.x')).toBe(false);
  });

  it('installed TypeDoc does not accept TypeScript 7 yet', () => {
    const pkg = JSON.parse(readFileSync(TYPEDOC_PKG, 'utf8')) as {
      version: string;
      peerDependencies?: { typescript?: string };
    };
    const range = pkg.peerDependencies?.typescript;
    expect(range, 'typedoc peerDependencies.typescript').toBeDefined();
    expect(
      acceptsTypeScript7(range ?? ''),
      `typedoc ${pkg.version} now accepts TypeScript 7 (${range}): bump typescript and delete this test`,
    ).toBe(false);
  });
});
