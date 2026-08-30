// アセットの対応表の編集画面（仕様書5.7節）
//
// 左ペインのアイコン列から開く。メイン部へ一覧を出し、
// ファイル名に対するキー名をその場で書き換えられるようにする。
//
// 読み書きの決まりは asset-map.js が持つ。ここは見た目と操作だけを受け持つ。

import { t } from "./i18n.js";
import {
  ASSET_KINDS,
  parseAssetMap,
  serializeAssetMap,
  mergeFiles,
  duplicateKeys,
  validateKey,
} from "./asset-map.js";

/** 種別ごとの見出し（左ペインのタブと同じ文言を使う） */
const KIND_LABEL = {
  images: "pane.tab.image",
  sounds: "pane.tab.sound",
  models: "pane.tab.model",
};

/** いま編集している対応表 */
let current = null;

/** 画面の要素をまとめて作る */
function buildPane(main) {
  main.innerHTML = `
    <div class="assetmap-pane">
      <div class="assetmap-header">
        <span class="assetmap-title" id="assetmap-title"></span>
        <span class="assetmap-note" id="assetmap-note"></span>
      </div>
      <div class="assetmap-body" id="assetmap-body"></div>
    </div>
  `;
  document.getElementById("assetmap-title").textContent = t("assetMap.title");
  document.getElementById("assetmap-note").textContent = t("assetMap.note");
}

/** 1つの種別ぶんの表を作る */
function buildTable(kind) {
  const entries = Object.entries(current[kind]).sort((a, b) => a[1].localeCompare(b[1]));

  const section = document.createElement("section");
  section.className = "assetmap-section";

  const heading = document.createElement("h3");
  heading.className = "assetmap-kind";
  heading.textContent = t(KIND_LABEL[kind]);
  section.appendChild(heading);

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "assetmap-empty";
    empty.textContent = t("assetMap.noFiles");
    section.appendChild(empty);
    return section;
  }

  const table = document.createElement("table");
  table.className = "assetmap-table";
  table.innerHTML = `
    <thead>
      <tr><th class="assetmap-col-file"></th><th class="assetmap-col-key"></th></tr>
    </thead>
    <tbody></tbody>
  `;
  table.querySelector(".assetmap-col-file").textContent = t("assetMap.file");
  table.querySelector(".assetmap-col-key").textContent = t("assetMap.key");

  const tbody = table.querySelector("tbody");
  for (const [key, file] of entries) {
    const row = document.createElement("tr");

    const fileCell = document.createElement("td");
    fileCell.className = "assetmap-file";
    fileCell.textContent = file;
    row.appendChild(fileCell);

    const keyCell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.className = "assetmap-input";
    input.value = key;
    input.spellcheck = false;
    input.dataset.kind = kind;
    input.dataset.file = file;
    input.dataset.key = key;
    input.addEventListener("change", () => applyKey(input));
    keyCell.appendChild(input);
    row.appendChild(keyCell);

    tbody.appendChild(row);
  }
  section.appendChild(table);
  return section;
}

/** 知らせを出す（問題があれば赤くする） */
function notify(message, isError) {
  const note = document.getElementById("assetmap-note");
  if (!note) return;
  note.textContent = message;
  note.classList.toggle("assetmap-error", isError === true);
}

/**
 * 入力されたキー名を反映する
 *
 * 使えない名前や重複はその場で知らせ、**保存しない**。
 * 直前の名前へ戻し、書きかけのまま保存されるのを防ぐ。
 */
function applyKey(input) {
  const { kind, file, key: before } = input.dataset;
  const after = input.value.trim();
  if (after === before) return;

  const problem = validateKey(after);
  if (problem) {
    notify(t(`assetMap.${problem}`), true);
    input.value = before;
    return;
  }

  const next = { ...current, [kind]: { ...current[kind] } };
  delete next[kind][before];
  next[kind][after] = file;

  if (duplicateKeys(next).includes(after)) {
    notify(t("assetMap.duplicate"), true);
    input.value = before;
    return;
  }

  current = next;
  input.dataset.key = after;
  save();
}

/** いまの対応表を書き出す */
function save() {
  const text = serializeAssetMap(current);
  const done = window.arcadeerSaveAssetMap?.(text);
  notify(t("assetMap.saved"), false);
  return done;
}

/**
 * 対応表の編集画面を開く
 *
 * @param files 種別ごとのファイル名（`{ images: [...], sounds: [...], models: [...] }`）
 * @param toml 保存されている `assets.toml`（無ければ空文字）
 */
export function showAssetMap(files, toml) {
  const main = document.getElementById("ide-content");
  if (!main) return;

  const merged = mergeFiles(parseAssetMap(toml), files ?? {});
  const changed = serializeAssetMap(merged) !== serializeAssetMap(parseAssetMap(toml));
  current = merged;

  buildPane(main);
  const body = document.getElementById("assetmap-body");
  for (const kind of ASSET_KINDS) body.appendChild(buildTable(kind));

  // 追加されたファイルに仮のキー名を付けた場合は、その場で残す
  if (changed) save();

  window.arcadeerFadeInElement?.(main);
}

if (typeof window !== "undefined") {
  window.arcadeerShowAssetMap = showAssetMap;
}
