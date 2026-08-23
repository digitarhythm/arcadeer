// フッターのログ表示と履歴（仕様書4.6節）
//
// フッターは通常1行だけを表示し、クリックすると10行ぶんへ広がって過去ログを見られる。
// ゲームコードからは `echo()` でデバッグログを書ける。
//
// 書式化と履歴はDOMに依存しないため、単体テストできる。

import { fadeInElement } from "./fade.js";

/**
 * 履歴として保持する行数の上限
 *
 * 開いた時にこの数だけ要素を作るため、増やしすぎると重くなる。
 */
export const MAX_LOG_LINES = 1000;

/** フッターが開いているときに body へ付くクラス */
const EXPANDED_CLASS = "footer-expanded";

/** 置き換えの目印 */
const PLACEHOLDER = "%@";

const lines = [];

/**
 * 値を表示用の文字列にする
 *
 * オブジェクトはJSONにする。循環参照などJSONにできないものは既定の文字列表現に落とす。
 */
function stringify(value) {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * `echo()` の書式を組み立てる
 *
 * - `%@` を引数で順に置き換える
 * - `%%` は `%` そのものにする
 * - 引数が足りない場合は `%@` をそのまま残す（書き間違いに気づけるように）
 * - 引数が余った場合は末尾へ空白区切りで並べる
 *
 * 置き換えた文字列の中に `%@` が含まれていても、再び置き換えの対象にはしない。
 */
export function formatEcho(format, ...args) {
  if (typeof format !== "string") {
    // 引数なしの呼び出しは空行として扱う
    if (format === undefined && args.length === 0) return "";
    return [format, ...args].map(stringify).join(" ");
  }

  const out = [];
  let used = 0;
  let i = 0;
  while (i < format.length) {
    if (format[i] === "%" && format[i + 1] === "%") {
      out.push("%");
      i += 2;
    } else if (format.startsWith(PLACEHOLDER, i)) {
      // 引数が残っていなければ目印をそのまま残す
      out.push(used < args.length ? stringify(args[used++]) : PLACEHOLDER);
      i += PLACEHOLDER.length;
    } else {
      out.push(format[i]);
      i += 1;
    }
  }

  const rest = args.slice(used).map(stringify);
  return [out.join(""), ...rest].join(" ");
}

/** 履歴へ1行積み、フッターの表示を更新する */
export function pushLog(text) {
  const line = stringify(text);
  lines.push(line);
  // 上限を超えたぶんは古いほうから捨てる
  if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
  render(line);
  return line;
}

/** 履歴の写しを返す（古い順） */
export function logLines() {
  return lines.slice();
}

/** 履歴を空にする */
export function clearLogs() {
  lines.length = 0;
  render(null);
}

/**
 * ゲームコードから使うデバッグログ
 *
 * ```coffee
 * echo "%@ と %@", @X, @Y
 * ```
 */
export function echo(format, ...args) {
  return pushLog(formatEcho(format, ...args));
}

/** 1行ぶんの要素を作る */
function lineElement(text) {
  const item = document.createElement("li");
  item.className = "footer-log-line";
  item.textContent = text;
  return item;
}

/** フッターが開いているか */
function isOpen() {
  return document.body?.classList.contains(EXPANDED_CLASS) === true;
}

/**
 * 履歴一覧を、いまの履歴から作り直す
 *
 * フッターを開いたときに呼ぶ。閉じている間はDOMを触らないため、
 * `echo()` を毎フレーム呼んでも表示の更新が負担にならない。
 */
export function renderAllLogs() {
  if (typeof document === "undefined") return;
  const list = document.getElementById("footer-log");
  if (!list) return;

  const fragment = document.createDocumentFragment();
  for (const line of lines) fragment.appendChild(lineElement(line));
  list.textContent = "";
  list.appendChild(fragment);
  list.scrollTop = list.scrollHeight;
}

/** 履歴一覧のDOMを空にする（閉じたときに呼ぶ） */
export function clearLogView() {
  if (typeof document === "undefined") return;
  const list = document.getElementById("footer-log");
  if (list) list.textContent = "";
}

/**
 * ゲームコードから使う、ログの消去
 *
 * ```coffee
 * logClear()
 * ```
 *
 * 履歴とフッターの1行表示の両方を空にする。
 */
export function logClear() {
  clearLogs();
}

/** フッターの1行表示と履歴一覧を書き換える */
function render(latest) {
  if (typeof document === "undefined") return;

  const current = document.getElementById("footer-console");
  if (current) {
    current.textContent = latest ?? "";
    if (latest !== null) fadeInElement(current);
  }

  const list = document.getElementById("footer-log");
  if (!list) return;
  if (latest === null) {
    list.textContent = "";
    return;
  }
  // 閉じている間はDOMを作らない。開いたときに作り直す
  if (!isOpen()) return;

  list.appendChild(lineElement(latest));
  // 上限を超えたぶんを表示からも取り除く
  while (list.childElementCount > MAX_LOG_LINES) list.removeChild(list.firstElementChild);
  // 常に最新行が見えるようにする
  list.scrollTop = list.scrollHeight;
}

if (typeof window !== "undefined") {
  // WASM(Rust)からのログもここを通す
  window.arcadeerLog = pushLog;
  window.arcadeerClearLogs = clearLogs;
}
