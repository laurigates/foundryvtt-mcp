/**
 * @fileoverview Unit tests for chat handler — get_chat_messages limit clamp
 */

import { describe, expect, it, vi } from 'vitest';
import type { FoundryClient } from '../../../foundry/client.js';
import { handleGetChatMessages } from '../chat.js';

interface MockChatMessage {
  _id: string;
  content: string;
  user: string;
  timestamp: number;
  speaker?: { alias?: string };
}

function buildMessages(count: number): MockChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `msg-${i}`,
    content: `message ${i}`,
    user: 'user-1',
    timestamp: Date.UTC(2024, 0, 1, 0, 0, i),
    speaker: { alias: `speaker-${i}` },
  }));
}

function mockFoundryClient(allMessages: MockChatMessage[]): FoundryClient {
  return {
    getChatMessages: vi.fn((limit: number) => allMessages.slice(0, limit)),
    getUsers: vi.fn(() => ({ users: [{ _id: 'user-1', name: 'Alice' }] })),
  } as unknown as FoundryClient;
}

function countLines(result: Awaited<ReturnType<typeof handleGetChatMessages>>): number {
  const text =
    (result as { content: Array<{ type: string; text: string }> }).content[0]?.text ?? '';
  // Header line is "**Recent Chat Messages** (N)\n\n<lines>"; count message lines after the header
  const body = text.split('\n\n').slice(1).join('\n\n').trim();
  if (body === '' || text.includes('No chat messages found.')) {
    return 0;
  }
  return body.split('\n').filter(Boolean).length;
}

describe('handleGetChatMessages — limit clamp', () => {
  it('clamps limit at 100 when caller requests 500', async () => {
    const client = mockFoundryClient(buildMessages(1000));
    const result = await handleGetChatMessages({ limit: 500 }, client);
    expect(countLines(result)).toBeLessThanOrEqual(100);
    // Verify the clamped value was passed to the client, not the raw 500
    expect(client.getChatMessages).toHaveBeenCalledWith(100);
  });

  it('clamps limit at 100 when caller requests 10000', async () => {
    const client = mockFoundryClient(buildMessages(1000));
    await handleGetChatMessages({ limit: 10_000 }, client);
    expect(client.getChatMessages).toHaveBeenCalledWith(100);
  });

  it('uses default limit of 20 when no limit supplied', async () => {
    const client = mockFoundryClient(buildMessages(50));
    const result = await handleGetChatMessages({}, client);
    expect(countLines(result)).toBeLessThanOrEqual(20);
    expect(client.getChatMessages).toHaveBeenCalledWith(20);
  });

  it('passes through small limits unchanged', async () => {
    const client = mockFoundryClient(buildMessages(50));
    await handleGetChatMessages({ limit: 5 }, client);
    expect(client.getChatMessages).toHaveBeenCalledWith(5);
  });
});
