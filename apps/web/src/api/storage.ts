import type { StoredPhoto } from "./types";

export interface KeyValue {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

export function browserOrMemoryStore(): KeyValue {
  const memory = new Map<string, string>();
  const ls = typeof window === "undefined" ? null : window.localStorage;
  return {
    get<T>(key: string): T | null {
      try {
        const raw = ls ? ls.getItem(key) : memory.get(key) ?? null;
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    },
    set(key: string, value: unknown) {
      const raw = JSON.stringify(value);
      try {
        if (ls) ls.setItem(key, raw);
        else memory.set(key, raw);
      } catch {
        memory.set(key, raw);
      }
    },
  };
}

export interface PhotoStore {
  put(envId: string, photos: StoredPhoto[]): Promise<void>;
  get(envId: string): Promise<StoredPhoto[]>;
}

const DB = "twin-studio";
const STORE = "photos";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function browserOrMemoryPhotos(): PhotoStore {
  const memory = new Map<string, StoredPhoto[]>();
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return { put: async (id, p) => void memory.set(id, p), get: async (id) => memory.get(id) ?? [] };
  }
  return {
    async put(envId, photos) {
      memory.set(envId, photos);
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(photos, envId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        return;
      }
    },
    async get(envId) {
      const cached = memory.get(envId);
      if (cached) return cached;
      try {
        const db = await openDb();
        return await new Promise<StoredPhoto[]>((resolve, reject) => {
          const req = db.transaction(STORE, "readonly").objectStore(STORE).get(envId);
          req.onsuccess = () => resolve((req.result as StoredPhoto[] | undefined) ?? []);
          req.onerror = () => reject(req.error);
        });
      } catch {
        return [];
      }
    },
  };
}
