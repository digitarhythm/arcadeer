// ゲーム起動時のバナー表示（仕様書 4.14節）
//
// 実行のたびに「ARCADEER」のバナーをフェードイン→表示→フェードアウトする。
// モバイルブラウザでは、バナーの後に「画面をタップしてください」を出してタップを待ち、
// その操作で音を鳴らせる状態にしてから（audio.js）ゲームを始める。
// 音の解放にはブラウザが利用者の操作を要求するため、起動の流れに自然に組み込む。
//
// 時間待ちと音の解放は差し替えられる（テストで実時間を待たない）。
import { unlockAudio } from "./audio.js";

/** 各段階の長さ（ミリ秒） */
export const SPLASH_TIMING = Object.freeze({ fadeIn: 500, hold: 1000, fadeOut: 500 });

/** バナー画像 */
export const BANNER_SRC = "./icons/banner.png";

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

/**
 * モバイルブラウザかどうか
 *
 * UA で判定するが、iPadOS の Safari は Mac を名乗るため、
 * Mac でタッチ点が2つ以上あればモバイルとみなす。
 */
export function isMobileBrowser(env = defaultEnv()) {
  const ua = env?.userAgent ?? "";
  const touches = env?.maxTouchPoints ?? 0;
  if (MOBILE_UA.test(ua)) return true;
  return /Macintosh/.test(ua) && touches > 1;
}

function defaultEnv() {
  if (typeof navigator === "undefined") return {};
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
}

const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 表示中の画面（同時に1つだけ） */
let current = null;

function forceReflow(el) {
  void el.offsetWidth;
}

/** 画面を組み立てる */
function build(container, t) {
  const doc = container.ownerDocument;
  const overlay = doc.createElement("div");
  overlay.classList.add("game-splash");

  const banner = doc.createElement("img");
  banner.classList.add("game-splash-banner");
  banner.setAttribute("src", BANNER_SRC);
  banner.setAttribute("alt", "ARCADEER");
  banner.setAttribute("draggable", "false");

  const tap = doc.createElement("p");
  tap.classList.add("game-splash-tap");
  tap.textContent = t("splash.tap");

  overlay.append(banner, tap);
  container.appendChild(overlay);
  return { overlay, banner, tap };
}

/**
 * バナーを表示し、終わったら解決する
 *
 * - `mobile` が true ならタップを待ち、タップで `unlock` を呼ぶ
 * - 途中で `cancelSplash()` されると画面を片付け `{ done: false }` で解決する
 * - 表示中にもう一度呼ぶと、前の画面を片付けて新しい画面だけにする
 *
 * @returns {Promise<{done: boolean, tapped: boolean}>}
 */
export function runSplash(container, options = {}) {
  cancelSplash();

  const mobile = options.mobile ?? isMobileBrowser();
  const wait = options.wait ?? defaultWait;
  const unlock = options.unlock ?? unlockAudio;
  const t = options.t ?? ((key) => (typeof window !== "undefined" && window.arcadeerT ? window.arcadeerT(key) : key));

  const parts = build(container, t);
  const session = { parts, cancelled: false, finish: null };
  current = session;

  const done = new Promise((resolve) => {
    session.finish = (result) => {
      if (session.cancelled) return;
      session.cancelled = true;
      if (current === session) current = null;
      parts.overlay.remove();
      resolve(result);
    };
  });

  const alive = () => !session.cancelled;

  (async () => {
    const { overlay, banner, tap } = parts;

    // バナーのフェードイン
    forceReflow(banner);
    banner.classList.add("splash-visible");
    await wait(SPLASH_TIMING.fadeIn);
    if (!alive()) return;

    let tapped = false;
    if (mobile) {
      // 文言を出してタップを待つ。待っている間だけ画面がタップを受ける
      tap.classList.add("splash-visible");
      overlay.classList.add("splash-waiting");
      await new Promise((resolve) => {
        let handled = false;
        const onTap = (e) => {
          if (handled || !alive()) return;
          handled = true;
          e.preventDefault?.();
          overlay.removeEventListener("pointerdown", onTap);
          resolve();
        };
        overlay.addEventListener("pointerdown", onTap);
        session.onCancel = () => {
          overlay.removeEventListener("pointerdown", onTap);
          resolve();
        };
      });
      session.onCancel = null;
      if (!alive()) return;
      tapped = true;
      overlay.classList.remove("splash-waiting");
      await unlock();
      if (!alive()) return;
    } else {
      await wait(SPLASH_TIMING.hold);
      if (!alive()) return;
    }

    // バナーと文言をまとめてフェードアウト
    banner.classList.remove("splash-visible");
    tap.classList.remove("splash-visible");
    await wait(SPLASH_TIMING.fadeOut);
    if (!alive()) return;

    session.finish({ done: true, tapped });
  })().catch(() => session.finish({ done: false, tapped: false }));

  return done;
}

/** 表示中の画面を即座に片付ける（ゲーム停止時）。何も無ければ何もしない */
export function cancelSplash() {
  const session = current;
  if (!session) return;
  current = null;
  session.onCancel?.();
  session.finish({ done: false, tapped: false });
}

// WASM から呼べるようグローバルへ公開する
if (typeof window !== "undefined") {
  window.arcadeerRunSplash = () => {
    const container = document.getElementById("ide-game-body");
    if (!container) return Promise.resolve({ done: true, tapped: false });
    return runSplash(container);
  };
  window.arcadeerCancelSplash = cancelSplash;
}
