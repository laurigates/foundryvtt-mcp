import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { FoundryClient } from '../../foundry/client.js';
import { BaseTool, type Tool, type ToolContext, type ToolResult } from '../base.js';
import { RollDiceTool } from '../handlers/dice.js';
import { ToolRegistry } from '../registry.js';

const roll = {
  formula: '1d20',
  total: 12,
  breakdown: '[12]',
  timestamp: '2026-11-22T00:00:00.000Z',
  source: 'local' as const,
};

function client() {
  const value = new FoundryClient({ baseUrl: 'http://foundry.test' });
  vi.spyOn(value, 'rollDice').mockResolvedValue(roll);
  return value;
}

class LegacyTool extends BaseTool {
  readonly name = 'legacy_tool';
  readonly description = 'Existing extension using foundryClient';
  readonly inputSchema = { type: 'object' };

  protected async executeValidated(
    _args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const result = await context.foundryClient.rollDice('1d20');
    return this.createTextResponse(String(result.total));
  }
}

describe('legacy tool contexts', () => {
  it('accepts the old foundryClient context in a current BaseTool', async () => {
    const foundryClient = client();
    const result = await new RollDiceTool().execute({ formula: '1d20' }, { foundryClient });
    expect(result.content[0]?.text).toContain('**Total:** 12');
    expect(foundryClient.rollDice).toHaveBeenCalledOnce();
  });

  it('supplies foundryClient to an existing BaseTool subclass through the provider context', async () => {
    const provider = client();
    const result = await new LegacyTool().execute({}, { provider });
    expect(result.content[0]?.text).toBe('12');
    expect(provider.rollDice).toHaveBeenCalledOnce();
  });

  it('normalizes both aliases for custom registry tools that do not extend BaseTool', async () => {
    const provider = client();
    const execute = vi.fn(async (_args: Record<string, unknown>, context: ToolContext) => {
      expect(context.foundryClient).toBe(provider);
      expect(Reflect.get(context, 'provider')).toBe(provider);
      return { content: [{ type: 'text', text: 'same target' }] };
    });
    const custom: Tool = {
      name: 'custom_legacy_tool',
      description: 'Existing registry extension',
      inputSchema: { type: 'object' },
      execute,
    };
    const registry = new ToolRegistry();
    registry.register(custom);
    await registry.execute(custom.name, {}, { provider });
    await registry.execute(custom.name, {}, { foundryClient: provider });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects conflicting aliases before an extension can select a different target', async () => {
    const provider = client();
    const other = client();
    const context = { provider, foundryClient: other };
    const registry = new ToolRegistry();
    await expect(new RollDiceTool().execute({ formula: '1d20' }, context)).rejects.toBeInstanceOf(
      McpError,
    );
    await expect(registry.execute('roll_dice', { formula: '1d20' }, context)).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    expect(provider.rollDice).not.toHaveBeenCalled();
    expect(other.rollDice).not.toHaveBeenCalled();
  });
});
