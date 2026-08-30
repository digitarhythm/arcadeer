// アセットの対応表（仕様書5.7節）
//
// ゲームコードでは**キー名**でアセットを指す。ファイル名を直接書かないため、
// 差し替えは対応表の1行を直すだけで済む。
//
// ```coffee
// @MODEL = "cat"        # ファイル名ではなくキー名
// ```
//
// 対応表はプロジェクト直下の `assets.toml` に置く。
//
// ```toml
// [images]
// title = "title.png"
//
// [sounds]
// jump = "jump.wav"
//
// [models]
// cat = "default-cat.glb"
// ```
//
// 画面にもファイルにも依存しないため単体テストできる。

/** 扱う種別（表示順） */
export const ASSET_KINDS = ["images", "sounds", "models"];

/** キー名として認める形 */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 空の対応表 */
function emptyMap() {
  return { images: {}, sounds: {}, models: {} };
}

/**
 * ファイル名から仮のキー名を作る
 *
 * 追加したその場で使えるよう、拡張子を落として扱いやすい形へ整える。
 */
export function defaultKey(fileName) {
  const name = typeof fileName === "string" ? fileName : "";
  // 最後の拡張子だけを落とす（`boss.stage1.glb` は `boss.stage1` になる）。
  // 先頭のドットしか無い場合（`.png`）は、名前が無いものとして扱う
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : dot === 0 ? "" : name;
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (cleaned === "") return "asset";
  // 数字で始まると識別子として書きにくい
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * キー名を確かめる
 *
 * @returns 問題なければ null。`"empty"` / `"invalid"` のいずれかを返す
 */
export function validateKey(key) {
  const text = typeof key === "string" ? key.trim() : "";
  if (text === "") return "empty";
  return KEY_PATTERN.test(text) ? null : "invalid";
}

/**
 * `assets.toml` を読み取る
 *
 * 知らない種別や読めない行は読み飛ばす。壊れていても**必ず3種類の入れ物**を返し、
 * 対応表が無いだけで編集できなくなることを避ける。
 */
export function parseAssetMap(text) {
  const map = emptyMap();
  if (typeof text !== "string") return map;

  let kind = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      const name = section[1].trim();
      kind = ASSET_KINDS.includes(name) ? name : null;
      continue;
    }
    if (!kind) continue;

    const entry = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)')$/.exec(line);
    if (!entry) continue;
    map[kind][entry[1]] = entry[2] ?? entry[3] ?? "";
  }
  return map;
}

/** 対応表を `assets.toml` の文字列にする */
export function serializeAssetMap(map) {
  const lines = [];
  for (const kind of ASSET_KINDS) {
    lines.push(`[${kind}]`);
    // 差分を見やすくするため、キー名順で並べる
    for (const key of Object.keys(map?.[kind] ?? {}).sort()) {
      lines.push(`${key} = "${map[kind][key]}"`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 実際に置かれているファイルと突き合わせる
 *
 * - 対応表に無いファイルは、仮のキー名で足す
 * - 消えたファイルの行は落とす
 * - 既にあるキー名は変えない（遊ぶ人が付けた名前を勝手に書き換えない）
 */
export function mergeFiles(map, files) {
  const merged = emptyMap();
  const taken = new Set();

  for (const kind of ASSET_KINDS) {
    const list = files?.[kind] ?? [];
    const current = map?.[kind] ?? {};
    // 既にある行のうち、ファイルが残っているものだけを引き継ぐ
    for (const [key, file] of Object.entries(current)) {
      if (list.includes(file)) {
        merged[kind][key] = file;
        taken.add(key);
      }
    }
  }

  for (const kind of ASSET_KINDS) {
    for (const file of files?.[kind] ?? []) {
      if (Object.values(merged[kind]).includes(file)) continue;
      let key = defaultKey(file);
      // 同じ仮の名前が既にあれば、番号を足して避ける
      let n = 2;
      while (taken.has(key)) {
        key = `${defaultKey(file)}${n}`;
        n += 1;
      }
      merged[kind][key] = file;
      taken.add(key);
    }
  }
  return merged;
}

/**
 * 種別をまたいで重なっているキー名
 *
 * ゲームコードからは種別を書かずに引くため、**全体で一意**である必要がある。
 */
export function duplicateKeys(map) {
  const seen = new Set();
  const dup = new Set();
  for (const kind of ASSET_KINDS) {
    for (const key of Object.keys(map?.[kind] ?? {})) {
      if (seen.has(key)) dup.add(key);
      seen.add(key);
    }
  }
  return [...dup];
}

/**
 * キー名からファイル名を引く
 *
 * 登録が無ければ null。呼び出し側は、これまでどおりファイル名として扱えばよい。
 */
export function lookupFile(map, key) {
  if (typeof key !== "string" || key === "") return null;
  for (const kind of ASSET_KINDS) {
    const file = map?.[kind]?.[key];
    if (typeof file === "string" && file !== "") return file;
  }
  return null;
}
