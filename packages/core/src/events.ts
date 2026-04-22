import type { TypedEventEmitter } from "./types";

export class LumoraEventEmitter<TMap extends object> implements TypedEventEmitter<TMap> {
  private readonly listeners = new Map<keyof TMap, Set<(payload: unknown) => void>>();

  on<TKey extends keyof TMap>(event: TKey, listener: (payload: TMap[TKey]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(listener as (payload: unknown) => void);
    this.listeners.set(event, set);

    return () => {
      set.delete(listener as (payload: unknown) => void);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit<TKey extends keyof TMap>(event: TKey, payload: TMap[TKey]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(payload);
    }
  }
}
