/**
 * @fileoverview Unit tests for dice handler — roll_dice formatting
 */

import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import { handleRollDice } from '../dice.js';

interface MockDiceRoll {
  formula: string;
  total: number;
  breakdown: string;
  reason?: string;
  timestamp: string;
}

function mockFoundryClient(roll: MockDiceRoll): FoundryClient {
  return {
    rollDice: vi.fn(async (_formula: string, _reason?: string) => roll),
  } as unknown as FoundryClient;
}

function getText(result: Awaited<ReturnType<typeof handleRollDice>>): string {
  return (result as { content: Array<{ type: string; text: string }> }).content[0]?.text ?? '';
}

describe('handleRollDice', () => {
  describe('happy path', () => {
    it('returns formatted result for a basic d20 roll', async () => {
      const client = mockFoundryClient({
        formula: '1d20',
        total: 14,
        breakdown: '[14]',
        timestamp: '2024-06-01T12:00:00.000Z',
      });

      const result = await handleRollDice({ formula: '1d20' }, client);
      const text = getText(result);

      expect(text).toContain('Dice Roll Result');
      expect(text).toContain('**Formula:** 1d20');
      expect(text).toContain('**Total:** 14');
      expect(text).toContain('**Breakdown:** [14]');
      expect(text).toContain('**Timestamp:** 2024-06-01T12:00:00.000Z');
      // No reason supplied — that line should be absent
      expect(text).not.toContain('**Reason:**');
      expect(client.rollDice).toHaveBeenCalledWith('1d20', undefined);
    });

    it('includes the reason line when supplied', async () => {
      const client = mockFoundryClient({
        formula: '3d6+4',
        total: 17,
        breakdown: '[5,4,4] + 4',
        reason: 'Damage roll',
        timestamp: '2024-06-01T12:00:00.000Z',
      });

      const result = await handleRollDice({ formula: '3d6+4', reason: 'Damage roll' }, client);
      const text = getText(result);

      expect(text).toContain('**Formula:** 3d6+4');
      expect(text).toContain('**Total:** 17');
      expect(text).toContain('**Reason:** Damage roll');
      expect(client.rollDice).toHaveBeenCalledWith('3d6+4', 'Damage roll');
    });
  });

  describe('edge cases', () => {
    it('propagates errors from the FoundryClient as an McpError', async () => {
      const client = {
        rollDice: vi.fn(async () => {
          throw new Error('Invalid formula');
        }),
      } as unknown as FoundryClient;

      await expect(handleRollDice({ formula: 'bogus' }, client)).rejects.toThrow();
    });
  });
});
