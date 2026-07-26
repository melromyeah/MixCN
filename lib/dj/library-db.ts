import type { StoredTrack } from "./types"

/**
 * Tiny promisified IndexedDB wrapper for the track library. Stores the
 * original encoded file bytes plus all analysis results, so tracks
 * survive reloads without re-analyzing; audio is re-decoded on demand.
 */

const DB_NAME = "mixcn"
const DB_VERSION = 1
const STORE = "tracks"

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "id" })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadStoredTracks(): Promise<StoredTrack[]> {
  try {
    const db = await openDb()
    const rows = await request(db.transaction(STORE, "readonly").objectStore(STORE).getAll())
    return (rows as StoredTrack[]).sort((a, b) => a.addedAt - b.addedAt)
  } catch {
    return []
  }
}

export async function saveStoredTrack(entry: StoredTrack): Promise<boolean> {
  try {
    const db = await openDb()
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(entry))
    return true
  } catch {
    // Quota exceeded or private-browsing restrictions — the session
    // still works, the track just won't survive a reload.
    return false
  }
}

export async function deleteStoredTrack(id: string): Promise<void> {
  try {
    const db = await openDb()
    await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id))
  } catch {
    // ignore
  }
}
