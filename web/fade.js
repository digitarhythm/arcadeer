// 表示／非表示の共通フェードモジュール（0.3秒）
// ダイアログ(<dialog>)と通常要素の両方に対応する。
// WASM(Rust)からは window.arcadeerFade* 経由で呼び出す。
// 対応するCSSクラス（style.css）: .fade-dialog / .fade-element / .fade-visible

const DURATION_MS = 300;

// クラス変更を確実にトランジションさせるための強制リフロー
function forceReflow(el) {
  void el.offsetWidth;
}

/** <dialog> をフェードインしながら showModal する */
export function fadeInDialog(dialog) {
  dialog.classList.add("fade-dialog");
  dialog.classList.remove("fade-visible");
  if (!dialog.open) dialog.showModal();
  forceReflow(dialog);
  dialog.classList.add("fade-visible");
  // Escキーによるキャンセルもフェードアウトさせる
  dialog.addEventListener(
    "cancel",
    (e) => {
      e.preventDefault();
      fadeOutDialog(dialog);
    },
    { once: true },
  );
}

/** <dialog> をフェードアウトしてから close する */
export function fadeOutDialog(dialog) {
  dialog.classList.add("fade-dialog");
  forceReflow(dialog);
  dialog.classList.remove("fade-visible");
  setTimeout(() => dialog.close(), DURATION_MS);
}

/** 要素をフェードイン表示する */
export function fadeInElement(el) {
  el.classList.add("fade-element");
  el.classList.remove("fade-visible");
  forceReflow(el);
  el.classList.add("fade-visible");
}

/** 要素をフェードアウトする（完了を Promise で返す） */
export function fadeOutElement(el) {
  el.classList.add("fade-element", "fade-visible");
  forceReflow(el);
  el.classList.remove("fade-visible");
  return new Promise((resolve) => setTimeout(resolve, DURATION_MS));
}

/** 要素をフェードアウトしてから中身を空にする（完了を Promise で返す） */
export function fadeOutAndClear(el) {
  return fadeOutElement(el).then(() => {
    el.innerHTML = "";
    // 次の表示に備えて可視状態へ戻しておく（中身が無いので見た目は変わらない）
    el.classList.add("fade-visible");
  });
}

// WASMから呼べるようグローバルへ公開する
window.arcadeerFadeInDialog = fadeInDialog;
window.arcadeerFadeOutDialog = fadeOutDialog;
window.arcadeerFadeInElement = fadeInElement;
window.arcadeerFadeOutElement = fadeOutElement;
window.arcadeerFadeOutAndClear = fadeOutAndClear;
