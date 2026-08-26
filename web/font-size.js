// エディタの文字サイズ設定モジュール（仕様書4.12節）
//
// コードを書く領域の文字の大きさを変え、選択内容をブラウザへ保存する。
// 対象は**エディタだけ**で、一覧やフッターの大きさは変わらない。

/** 指定できる大きさの範囲（px） */
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 255;

/** 既定の大きさ（これまで直書きしていた値） */
export const DEFAULT_FONT_SIZE = 13;

/** 選択内容の保存先 */
const STORAGE_KEY = "arcadeer.fontSize";

/**
 * 設定値を整える。数として読めなければ null を返す
 *
 * 範囲の外は**近いほうの端へ寄せる**。保存値が壊れていた場合に、
 * 既定へ戻すより意図に近いことが多いため。小数は四捨五入する。
 */
export function normalizeFontSize(value) {
  // 空文字は「未設定」。Number("") は 0 になってしまうため、先に外す
  if (typeof value === "string" && value.trim() === "") return null;
  const size = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof size !== "number" || !Number.isFinite(size)) return null;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

/** 保存値から使用する大きさを決める。未保存・読めない値なら既定へ戻す */
export function resolveFontSize(stored) {
  return normalizeFontSize(stored) ?? DEFAULT_FONT_SIZE;
}

/** Ace の `fontSize` へ渡す値にする */
export function aceFontSize(size) {
  return `${resolveFontSize(size)}px`;
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

/** 現在の文字サイズを返す */
export function getFontSize() {
  return resolveFontSize(readStored());
}

/** 文字サイズを保存し、エディタへ反映を促す */
export function setFontSize(value) {
  const size = resolveFontSize(value);
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // 保存できない場合は今回のセッションのみ有効になる
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("arcadeer:fontsizechange", { detail: { size } }));
  }
  return size;
}

if (typeof window !== "undefined") {
  window.arcadeerGetFontSize = getFontSize;
  window.arcadeerSetFontSize = setFontSize;
}
