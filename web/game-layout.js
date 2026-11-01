// ゲーム画面の配置設定モジュール（仕様書4.13節）
//
// ゲーム実行画面を「エディタの上に重ねる」か「エディタの右に並べる」かを選び、
// 選択内容をブラウザへ保存する。切り替えは body のクラスで行い、
// 見た目の違いは style.css が担う。ウィンドウの縦横比では切り替えない。

/** 対応する配置（表示順。既定を先に置く） */
export const SUPPORTED_GAME_LAYOUTS = ["overlay", "side"];

/** 既定の配置（エディタの上に重ねる） */
export const DEFAULT_GAME_LAYOUT = "overlay";

/** 選択内容の保存先 */
const STORAGE_KEY = "arcadeer.gameLayout";

/** body に付けるクラス名の接頭辞 */
const CLASS_PREFIX = "game-layout-";

/** body に付けるクラス（切り替え時に古い方を外すための一覧） */
export const GAME_LAYOUT_CLASSES = SUPPORTED_GAME_LAYOUTS.map((l) => CLASS_PREFIX + l);

/** 設定値を正規化する。未対応なら null を返す */
export function normalizeGameLayout(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_GAME_LAYOUTS.includes(normalized) ? normalized : null;
}

/** 保存値から使用する配置を決める。未保存・不正なら既定へ戻す */
export function resolveGameLayout(stored) {
  return normalizeGameLayout(stored) ?? DEFAULT_GAME_LAYOUT;
}

/** 配置に対応する body のクラス名を返す */
export function bodyClassFor(layout) {
  return CLASS_PREFIX + resolveGameLayout(layout);
}

// --- 以下はブラウザ専用 ---

/** 保存済みの選択を読む */
function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 現在の配置を返す */
export function getGameLayout() {
  return resolveGameLayout(readStored());
}

/** body のクラスを現在の配置に合わせる（起動時と切り替え時に呼ぶ） */
export function applyGameLayout(layout = getGameLayout()) {
  if (typeof document === "undefined") return;
  const list = document.body.classList;
  list.remove(...GAME_LAYOUT_CLASSES);
  list.add(bodyClassFor(layout));
}

/** 配置を保存し、画面へ反映する */
export function setGameLayout(value) {
  const layout = resolveGameLayout(value);
  try {
    localStorage.setItem(STORAGE_KEY, layout);
  } catch {
    // 保存できない場合は今回のセッションのみ有効になる
  }
  applyGameLayout(layout);
  if (typeof window !== "undefined") {
    // 表示領域の大きさが変わるため、WASM側は canvas を合わせ直す
    window.dispatchEvent(new CustomEvent("arcadeer:gamelayoutchange", { detail: { layout } }));
  }
  return layout;
}

if (typeof window !== "undefined") {
  window.arcadeerGetGameLayout = getGameLayout;
  window.arcadeerSetGameLayout = setGameLayout;
}
