import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { WorldData } from '../types.js';
import { searchWorldDocuments } from '../world-search.js';

function sampleWorld(): WorldData {
  return {
    actors: [
      {
        _id: 'actor1',
        name: 'Quiet Traveler',
        type: 'npc',
        system: {
          details: {
            biography: {
              value: '<p>Guarding the <strong>Silver Labyrinth</strong> beneath the castle.</p>',
            },
          },
        },
      },
      {
        _id: 'actor2',
        name: 'Aria',
        type: 'character',
        system: { details: { biography: { public: 'A scholar of the bibliothèque.' } } },
      },
    ],
    items: [
      {
        _id: 'item1',
        name: 'Ancient Brooch',
        type: 'equipment',
        system: { description: { value: '<p>Carved from amber &amp; moonstone.</p>' } },
      },
    ],
    scenes: [
      {
        _id: 'scene1',
        name: 'Forgotten Valley',
        active: true,
        navigation: true,
        width: 100,
        height: 100,
        padding: 0,
        darkness: 0,
        globalLight: false,
        drawings: [{ text: 'A secret archway lies below.' }],
        notes: [{ text: 'The old burial place is nearby.' }],
        tokens: [{ name: 'Goblin Outrider' }],
      },
    ],
    journal: [
      {
        _id: 'journal1',
        name: 'Campaign Timeline',
        pages: [
          {
            _id: 'page1',
            name: 'Chapter One',
            type: 'text',
            text: { content: '<p>Ask the <em>innkeeper</em> about the silver key.</p>', format: 1 },
          },
        ],
      },
    ],
    userId: 'gm1',
    release: {},
    world: {},
    system: {},
    modules: [],
    demoMode: false,
    messages: [],
    combats: [],
    users: [],
    activeUsers: [],
    settings: [],
    folders: [],
    macros: [],
    playlists: [],
    tables: [],
    cards: [],
    packs: [],
  };
}

describe('searchWorldDocuments', () => {
  it('preserves case-insensitive name matching across all four collections', () => {
    const world = sampleWorld();
    expect(searchWorldDocuments(world, 'quiet').actors.map((a) => a._id)).toEqual(['actor1']);
    expect(searchWorldDocuments(world, 'brooch').items.map((i) => i._id)).toEqual(['item1']);
    expect(searchWorldDocuments(world, 'valley').scenes.map((s) => s._id)).toEqual(['scene1']);
    expect(searchWorldDocuments(world, 'timeline').journals.map((j) => j._id)).toEqual([
      'journal1',
    ]);
    expect(searchWorldDocuments(world, 'timeline').matchDetails.journals.journal1?.field).toBe(
      'name',
    );
  });

  it('searches actor biographies and item descriptions, decoding HTML entities', () => {
    const world = sampleWorld();
    const actor = searchWorldDocuments(world, 'silver labyrinth');
    expect(actor.actors.map((a) => a._id)).toEqual(['actor1']);
    expect(actor.matchDetails.actors.actor1?.field).toContain('biography');
    expect(actor.matchDetails.actors.actor1?.excerpt).toContain('Silver Labyrinth');
    expect(actor.matchDetails.actors.actor1?.excerpt).not.toContain('<strong>');

    const item = searchWorldDocuments(world, 'amber & moonstone');
    expect(item.items.map((i) => i._id)).toEqual(['item1']);
    expect(item.matchDetails.items.item1?.field).toBe('system.description.value');
  });

  it('searches scene annotations, drawings and token names', () => {
    const world = sampleWorld();
    expect(searchWorldDocuments(world, 'secret archway').scenes.map((s) => s._id)).toEqual([
      'scene1',
    ]);
    expect(searchWorldDocuments(world, 'burial place').scenes.map((s) => s._id)).toEqual([
      'scene1',
    ]);
    expect(searchWorldDocuments(world, 'goblin outrider').scenes.map((s) => s._id)).toEqual([
      'scene1',
    ]);
  });

  it('searches journal page text and names and returns plain-text context', () => {
    const world = sampleWorld();
    const result = searchWorldDocuments(world, 'silver key');
    expect(result.journals.map((j) => j._id)).toEqual(['journal1']);
    expect(result.matchDetails.journals.journal1?.field).toBe('pages[0].text.content');
    expect(result.matchDetails.journals.journal1?.excerpt).toContain('silver key');
    expect(searchWorldDocuments(world, 'chapter one').journals.map((j) => j._id)).toEqual([
      'journal1',
    ]);
  });

  it('normalizes accents and ignores text appearing only in HTML markup', () => {
    const world = sampleWorld();
    expect(searchWorldDocuments(world, 'bibliotheque').actors.map((a) => a._id)).toEqual([
      'actor2',
    ]);
    expect(searchWorldDocuments(world, 'strong').actors).toEqual([]);
    expect(searchWorldDocuments(world, 'em').journals).toEqual([]);
  });

  it('searches legacy journal content and produces bounded excerpts', () => {
    const world = sampleWorld();
    const journal = world.journal.find((entry) => entry._id === 'journal1');
    expect(journal).toBeDefined();
    Object.assign(journal, {
      content: `Story: ${'x'.repeat(300)} hidden-library ${'y'.repeat(300)}`,
    });
    const result = searchWorldDocuments(world, 'hidden-library');
    expect(result.journals).toHaveLength(1);
    expect(result.matchDetails.journals.journal1?.excerpt.length).toBeLessThan(200);
  });

  it('returns empty results for blank queries and missing world data', () => {
    expect(searchWorldDocuments(sampleWorld(), '  ').actors).toEqual([]);
    expect(searchWorldDocuments(sampleWorld(), '<b>').actors).toEqual([]);
    expect(searchWorldDocuments(null, 'silver key').journals).toEqual([]);
  });

  it('keeps the excerpt window aligned when NFKD-changing text precedes the match', () => {
    const world = sampleWorld();
    const actor = world.actors.find((entry) => entry._id === 'actor1');
    expect(actor).toBeDefined();
    Object.assign(actor, {
      system: { details: { biography: { value: `${'Wait… '.repeat(30)}the dragon sleeps…` } } },
    });
    const result = searchWorldDocuments(world, 'dragon');
    expect(result.actors.map((a) => a._id)).toEqual(['actor1']);
    expect(result.matchDetails.actors.actor1?.excerpt).toContain('dragon');
  });

  it('matches a Greek word whose final sigma folds only under whole-string lowercasing', () => {
    const world = sampleWorld();
    const actor = world.actors.find((entry) => entry._id === 'actor1');
    expect(actor).toBeDefined();
    Object.assign(actor, { name: 'ΟΔΟΣ' });
    // The text ends in a capital sigma that lowercases to the final form ς only
    // when the whole string is lowercased; a per-code-point fold yields σ and
    // would miss the query's ς.
    expect(searchWorldDocuments(world, 'οδος').actors.map((a) => a._id)).toEqual(['actor1']);
  });

  it('strips nested markup so no tag survives in the excerpt', () => {
    const world = sampleWorld();
    const actor = world.actors.find((entry) => entry._id === 'actor1');
    expect(actor).toBeDefined();
    // The scanner consumes "<a<b>" in one go (the inner '<' is inside the tag),
    // then removes the reassembled "</a>", so no markup survives.
    Object.assign(actor, {
      system: { details: { biography: { value: 'needle <a<b>c</a>tail' } } },
    });
    const result = searchWorldDocuments(world, 'needle');
    expect(result.actors.map((a) => a._id)).toEqual(['actor1']);
    const excerpt = result.matchDetails.actors.actor1?.excerpt ?? '';
    expect(excerpt).toContain('needle');
    expect(excerpt).not.toContain('<');
    expect(excerpt).not.toContain('</a>');
  });

  it('joins words split by inline formatting so mid-word tags still match', () => {
    const world = sampleWorld();
    const actor = world.actors.find((entry) => entry._id === 'actor1');
    expect(actor).toBeDefined();
    Object.assign(actor, {
      system: {
        details: { biography: { value: 'Cast a fire<em>ball</em> at <strong>Gan</strong>dalf.' } },
      },
    });
    expect(searchWorldDocuments(world, 'fireball').actors.map((a) => a._id)).toEqual(['actor1']);
    expect(searchWorldDocuments(world, 'gandalf').actors.map((a) => a._id)).toEqual(['actor1']);
    const excerpt =
      searchWorldDocuments(world, 'fireball').matchDetails.actors.actor1?.excerpt ?? '';
    expect(excerpt).toContain('fireball');
  });

  it('treats an unmatched "<" as literal text', () => {
    const world = sampleWorld();
    const actor = world.actors.find((entry) => entry._id === 'actor1');
    expect(actor).toBeDefined();
    Object.assign(actor, {
      system: { details: { biography: { value: 'needle <a' } } },
    });
    const result = searchWorldDocuments(world, 'needle');
    expect(result.actors.map((a) => a._id)).toEqual(['actor1']);
    expect(result.matchDetails.actors.actor1?.excerpt).toContain('needle');
  });

  it.each([
    ['two style blocks', '<style>a</style> needle <style>b</style> tail'],
    ['two script blocks', '<script>a</script> needle <script>b</script> tail'],
    ['an earlier script close', '</script> needle <script>x</script> tail'],
    ['an earlier style close', '</style> needle <style>x</style> tail'],
    ['mixed-case tags', '<STYLE>a</style> needle <style>b</STYLE> tail'],
  ])('terminates and preserves visible journal text with %s', (_label, content) => {
    const world = sampleWorld();
    const journal = world.journal.find((entry) => entry._id === 'journal1');
    expect(journal).toBeDefined();
    Object.assign(journal, {
      pages: [{ _id: 'page1', name: 'Chapter One', type: 'text', text: { content, format: 1 } }],
    });
    // A synchronous loop blocks Vitest's own timeout. Run the real search in
    // a child process that the parent can kill if the cursor moves backwards.
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        `import { searchWorldDocuments } from ${JSON.stringify(new URL('../world-search.ts', import.meta.url).href)};
         const result = searchWorldDocuments(${JSON.stringify(world)}, 'needle');
         process.stdout.write(JSON.stringify({
           ids: result.journals.map(journal => journal._id),
           match: result.matchDetails.journals.journal1,
         }));`,
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(JSON.parse(output)).toEqual({
      ids: ['journal1'],
      match: { field: 'pages[0].text.content', excerpt: 'needle tail' },
    });
  });

  it.each(['script', 'style'])('excludes %s contents from search results', (tag) => {
    const world = sampleWorld();
    const actor = world.actors.find((entry) => entry._id === 'actor1');
    expect(actor).toBeDefined();
    Object.assign(actor, {
      system: { details: { biography: { value: `before <${tag}>needle</${tag}> after` } } },
    });
    expect(searchWorldDocuments(world, 'needle').actors).toEqual([]);
    expect(searchWorldDocuments(world, 'before after').matchDetails.actors.actor1?.excerpt).toBe(
      'before after',
    );
  });

  it.each(['hr', 'table', 'thead', 'tbody', 'tfoot', 'pre', 'dt', 'dd', 'figcaption'])(
    'separates words across block-level %s tags',
    (tag) => {
      const world = sampleWorld();
      const actor = world.actors.find((entry) => entry._id === 'actor1');
      expect(actor).toBeDefined();
      Object.assign(actor, {
        system: {
          details: {
            biography: {
              value: tag === 'hr' ? 'alpha<hr>beta' : `alpha<${tag}>beta</${tag}>gamma`,
            },
          },
        },
      });
      expect(searchWorldDocuments(world, 'alphabeta').actors).toEqual([]);
      const visible = tag === 'hr' ? 'alpha beta' : 'alpha beta gamma';
      const result = searchWorldDocuments(world, visible);
      expect(result.actors.map((a) => a._id)).toEqual(['actor1']);
      expect(result.matchDetails.actors.actor1?.excerpt).toBe(visible);
    },
  );

  it.each(['<', '<a', '<p'])(
    'strips 100 KB of crafted "%s" markup within the time bound',
    (chunk) => {
      const world = sampleWorld();
      const actor = world.actors.find((entry) => entry._id === 'actor1');
      expect(actor).toBeDefined();
      // A regex like <[^>]*> is quadratic on text with many '<' and no '>';
      // the scanner must stay linear so one crafted page cannot stall searches.
      // Include bare '<' for a wider margin against the quadratic stripper,
      // alongside inline- and block-tag prefixes.
      Object.assign(actor, {
        system: { details: { biography: { value: chunk.repeat(100_000 / chunk.length) } } },
      });
      const started = performance.now();
      const result = searchWorldDocuments(world, 'needle');
      const elapsed = performance.now() - started;
      expect(result.actors).toEqual([]);
      expect(elapsed).toBeLessThan(500);
    },
  );

  it('never mutates the cached world state', () => {
    const world = sampleWorld();
    const original = structuredClone(world);
    searchWorldDocuments(world, 'silver');
    searchWorldDocuments(world, 'secret archway');
    expect(world).toEqual(original);
  });
});
