import { AsyncLocalStorage } from 'node:async_hooks';
import { ProviderError } from './errors.js';

/**
 * One application operation, including continuations inside provider methods.
 * Transport helpers check it immediately before sending. Direct legacy client
 * consumers have no context and retain their existing call signatures.
 */
export class ProviderOperationContext {
  private active = true;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly checkCurrent: () => void) {}

  assertCurrent(): void {
    if (!this.active) {
      throw new ProviderError('session_changed', 'The operation is no longer active');
    }
    this.checkCurrent();
  }

  /** Stop future sends, including callbacks outliving their public result. */
  finish(): void {
    this.active = false;
  }

  /** Track the actual provider request, never its cancellable public wrapper. */
  track<T>(request: Promise<T>): Promise<T> {
    this.pending.add(request);
    const remove = () => {
      this.pending.delete(request);
    };
    void request.then(remove, remove);
    return request;
  }

  /** Keep ordinary target work serialized until local in-flight work settles. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}

const currentOperation = new AsyncLocalStorage<ProviderOperationContext | undefined>();

export function captureOperationContext(): ProviderOperationContext | undefined {
  return currentOperation.getStore();
}

export function withOperationContext<T>(
  context: ProviderOperationContext | undefined,
  operation: () => T,
): T {
  return currentOperation.run(context, operation);
}

export function assertOperationCurrent(): void {
  currentOperation.getStore()?.assertCurrent();
}

export function trackOperation<T>(request: Promise<T>): Promise<T> {
  return currentOperation.getStore()?.track(request) ?? request;
}
