// キーコンフィグの画面（仕様書6.2.10節）
//
// コントローラーの絵を出し、押してほしい箇所を光らせて順に尋ねる。
// 遊ぶ人が「XInput のこのボタンを、自分のパッドのどれに割り当てるか」を決める。
//
// 判定そのものは gamepad-config.js が持つ。ここは見た目と進行だけを受け持つ。

import { t } from "./i18n.js";
import { fadeInDialog, fadeOutDialog } from "./fade.js";
import {
  gamepadOption,
  parseGamepadId,
  setConfigLookup,
  setGamepadSuspended,
} from "./gamepad.js";
import {
  detectInput,
  isHatBinding,
  startConfig,
  stepsFor,
  recordStep,
  UNASSIGNED,
  buildLayoutFromConfig,
  saveGamepadConfig,
  loadGamepadConfig,
} from "./gamepad-config.js";

/**
 * 押しっぱなしで次々に進まないよう、**離すまで待つ**
 *
 * 時間で待つ作りにすると、長く押している間に何項目も進んでしまう。
 */
const WAIT_RELEASE = true;

let dialog = null;
let running = null;

/** いま繋がっている最初のパッドを返す */
function firstPad() {
  const list = typeof navigator?.getGamepads === "function" ? [...navigator.getGamepads()] : [];
  return list.find(Boolean) ?? null;
}

/** 画面を組み立てる（一度だけ） */
async function build() {
  const el = document.createElement("dialog");
  el.id = "gamepad-config-dialog";
  el.className = "padconf-dialog";

  const svg = await (await fetch("./icons/gamepad.svg")).text();
  el.innerHTML = `
    <div class="padconf-body">
      <h2 class="padconf-title" id="padconf-title"></h2>
      <p class="padconf-device" id="padconf-device"></p>
      <div class="padconf-figure" id="padconf-figure">${svg}</div>
      <p class="padconf-ask" id="padconf-ask"></p>
      <p class="padconf-hint" id="padconf-hint"></p>
      <p class="padconf-notice" id="padconf-notice" hidden></p>
      <div class="padconf-progress"><div class="padconf-bar" id="padconf-bar"></div></div>
      <p class="padconf-step" id="padconf-step"></p>
      <div class="padconf-buttons">
        <button type="button" class="padconf-btn" id="padconf-skip"></button>
        <button type="button" class="padconf-btn" id="padconf-restart"></button>
        <button type="button" class="padconf-btn padconf-cancel" id="padconf-cancel"></button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  dialog = el;

  el.querySelector("#padconf-skip").addEventListener("click", () => running?.skip());
  el.querySelector("#padconf-restart").addEventListener("click", () => running?.restart());
  el.querySelector("#padconf-cancel").addEventListener("click", () => running?.cancel());
  return el;
}

/** 向きごとの回転角（右を 0 度とする） */
const ARROW_ANGLE = { right: 0, down: 90, left: 180, up: 270 };

/**
 * 倒す向きを示す矢印を置く
 *
 * 「押す」と「倒す」で見た目が同じだと区別できないため、
 * 倒す手順では**その向きへ動く矢印**を重ねる。
 */
function showArrow(svg, marker, dir) {
  const old = svg.querySelector("#padconf-arrow");
  if (old) old.remove();
  if (!dir) return;

  const target = svg.querySelector(`#${marker}`);
  if (!target) return;
  const box = target.getBBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const radius = Math.max(box.width, box.height) / 2;

  const NS = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(NS, "g");
  g.id = "padconf-arrow";
  g.setAttribute("transform", `translate(${cx} ${cy}) rotate(${ARROW_ANGLE[dir] ?? 0})`);

  // 動かす部分は内側に置く（外側の回転を活かすため）
  const inner = document.createElementNS(NS, "g");
  inner.setAttribute("class", "padconf-arrow-inner");
  const path = document.createElementNS(NS, "path");
  const start = radius + 2;
  path.setAttribute("d", `M ${始点} 0 L ${始点 + 10} 0 M ${始点 + 6} -4 L ${始点 + 10} 0 L ${始点 + 6} 4`);
  inner.appendChild(path);
  g.appendChild(inner);
  svg.appendChild(g);
}

/** 押してほしい箇所を光らせる */
function highlight(marker, dir) {
  const figure = document.getElementById("padconf-figure");
  const svg = figure?.querySelector("svg");
  if (!svg) return;
  for (const el of svg.querySelectorAll(".padconf-target")) {
    el.classList.remove("padconf-target");
  }
  svg.querySelector(`#${marker}`)?.classList.add("padconf-target");
  showArrow(svg, marker, dir);
}

/** 自動で決まったことを知らせる（数秒で消す） */
let noticeTimer = null;
function notify(key) {
  const el = document.getElementById("padconf-notice");
  if (!el) return;
  el.textContent = t(key);
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

/** 表示を今の手順に合わせる */
function showStep(steps, index, device) {
  const step = steps[index];
  document.getElementById("padconf-title").textContent = t("padconf.title");
  document.getElementById("padconf-device").textContent = device;
  document.getElementById("padconf-ask").textContent = t(step.labelKey);
  document.getElementById("padconf-hint").textContent = t("padconf.hint");
  document.getElementById("padconf-step").textContent =
    t("padconf.progress", { done: String(index + 1), total: String(steps.length) });
  document.getElementById("padconf-bar").style.width =
    `${Math.round((index / steps.length) * 100)}%`;
  document.getElementById("padconf-skip").textContent = t("padconf.skip");
  document.getElementById("padconf-restart").textContent = t("padconf.restart");
  document.getElementById("padconf-cancel").textContent = t("padconf.cancel");
  highlight(step.marker, step.dir);
}

/**
 * キーコンフィグを開く
 *
 * @returns 作られた設定。中止した場合は null
 */
export async function openGamePadConfig() {
  if (running) return null;
  const raw = firstPad();
  if (!raw) {
    window.arcadeerShowMessage?.(t("padconf.noPad"), "warning");
    return null;
  }

  // ゲームが使う操作を申告していれば、その項目だけを尋ねる
  const steps = stepsFor(gamepadOption().use);
  if (steps.length === 0) {
    window.arcadeerShowMessage?.(t("padconf.nothing"), "warning");
    return null;
  }

  if (!dialog) await build();

  const { vendor, product } = parseGamepadId(raw.id);
  const key = vendor && product ? `${vendor}:${product}` : raw.id;
  const deviceName = raw.id.replace(/\s*\(Vendor.*$/, "");
  // 尋ねない項目の割り当てを失わないよう、保存済みを引き継ぐ
  const saved = loadGamepadConfig(key, location.href);
  let config = startConfig(deviceName, key, saved, steps);

  /**
   * 何もしていない時の値
   *
   * **項目ごとに取り直す。**触るまで嘘の値を返す軸を持つ機種があり、
   * 最初に一度だけ取ると、その後ずっと「倒している」と誤認してしまう。
   */
  let rest = [...raw.axes];

  let index = 0;
  // 手を離した状態を確かめてから受け付ける（押しっぱなしで進まないように）
  let waitRelease = true;

  return new Promise((resolve) => {
    /**
     * 画面が閉じられたら、中止として片付ける
     *
     * ESCキーとダイアログ外クリックは、こちらに何も知らせずに閉じる。
     * 片付けずにいると進行中の状態が残り、**次から画面が出なくなる**うえ、
     * 見えないまま入力を受け付け続けてしまう。
     */
    const onClose = () => running?.cancel();

    const finish = (result) => {
      clearInterval(timer);
      running = null;
      dialog.removeEventListener("close", onClose);
      // 設定が終わったので、操作をゲームへ届け直す
      setGamepadSuspended(false);
      fadeOutDialog(dialog);
      resolve(result);
    };

    running = {
      skip: () => {
        // 飛ばした項目は「使わない」として覚える（自動判定にも任せない）
        recordStep(config, steps[index], UNASSIGNED);
        waitRelease = true;
        index += 1;
        if (index >= steps.length) {
          saveGamepadConfig(config, location.href);
          finish(config);
        } else {
          showStep(steps, index, config.name);
        }
      },
      restart: () => {
        // 押し間違えた時のために、最初からやり直せるようにする
        config = startConfig(deviceName, key, saved, steps);
        index = 0;
        waitRelease = true;
        showStep(steps, 0, config.name);
      },
      cancel: () => finish(null),
    };

    const timer = setInterval(() => {
      const now = firstPad();
      if (!now) return;

      const input = detectInput({ axes: rest, buttons: [] }, now);

      // 何も押されていない状態を見てから、次の入力を受け付ける。
      // その時点の値を新しい基準にする（落ち着いた後の値を拾うため）
      if (WAIT_RELEASE && waitRelease) {
        if (!input) {
          rest = [...now.axes];
          waitRelease = false;
        }
        return;
      }
      if (!input) return;

      const step = steps[index];
      // 4方向で、静止位置が範囲外の軸なら「ハットスイッチ」として1度に決める
      const actual = step.kind === "cursor" && isHatBinding(input, rest)
        ? { kind: "hat", index: input.index }
        : input;

      const filled = recordStep(config, step, actual);
      // まとめて決まった方向は、この先の手順からも取り除く
      index += 1 + (filled > 0 ? steps.filter((s, i) => i > index && s.kind === "cursor").length : 0);
      waitRelease = true;
      // まとめて決まった場合は、なぜ飛んだのかを知らせる
      if (filled > 0) notify("padconf.hatFound");

      if (index >= steps.length) {
        saveGamepadConfig(config, location.href);
        // 確認できるよう、決まった内容をコンソールへ残す
        window.arcadeerLog?.(
          `コントローラー設定を保存しました: ${config.name}`,
        );
        // やり直しで作り替わることがあるため、その時点のものを渡す
        finish(config);
      } else {
        showStep(steps, index, config.name);
      }
    }, 16);

    showStep(steps, 0, config.name);
    // 設定のための入力が、そのままゲームの操作になってしまわないようにする
    setGamepadSuspended(true);
    dialog.addEventListener("close", onClose);
    fadeInDialog(dialog);
  });
}

/**
 * 保存済みの設定を、読み取りへ差し込む
 *
 * ゲームを実行するたびに呼ぶ。
 */
export function applySavedConfig() {
  setConfigLookup((key) => {
    const saved = key ? loadGamepadConfig(key, location.href) : null;
    return saved ? buildLayoutFromConfig(saved) : null;
  });
}

if (typeof window !== "undefined") {
  window.arcadeerOpenGamePadConfig = openGamePadConfig;
}
