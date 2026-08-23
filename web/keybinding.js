// エディタのキーバインド設定モジュール
// 通常キーバインドと vim キーバインドを切り替え、選択内容をブラウザへ保存する。

/** 対応するキーバインド（表示順） */
export const SUPPORTED_KEYBINDINGS = ["default", "vim"];

/** 既定のキーバインド */
export const DEFAULT_KEYBINDING = "default";

/** 選択内容の保存先 */
const STORAGE_KEY = "arcadeer.keybinding";

/** 設定値を正規化する。未対応なら null を返す */
export function normalizeKeybinding(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_KEYBINDINGS.includes(normalized) ? normalized : null;
}

/** 保存値から使用するキーバインドを決める。未保存・不正なら既定へ戻す */
export function resolveKeybinding(stored) {
  return normalizeKeybinding(stored) ?? DEFAULT_KEYBINDING;
}

/**
 * Ace の setKeyboardHandler へ渡す値を返す
 * 通常キーバインドはハンドラ無し（null）で表す。
 */
export function aceHandlerFor(keybinding) {
  return normalizeKeybinding(keybinding) === "vim" ? "ace/keyboard/vim" : null;
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

/** 現在のキーバインドを返す */
export function getKeybinding() {
  return resolveKeybinding(readStored());
}

/** キーバインドを保存し、エディタへ反映を促す */
export function setKeybinding(value) {
  const keybinding = resolveKeybinding(value);
  try {
    localStorage.setItem(STORAGE_KEY, keybinding);
  } catch {
    // 保存できない場合は今回のセッションのみ有効になる
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("arcadeer:keybindingchange", { detail: { keybinding } }),
    );
  }
  return keybinding;
}

if (typeof window !== "undefined") {
  window.arcadeerGetKeybinding = getKeybinding;
  window.arcadeerSetKeybinding = setKeybinding;
}
