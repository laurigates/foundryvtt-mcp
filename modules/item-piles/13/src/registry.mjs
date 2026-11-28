/** Package-owned operations; callers cannot choose an arbitrary API method. */
import { operations as inventory } from './inventory.mjs';
import { operations as merchant } from './merchant.mjs';
import { operations as piles } from './piles.mjs';

export { createRuntime } from './runtime.mjs';

export const operations = Object.freeze(
  [...inventory, ...piles, ...merchant].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
);

export const metadata = Object.freeze({
  schemaVersion: 1,
  protocolVersion: 1,
  kind: 'module',
  foundryGeneration: 13,
  id: 'item-piles',
  adapterVersion: '0.2.1',
  updatedAt: '2026-11-22',
  status: 'experimental',
  upstream: {
    repository: 'https://github.com/fantasycalendar/FoundryVTT-ItemPiles',
    reference: '3.3.4@85ab971406623fb1c5d01eb1f093fe4855ede6e4',
    updatedAt: '2026-07-18',
    verifiedAt: null,
  },
  // Version restrictions for new operations live in the runtime/probes so the
  // existing get_items operation keeps its capability-based compatibility.
  compatibility: { foundryVersions: ['13'], integrationVersions: [], tested: [] },
});
