// FileSystemDirectoryHandle の永続化モジュール
// ハンドルはJSON化できないため localStorage は使えず、
// structured clone で保存できる IndexedDB を使用する。
// WASM(Rust)からは window.arcadeerStoreHandle / window.arcadeerLoadHandle 経由で呼び出す。
//
// データベースの開き方は idb.js が受け持つ（下書きと同じ入れ物を使うため）。

import { STORE_HANDLES, get, put } from "./idb.js";

/** ハンドルを保存する（例: key = "home"） */
export async function storeHandle(key, handle) {
  await put(STORE_HANDLES, key, handle);
}

/** 保存済みハンドルを取得する（未保存なら null） */
export async function loadHandle(key) {
  return get(STORE_HANDLES, key);
}

window.arcadeerStoreHandle = storeHandle;
window.arcadeerLoadHandle = loadHandle;
