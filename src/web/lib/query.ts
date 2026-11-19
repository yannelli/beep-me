import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./api";

interface Entry {
  data?: unknown;
  error?: unknown;
  loading: boolean;
  promise?: Promise<void>;
  listeners: Set<() => void>;
  snapshot: Snapshot<unknown>;
}

export interface Snapshot<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
}

const store = new Map<string, Entry>();

function entry(key: string): Entry {
  let found = store.get(key);
  if (!found) {
    found = { loading: false, listeners: new Set(), snapshot: { data: undefined, error: undefined, loading: false } };
    store.set(key, found);
  }
  return found;
}

function emit(item: Entry) {
  item.snapshot = { data: item.data, error: item.error, loading: item.loading };
  item.listeners.forEach((listener) => listener());
}

export function fetchQuery(key: string): Promise<void> {
  const item = entry(key);
  if (item.promise) return item.promise;
  item.loading = true;
  emit(item);
  item.promise = api
    .get<unknown>(key)
    .then(
      (data) => {
        item.data = data;
        item.error = undefined;
      },
      (error: unknown) => {
        item.error = error;
      },
    )
    .finally(() => {
      item.loading = false;
      item.promise = undefined;
      emit(item);
    });
  return item.promise;
}

export function setQueryData<T>(key: string, update: T | ((previous: T | undefined) => T)) {
  const item = entry(key);
  item.data = typeof update === "function" ? (update as (previous: T | undefined) => T)(item.data as T | undefined) : update;
  item.error = undefined;
  emit(item);
}

export function getQueryData<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

/** Refetches every cached key that starts with one of the prefixes. */
export function invalidate(...prefixes: string[]) {
  for (const key of store.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) void fetchQuery(key);
  }
}

const empty: Snapshot<never> = { data: undefined, error: undefined, loading: false };

export function useQuery<T>(key: string | null, options: { interval?: number } = {}) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => {};
      const item = entry(key);
      item.listeners.add(listener);
      return () => item.listeners.delete(listener);
    },
    [key],
  );
  const snapshot = useSyncExternalStore(subscribe, () => (key ? entry(key).snapshot : empty)) as Snapshot<T>;

  useEffect(() => {
    if (key) void fetchQuery(key);
  }, [key]);

  useInterval(() => {
    if (key && document.visibilityState === "visible") void fetchQuery(key);
  }, key ? options.interval : undefined);

  const refetch = useCallback(() => (key ? fetchQuery(key) : Promise.resolve()), [key]);
  return { ...snapshot, refetch };
}

export function useInterval(callback: () => void, ms: number | undefined) {
  const [saved] = useState(() => ({ current: callback }));
  saved.current = callback;
  useEffect(() => {
    if (!ms) return;
    const id = window.setInterval(() => saved.current(), ms);
    const onVisible = () => document.visibilityState === "visible" && saved.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, saved]);
}
