/**
 * @fileoverview Tests for the new tool registry system
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolRegistry } from '../registry.js';
import { RollDiceTool } from '../handlers/dice.js';
import { ToolContext } from '../base.js';

describe('Tool Registry', () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    mockContext = {
      foundryClient: {
        rollDice: vi.fn().mockResolvedValue({
          formula: '1d20+5',
          total: 15,
          breakdown: '(10) + 5',
          timestamp: '2025-01-01T00:00:00Z',
        }),
      } as any,
      diagnosticsClient: {} as any,
      diagnosticSystem: {} as any,
    };
  });

  describe('Tool Registration', () => {
    it('should have roll_dice tool registered', () => {
      expect(toolRegistry.has('roll_dice')).toBe(true);
    });

    it('should return tool definitions', () => {
      const definitions = toolRegistry.getToolDefinitions();
      const rollDiceDefinition = definitions.find(d => d.name === 'roll_dice');
      
      expect(rollDiceDefinition).toBeDefined();
      expect(rollDiceDefinition?.description).toContain('Roll dice');
      expect(rollDiceDefinition?.inputSchema).toBeDefined();
    });

    it('should get tool names', () => {
      const names = toolRegistry.getToolNames();
      expect(names).toContain('roll_dice');
    });
  });

  describe('Tool Execution', () => {
    it('should execute roll_dice tool with valid parameters', async () => {
      const result = await toolRegistry.execute('roll_dice', {
        formula: '1d20+5',
        reason: 'attack roll'
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Dice Roll Result');
      expect(result.content[0].text).toContain('1d20+5');
      expect(result.content[0].text).toContain('15');
    });

    it('should validate parameters and throw error for missing formula', async () => {
      await expect(
        toolRegistry.execute('roll_dice', {}, mockContext)
      ).rejects.toThrow('Invalid parameters');
    });

    it('should validate parameters and throw error for wrong type', async () => {
      await expect(
        toolRegistry.execute('roll_dice', {
          formula: 123 // should be string
        }, mockContext)
      ).rejects.toThrow('Invalid parameters');
    });

    it('should throw error for unknown tool', async () => {
      await expect(
        toolRegistry.execute('unknown_tool', {}, mockContext)
      ).rejects.toThrow('Unknown tool');
    });
  });

  describe('Tool Instance Management', () => {
    it('should return tool instance for registered tool', () => {
      const tool = toolRegistry.get('roll_dice');
      expect(tool).toBeInstanceOf(RollDiceTool);
    });

    it('should return undefined for unregistered tool', () => {
      const tool = toolRegistry.get('nonexistent_tool');
      expect(tool).toBeUndefined();
    });
  });
});