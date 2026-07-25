// FileSystemDirectoryHandle の永続化モジュール
// ハンドルはJSON化できないため localStorage は使えず、
// structured clone で保存できる IndexedDB を使用する。
// WASM(Rust)からは window.arcadeerStoreHandle / window.arcadeerLoadHandle 経由で呼び出す。

const DB_NAME = "arcadeer";
const DB_VERSION = 1;
const STORE = "handles";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** ハンドルを保存する（例: key = "home"） */
export async function storeHandle(key, handle) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 保存済みハンドルを取得する（未保存なら null） */
export async function loadHandle(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

window.arcadeerStoreHandle = storeHandle;
window.arcadeerLoadHandle = loadHandle;
