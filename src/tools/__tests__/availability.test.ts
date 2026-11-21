import { describe, expect, it } from 'vitest';
import {
  checkToolAvailability,
  getAvailableTools,
  isToolAvailable,
  type ToolAvailability,
} from '../availability.js';
import { getAllTools } from '../definitions.js';

const socketReadOnly: ToolAvailability = { transport: 'socket', writeEnabled: false };
const socketWritable: ToolAvailability = { transport: 'socket', writeEnabled: true };
const restReadOnly: ToolAvailability = { transport: 'rest', writeEnabled: false };
const restWriteFlag: ToolAvailability = { transport: 'rest', writeEnabled: true };

const names = (availability: ToolAvailability): string[] =>
  getAvailableTools(availability).map((tool) => tool.name);

describe('MCP tool availability by transport', () => {
  it('classifies every tool exposed by getAllTools exactly once across the two modes', () => {
    const all = getAllTools().map((tool) => tool.name);
    const union = new Set([...names(socketWritable), ...names(restReadOnly)]);

    expect(all).toHaveLength(33);
    expect(new Set(all).size).toBe(all.length);
    expect(union).toEqual(new Set(all));
  });

  it('shows socket world reads and local helpers but hides writes when disabled', () => {
    const available = names(socketReadOnly);
    expect(available).toHaveLength(18);
    expect(available).toContain('search_world');
    expect(available).toContain('search_journals');
    expect(available).toContain('get_combat_state');
    expect(available).toContain('get_health_status');
    expect(available).toContain('roll_dice');
    expect(available).not.toContain('move_token');
    expect(available).not.toContain('end_combat');
    expect(available).not.toContain('search_compendium');
    expect(available).not.toContain('get_recent_logs');
  });

  it('shows the 11 mutating tools only with Socket.IO write opt-in', () => {
    const available = names(socketWritable);
    expect(available).toHaveLength(29);
    for (const toolName of [
      'update_actor_attributes',
      'create_actor_item',
      'update_actor_item',
      'delete_actor_item',
      'create_journal_entry',
      'start_combat',
      'next_turn',
      'end_combat',
      'set_initiative',
      'move_token',
      'apply_status_effect',
    ]) {
      expect(available).toContain(toolName);
      expect(names(socketReadOnly)).not.toContain(toolName);
      expect(names(restWriteFlag)).not.toContain(toolName);
    }
  });

  it('exposes REST-only compendium and diagnostics without socket-only tools', () => {
    const available = names(restReadOnly);
    expect(available).toHaveLength(14);
    for (const toolName of [
      'search_compendium',
      'get_recent_logs',
      'search_logs',
      'get_system_health',
      'search_actors',
      'get_actor_details',
      'search_items',
      'get_scene_info',
      'roll_dice',
      'get_health_status',
    ]) {
      expect(available).toContain(toolName);
    }
    for (const toolName of [
      'search_world',
      'get_world_summary',
      'refresh_world_data',
      'get_combat_state',
      'get_chat_messages',
      'get_users',
      'search_journals',
      'get_journal',
      'move_token',
    ]) {
      expect(available).not.toContain(toolName);
    }
  });

  it('ignores FOUNDRY_WRITE_ENABLED in REST mode because writes need Socket.IO', () => {
    expect(names(restWriteFlag)).toEqual(names(restReadOnly));
  });

  it('preserves original tool definitions, order and input schemas when filtering', () => {
    const source = getAllTools();
    const expected = source.filter((tool) => isToolAvailable(tool.name, socketWritable));
    expect(getAvailableTools(socketWritable)).toEqual(expected);
  });

  it('does not expose unclassified tool names', () => {
    expect(isToolAvailable('future_unreviewed_tool', socketWritable)).toBe(false);
    expect(isToolAvailable('future_unreviewed_tool', restReadOnly)).toBe(false);
  });
});

describe('CallTool availability gate', () => {
  it('allows a shared tool in every mode', () => {
    expect(checkToolAvailability('roll_dice', socketReadOnly).status).toBe('available');
    expect(checkToolAvailability('roll_dice', restReadOnly).status).toBe('available');
  });

  it('returns unknown for a name absent from the table so the router keeps "Unknown tool"', () => {
    expect(checkToolAvailability('no_such_tool', socketWritable)).toEqual({ status: 'unknown' });
    expect(checkToolAvailability('no_such_tool', restReadOnly)).toEqual({ status: 'unknown' });
  });

  it('names writes-disabled as the reason for a write tool with the opt-in off', () => {
    const result = checkToolAvailability('move_token', socketReadOnly);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toContain('FOUNDRY_WRITE_ENABLED=true');
  });

  it('names REST mode as the reason for a write tool in REST mode', () => {
    const result = checkToolAvailability('move_token', restWriteFlag);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toContain('REST mode');
  });

  it('names Socket.IO mode as the reason for a REST-only tool over Socket.IO', () => {
    const result = checkToolAvailability('search_compendium', socketWritable);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toContain('Socket.IO mode');
  });

  it('names REST mode as the reason for a socket-only tool over REST', () => {
    const result = checkToolAvailability('search_world', restReadOnly);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toContain('REST mode');
  });

  it('allows a write tool only with Socket.IO transport and the write opt-in', () => {
    expect(checkToolAvailability('move_token', socketWritable).status).toBe('available');
  });
});
