// アセット選択モジュール
// 左ペインのタブ種別に応じてファイルタイプで絞り込んだファイル選択画面を表示する。
// WASM(Rust)からは window.arcadeerPickAssets(tabKey) 経由で呼び出す。

import { t } from "./i18n.js";

/**
 * タブ種別ごとの選択可能なファイルタイプ
 * 左ペインのタブ（listing.rs の ResourceKind）と対象拡張子を一致させること。
 */
const FILE_TYPES = {
  "pane.tab.image": {
    descriptionKey: "pane.tab.image",
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/gif": [".gif"],
      "image/webp": [".webp"],
      "image/bmp": [".bmp"],
    },
  },
  "pane.tab.sound": {
    descriptionKey: "pane.tab.sound",
    // audio/mp4 は macOS の UTI 解釈で .mp4（動画）まで選べてしまうため使わない。
    // 保存側（Rust）でも拡張子を再確認している。
    accept: {
      "audio/ogg": [".ogg"],
      "audio/wav": [".wav"],
      "audio/mpeg": [".mp3"],
      "audio/aac": [".aac", ".m4a"],
      "audio/flac": [".flac"],
    },
  },
  "pane.tab.model": {
    descriptionKey: "pane.tab.model",
    accept: {
      "model/gltf-binary": [".glb"],
      "model/gltf+json": [".gltf"],
    },
  },
};

/** そのタブがアセット追加に対応しているか */
export function supportsAssetPicker(tabKey) {
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, tabKey);
}

/**
 * ファイル選択画面を表示し、選択された File の配列を返す
 * キャンセル時は空配列を返す。
 */
export async function pickAssets(tabKey) {
  const spec = FILE_TYPES[tabKey];
  if (!spec) return [];
  if (typeof window.showOpenFilePicker !== "function") {
    throw new Error("msg.filePickerUnavailable");
  }

  let handles;
  try {
    handles = await window.showOpenFilePicker({
      multiple: true,
      excludeAcceptAllOption: true,
      types: [{ description: t(spec.descriptionKey), accept: spec.accept }],
    });
  } catch (err) {
    // 選択せずに閉じた場合は何も追加しない
    if (err?.name === "AbortError") return [];
    throw err;
  }

  return Promise.all(handles.map((handle) => handle.getFile()));
}

if (typeof window !== "undefined") {
  window.arcadeerPickAssets = pickAssets;
  window.arcadeerSupportsAssetPicker = supportsAssetPicker;
}
