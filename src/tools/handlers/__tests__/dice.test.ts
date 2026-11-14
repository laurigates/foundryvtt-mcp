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
  source: 'server' | 'local';
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
        source: 'server',
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
        source: 'server',
      });

      const result = await handleRollDice({ formula: '3d6+4', reason: 'Damage roll' }, client);
      const text = getText(result);

      expect(text).toContain('**Formula:** 3d6+4');
      expect(text).toContain('**Total:** 17');
      expect(text).toContain('**Reason:** Damage roll');
      expect(client.rollDice).toHaveBeenCalledWith('3d6+4', 'Damage roll');
    });
  });

  /**
   * Issue #254 — the caller has to be able to tell a FoundryVTT roll from one
   * this server made itself (the Socket.IO default, or a REST call that failed
   * and fell back).
   */
  describe('roll source (#254)', () => {
    const base = {
      formula: '1d20',
      total: 12,
      breakdown: '1d20: [12] = 12',
      timestamp: '2024-06-01T12:00:00.000Z',
    };

    it('says the roll was made locally, not by FoundryVTT, when source is "local"', async () => {
      const client = mockFoundryClient({ ...base, source: 'local' });

      const text = getText(await handleRollDice({ formula: '1d20' }, client));

      expect(text).toMatch(/\*\*Source:\*\* local/);
      expect(text).toContain('not FoundryVTT');
    });

    it('says FoundryVTT rolled it when source is "server"', async () => {
      const client = mockFoundryClient({ ...base, source: 'server' });

      const text = getText(await handleRollDice({ formula: '1d20' }, client));

      expect(text).toContain('**Source:** FoundryVTT server');
      expect(text).not.toMatch(/\*\*Source:\*\* local/);
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
