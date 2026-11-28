import type { TargetConfig } from '../config/targets.js';
import { createProvider } from '../providers/factory.js';
import type { FoundryProvider, ProviderConfig } from '../providers/types.js';
import {
  FoundrySession,
  SessionError,
  type SessionOptions,
  type SessionStatus,
} from './session.js';

export interface SessionManagerOptions extends SessionOptions {
  providerFactory?: (config: ProviderConfig) => FoundryProvider;
}

/** Routing depends on configured targets, never on whichever world happens to be online. */
export class FoundrySessionManager {
  private readonly sessions = new Map<string, FoundrySession>();

  constructor(targets: TargetConfig[], options: SessionManagerOptions = {}) {
    if (targets.length === 0) {
      throw new SessionError('no_targets', 'At least one Foundry target is required');
    }
    for (const target of targets) {
      if (this.sessions.has(target.id)) {
        throw new SessionError('duplicate_target', `Duplicate target ID: ${target.id}`);
      }
      const provider = (options.providerFactory ?? createProvider)(target.provider);
      this.sessions.set(target.id, new FoundrySession(target, provider, options));
    }
  }

  async start(): Promise<void> {
    // A failed world must not prevent the MCP endpoint or other worlds from starting.
    await Promise.allSettled([...this.sessions.values()].map((session) => session.start()));
  }

  resolve(targetId?: string): FoundrySession {
    if (targetId !== undefined) {
      const session = this.sessions.get(targetId);
      if (!session) {
        throw new SessionError('unknown_target', `Unknown target: ${targetId}`);
      }
      return session;
    }
    if (this.sessions.size !== 1) {
      throw new SessionError(
        'ambiguous_target',
        'target_id is required when more than one target is configured; use list_targets',
      );
    }
    const only = this.sessions.values().next().value;
    if (!only) {
      throw new SessionError('no_targets', 'No Foundry target is configured');
    }
    return only;
  }

  get(targetId: string): FoundrySession | undefined {
    return this.sessions.get(targetId);
  }
  all(): FoundrySession[] {
    return [...this.sessions.values()];
  }
  list(): SessionStatus[] {
    return this.all().map((session) => session.status());
  }
  async reconnect(targetId?: string): Promise<void> {
    await this.resolve(targetId).reconnect();
  }
  async refresh(targetId?: string): Promise<void> {
    await this.resolve(targetId).refresh();
  }
  async close(): Promise<void> {
    await Promise.allSettled(this.all().map((session) => session.close()));
  }
}
