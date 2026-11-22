import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('type-checks a pre-provider consumer of the public client and configuration exports', () => {
  const directory = mkdtempSync(join(process.cwd(), '.test-legacy-client-'));
  try {
    const source = join(directory, 'consumer.ts');
    writeFileSync(
      source,
      `import type { Config } from '../src/config/index.js';
import {
  FoundryClient, probeRestModule,
  type AttributePatch, type CompendiumSearchParams, type FoundryClientConfig,
  type SearchActorsParams, type SearchItemsParams,
} from '../src/foundry/client.js';
import { BaseTool, type ToolContext, type ToolResult } from '../src/tools/base.js';

// Existing embedders construct this shape without a target list.
const config: Config = {
  serverName: 'embedded', serverVersion: '1.0.0', logLevel: 'info', nodeEnv: 'test',
  foundry: {
    url: 'http://foundry.test', apiKey: 'fixture-key', socketPath: '/socket.io/',
    timeout: 10000, retryAttempts: 3, retryDelay: 1000, writeEnabled: false,
  },
  cache: { enabled: true, ttlSeconds: 300, maxSize: 1000 },
};
const options: FoundryClientConfig = { baseUrl: config.foundry.url, apiKey: 'fixture-key' };
const client: FoundryClient = new FoundryClient(options);
const actors: SearchActorsParams = { query: 'Hero', type: 'character', limit: 10 };
const items: SearchItemsParams = { query: 'Sword', rarity: 'common', limit: 10 };
const compendium: CompendiumSearchParams = { query: 'Spell', spellLevel: 1, cursor: 'next' };
const patch: AttributePatch = { 'attributes.hp.value': 0 };
const context: ToolContext = { foundryClient: client };

class LegacyDiceTool extends BaseTool {
  readonly name = 'legacy_dice';
  readonly description = 'An existing embedded tool';
  readonly inputSchema = { type: 'object' };
  protected async executeValidated(
    _args: Record<string, unknown>, context: ToolContext,
  ): Promise<ToolResult> {
    const result = await context.foundryClient.rollDice('1d20');
    // The historical context exposed the full client, including its HTTP helpers.
    const posted = await context.foundryClient.post<{ accepted: boolean }>('/api/example', {});
    const accepted: boolean = posted.data.accepted;
    void accepted;
    return { content: [{ type: 'text', text: String(result.total) }] };
  }
}

async function useExistingApi() {
  await client.connect();
  const actorName: string | undefined = (await client.searchActors(actors)).actors[0]?.name;
  await client.searchItems(items);
  await client.searchCompendium(compendium);
  await client.updateActorAttribute('actor00000000001', patch);
  const response = await client.get<{ id: string }>('/api/world');
  const worldId: string = response.data.id;
  await client.post('/api/example', { value: 1 });
  await client.put('/api/example', { value: 2 });
  await client.delete('/api/example');
  await probeRestModule((url) => client.get(url));
  await new LegacyDiceTool().execute({}, context);
  await client.disconnect();
  return { actorName, worldId };
}
void useExistingApi;
`,
    );
    const configFile = ts.readConfigFile(resolve('tsconfig.json'), ts.sys.readFile);
    expect(configFile.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
    const program = ts.createProgram([source], {
      ...parsed.options,
      rootDir: process.cwd(),
      noEmit: true,
      incremental: false,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      }),
    ).toBe('');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
