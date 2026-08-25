// IndexedDB の共通の入り口（仕様書4.11節）
//
// ハンドルと下書きで**同じデータベースを使う**。別々に開くと、
// 版の食い違いで片方が開けなくなるため、ここへまとめてある。

const DB_NAME = "arcadeer";
/** 版。**保管場所を増やしたら上げる** */
const DB_VERSION = 2;

/** 保管場所の名前 */
export const STORE_HANDLES = "handles";
export const STORE_DRAFTS = "drafts";

/** データベースを開く（必要なら保管場所を作る） */
export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // 既にあるものは作り直さない。中身を失わないため
      for (const name of [STORE_HANDLES, STORE_DRAFTS]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 1件読む（無ければ null） */
export async function get(store, key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** 1件書く */
export async function put(store, key, value) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 1件消す */
export async function del(store, key) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 全件を `{ key, value }` の配列で読む */
export async function entries(store) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const os = db.transaction(store, "readonly").objectStore(store);
      const keys = os.getAllKeys();
      const values = os.getAll();
      const tx = os.transaction;
      tx.oncomplete = () =>
        resolve(keys.result.map((key, i) => ({ key, value: values.result[i] })));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
