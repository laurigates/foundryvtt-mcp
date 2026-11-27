import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_SOURCES,
  type Capability,
  configuredSources,
  preferredSource,
  sourceOrder,
  TOOL_CAPABILITIES,
} from '../capabilities.js';

describe('capability source table', () => {
  it('lists the preferred source among the sources of every capability', () => {
    for (const [capability, spec] of Object.entries(CAPABILITY_SOURCES)) {
      expect(spec.sources, capability).toContain(spec.preferred);
    }
  });

  it('names a known capability for every tool, first entry primary', () => {
    const known = new Set(Object.keys(CAPABILITY_SOURCES));
    for (const [tool, capabilities] of Object.entries(TOOL_CAPABILITIES)) {
      expect(capabilities.length, tool).toBeGreaterThan(0);
      for (const capability of capabilities) {
        expect(known.has(capability), `${tool}: ${capability}`).toBe(true);
      }
    }
  });

  it.each([
    ['socket', ['socket', 'local']],
    ['rest', ['rest', 'local']],
    ['dual', ['socket', 'rest', 'local']],
  ] as const)('configures the right sources in %s mode', (mode, expected) => {
    expect([...configuredSources(mode)].sort()).toEqual([...expected].sort());
  });
});

describe('source selection per mode', () => {
  const cases: Array<[Capability, 'socket' | 'rest' | 'dual', string[]]> = [
    // Derived actor values: the bridge when it is configured, else the
    // computed-from-source values (#309) and their labels.
    ['actor-derived', 'dual', ['rest', 'socket']],
    ['actor-derived', 'socket', ['socket']],
    ['actor-derived', 'rest', ['rest']],
    // Base actor data stays on the Socket.IO snapshot when it is there.
    ['actors', 'dual', ['socket', 'rest']],
    ['actors', 'rest', ['rest']],
    ['items', 'dual', ['socket', 'rest']],
    ['scenes', 'dual', ['socket', 'rest']],
    ['world-info', 'dual', ['socket', 'rest']],
    // Bridge-only data.
    ['compendium', 'dual', ['rest']],
    ['compendium', 'socket', []],
    ['logs', 'dual', ['rest']],
    ['system-health', 'dual', ['rest']],
    // Socket-only data.
    ['writes', 'dual', ['socket']],
    ['writes', 'rest', []],
    ['world-snapshot', 'dual', ['socket']],
    ['world-snapshot', 'rest', []],
    // Foundry's Roll engine when the bridge is configured, the local roller otherwise.
    ['dice', 'dual', ['rest', 'local']],
    ['dice', 'socket', ['local']],
    ['local', 'rest', ['local']],
  ];

  it.each(cases)('%s in %s mode tries %j in order', (capability, mode, expected) => {
    expect(sourceOrder(capability, mode)).toEqual(expected);
    expect(preferredSource(capability, mode)).toBe(expected[0]);
  });
});
