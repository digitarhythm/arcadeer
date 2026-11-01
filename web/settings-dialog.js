// システム設定ダイアログモジュール
// フッター右端の設定ボタンから開き、表示言語を切り替える。
// 文言は i18n.js（web/locales/*.json）から取得する。

import { t, getLanguage, changeLanguage, SUPPORTED_LANGS, LANG_NAMES } from "./i18n.js";
import { SUPPORTED_KEYBINDINGS, getKeybinding, setKeybinding } from "./keybinding.js";
import { MIN_FONT_SIZE, MAX_FONT_SIZE, getFontSize, setFontSize } from "./font-size.js";
import { SUPPORTED_GAME_LAYOUTS, getGameLayout, setGameLayout } from "./game-layout.js";

let dialog = null;
let titleEl = null;
let languageLabelEl = null;
let selectEl = null;
let keybindingLabelEl = null;
let keybindingSelectEl = null;
let fontSizeLabelEl = null;
let fontSizeSelectEl = null;
let fontSizeValueEl = null;
let gameLayoutLabelEl = null;
let gameLayoutGroupEl = null;
let closeBtn = null;

/** ダイアログDOMを一度だけ生成し、以後は使い回す */
function ensureDialog() {
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "arcadeer-settings-dialog";
  dialog.className = "fade-dialog dialog-new-project";
  dialog.innerHTML = `
    <form method="dialog" class="dialog-form">
      <h2 data-settings-title></h2>
      <label for="settings-language" data-settings-language-label></label>
      <select id="settings-language" class="dialog-select"></select>
      <label for="settings-keybinding" data-settings-keybinding-label></label>
      <select id="settings-keybinding" class="dialog-select"></select>
      <label for="settings-fontsize" data-settings-fontsize-label></label>
      <div class="dialog-range-row">
        <input type="range" id="settings-fontsize" class="dialog-range"
               min="${MIN_FONT_SIZE}" max="${MAX_FONT_SIZE}" step="1">
        <output class="dialog-range-value" for="settings-fontsize" data-settings-fontsize-value></output>
      </div>
      <span class="dialog-label" data-settings-gamelayout-label></span>
      <div class="dialog-radio-group" role="radiogroup" data-settings-gamelayout></div>
      <div class="dialog-buttons">
        <button type="button" class="dialog-btn dialog-btn-primary" data-settings-close></button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);

  titleEl = dialog.querySelector("[data-settings-title]");
  languageLabelEl = dialog.querySelector("[data-settings-language-label]");
  selectEl = dialog.querySelector("#settings-language");
  keybindingLabelEl = dialog.querySelector("[data-settings-keybinding-label]");
  keybindingSelectEl = dialog.querySelector("#settings-keybinding");
  fontSizeLabelEl = dialog.querySelector("[data-settings-fontsize-label]");
  fontSizeSelectEl = dialog.querySelector("#settings-fontsize");
  fontSizeValueEl = dialog.querySelector("[data-settings-fontsize-value]");
  gameLayoutLabelEl = dialog.querySelector("[data-settings-gamelayout-label]");
  gameLayoutGroupEl = dialog.querySelector("[data-settings-gamelayout]");
  closeBtn = dialog.querySelector("[data-settings-close]");

  for (const tag of SUPPORTED_LANGS) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = LANG_NAMES[tag];
    selectEl.appendChild(option);
  }

  for (const keybinding of SUPPORTED_KEYBINDINGS) {
    const option = document.createElement("option");
    option.value = keybinding;
    keybindingSelectEl.appendChild(option);
  }

  // ゲーム画面の配置はラジオボタンで選ぶ（2択で、見比べて決めるものなので）
  for (const layout of SUPPORTED_GAME_LAYOUTS) {
    const label = document.createElement("label");
    label.className = "dialog-radio";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "settings-game-layout";
    radio.value = layout;
    radio.addEventListener("change", () => {
      if (radio.checked) setGameLayout(layout);
    });
    const text = document.createElement("span");
    text.dataset.gameLayoutText = layout;
    label.append(radio, text);
    gameLayoutGroupEl.appendChild(label);
  }

  // 選択した時点で即座に反映する（確定ボタンは設けない）
  selectEl.addEventListener("change", async () => {
    await changeLanguage(selectEl.value);
    applyTexts();
  });

  keybindingSelectEl.addEventListener("change", () => {
    setKeybinding(keybindingSelectEl.value);
  });

  // つまみを動かしている最中も反映する（大きさは見て決めるものなので）
  fontSizeSelectEl.addEventListener("input", () => {
    const size = setFontSize(fontSizeSelectEl.value);
    showFontSize(size);
  });

  closeBtn.addEventListener("click", () => window.arcadeerFadeOutDialog(dialog));

  return dialog;
}

/** つまみの横へ今の大きさを出す（数字なので翻訳は要らない） */
function showFontSize(size) {
  if (fontSizeValueEl) fontSizeValueEl.textContent = `${size} px`;
}

/** ダイアログ内の文言を現在の言語で入れ直す */
function applyTexts() {
  titleEl.textContent = t("settings.title");
  languageLabelEl.textContent = t("settings.language");
  keybindingLabelEl.textContent = t("settings.keybinding");
  fontSizeLabelEl.textContent = t("settings.fontSize");
  for (const option of keybindingSelectEl.options) {
    option.textContent = t(`keybinding.${option.value}`);
  }
  gameLayoutLabelEl.textContent = t("settings.gameLayout");
  for (const text of gameLayoutGroupEl.querySelectorAll("[data-game-layout-text]")) {
    text.textContent = t(`gameLayout.${text.dataset.gameLayoutText}`);
  }
  closeBtn.textContent = t("settings.close");
}

/** システム設定ダイアログを開く */
export function showSettings() {
  ensureDialog();
  selectEl.value = getLanguage();
  keybindingSelectEl.value = getKeybinding();
  const size = getFontSize();
  fontSizeSelectEl.value = String(size);
  showFontSize(size);
  const layout = getGameLayout();
  for (const radio of gameLayoutGroupEl.querySelectorAll("input[type=radio]")) {
    radio.checked = radio.value === layout;
  }
  applyTexts();
  window.arcadeerFadeInDialog(dialog);
}

// WASMや他モジュールから呼べるようグローバルへ公開する
if (typeof window !== "undefined") {
  window.arcadeerShowSettings = showSettings;
}
