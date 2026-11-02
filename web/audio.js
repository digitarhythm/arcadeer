// 音の土台（共有の AudioContext）
//
// ブラウザは利用者の操作（タップ／クリック）があるまで音を鳴らせない。
// 起動時のバナー画面（splash.js）でのタップを受けて共有の AudioContext を動かし、
// 以降の音の再生はすべてこの1つを使う。
//
// テストから偽の AudioContext へ差し替えられるよう、クラスは外から与えられる。

let contextClass = typeof window !== "undefined"
  ? (window.AudioContext ?? window.webkitAudioContext ?? null)
  : null;
let shared = null;

/** 使う AudioContext のクラスを差し替える（テスト用。null で「非対応」を表す） */
export function setAudioContextClass(cls) {
  contextClass = cls ?? null;
}

/** 共有の AudioContext を捨てる（テスト用） */
export function resetAudio() {
  shared = null;
}

/**
 * 共有の AudioContext を返す
 *
 * 最初に求められた時に1つだけ作る。Web Audio に対応していなければ null。
 */
export function audioContext() {
  if (shared) return shared;
  if (!contextClass) return null;
  try {
    shared = new contextClass();
  } catch {
    shared = null;
  }
  return shared;
}

/**
 * 音を鳴らせる状態にする（利用者の操作の中から呼ぶ）
 *
 * 止まっていれば resume する。鳴らせる状態になれば true。
 * 失敗しても例外を外へ出さない（起動の流れを止めないため）。
 */
export async function unlockAudio() {
  const ctx = audioContext();
  if (!ctx) return false;
  if (ctx.state === "running") return true;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  return ctx.state === "running";
}

// WASM から呼べるようグローバルへ公開する
if (typeof window !== "undefined") {
  window.arcadeerAudioContext = audioContext;
  window.arcadeerUnlockAudio = unlockAudio;
}
