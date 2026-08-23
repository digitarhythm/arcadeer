// 音声プレビュー再生モジュール
// 左ペインの音声タブに置かれた再生ボタンを処理する。
// 対象ボタンは Rust 側が data-url（object URL）を設定する。

import { t } from "./i18n.js";

const PLAY_ICON = `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" /></svg>`;
const STOP_ICON = `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>`;

/** 再生中の <audio>。同時に鳴らすのは1つだけにする */
let audio = null;
/** 再生中のボタン */
let activeButton = null;

/** ボタンの見た目を再生／停止で切り替える */
function setButtonState(button, playing) {
  button.innerHTML = playing ? STOP_ICON : PLAY_ICON;
  const label = t(playing ? "audio.stop" : "audio.play");
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.classList.toggle("audio-playing", playing);
}

/** 再生を止めて状態を戻す */
export function stopAudio() {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio = null;
  }
  if (activeButton) {
    setButtonState(activeButton, false);
    activeButton = null;
  }
}

/** 指定ボタンの音声を再生する（再生中の同じボタンなら停止） */
function toggleAudio(button) {
  const url = button.getAttribute("data-url");
  if (!url) return;

  const wasActive = activeButton === button;
  stopAudio();
  if (wasActive) return;

  audio = new Audio(url);
  activeButton = button;
  setButtonState(button, true);
  audio.addEventListener("ended", stopAudio);
  audio.addEventListener("error", stopAudio);
  audio.play().catch(stopAudio);
}

/** 再生ボタンの初期表示を整える（Rustがカードを作った直後に呼ぶ） */
export function initPlayButton(button) {
  setButtonState(button, false);
}

if (typeof window !== "undefined") {
  window.arcadeerStopAudio = stopAudio;
  window.arcadeerInitPlayButton = initPlayButton;

  // カードは再描画のたびに作り直されるため、イベントは委譲で受ける
  document.addEventListener("click", (e) => {
    const button = e.target.closest?.(".audio-play-btn");
    if (button) {
      toggleAudio(button);
      return;
    }
    // 再生ボタン以外がクリックされたら再生を止める
    stopAudio();
  });

  // Escキーでも再生を止める
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") stopAudio();
  });
  // 表示言語が変わったらツールチップを付け直す
  window.addEventListener("arcadeer:languagechange", () => {
    for (const button of document.querySelectorAll(".audio-play-btn")) {
      setButtonState(button, button === activeButton);
    }
  });
}
