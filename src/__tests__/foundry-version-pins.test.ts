import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// docker-compose.test.yml pins the FoundryVTT build twice: the felddy image
// tag and the FOUNDRY_VERSION default. The felddy image ships no Foundry; it
// downloads the build FOUNDRY_VERSION names at container start, so a bump to
// the tag alone runs the old core on the new image and the integration tier
// still goes green (#233). renovate.json groups both pins into one PR; this
// test fails any change that moves one without the other.
//
// Resolutions when it fails: set the image tag and the FOUNDRY_VERSION
// default to the same x.y build (passes). Dropping either pin, or moving
// the default off x.y, makes the "finds both pins" case fail; update the
// regexes below and the customManager in renovate.json together if the file
// layout changes.
const COMPOSE_PATH = new URL('../../docker-compose.test.yml', import.meta.url);

const IMAGE_TAG = /^\s*image:\s*felddy\/foundryvtt:(\S+)\s*$/m;
const FOUNDRY_VERSION_DEFAULT = /^\s*-\s*FOUNDRY_VERSION=\$\{FOUNDRY_VERSION:-([^}]+)\}\s*$/m;

function readPins(): { imageTag?: string; foundryVersion?: string } {
  const compose = readFileSync(COMPOSE_PATH, 'utf8');
  const imageTag = IMAGE_TAG.exec(compose)?.[1];
  const foundryVersion = FOUNDRY_VERSION_DEFAULT.exec(compose)?.[1];
  return {
    ...(imageTag === undefined ? {} : { imageTag }),
    ...(foundryVersion === undefined ? {} : { foundryVersion }),
  };
}

describe('docker-compose.test.yml FoundryVTT pins (#233)', () => {
  it('finds both pins: the felddy image tag and the FOUNDRY_VERSION default', () => {
    const { imageTag, foundryVersion } = readPins();
    expect(imageTag, 'image: felddy/foundryvtt:<tag> line').toBeDefined();
    expect(foundryVersion, 'FOUNDRY_VERSION default (:-<x.y>) line').toBeDefined();
    // The renovate.json customManager matches only [0-9]+\.[0-9]+, so a
    // default in any other shape (e.g. 14.367.1) would still pass the
    // equality case below while Renovate silently stops tracking it.
    expect(
      foundryVersion,
      'FOUNDRY_VERSION default must be x.y: the renovate.json customManager only detects [0-9]+.[0-9]+',
    ).toMatch(/^[0-9]+\.[0-9]+$/);
  });

  it('image tag equals the FOUNDRY_VERSION default, since a tag-only bump silently tests the old core (#233)', () => {
    const { imageTag, foundryVersion } = readPins();
    expect(imageTag).toBe(foundryVersion);
  });
});
