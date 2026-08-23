// CoffeeScript のコンパイルとクラス登録
//
// code/*.coffee をコンパイルし、arcadeermain を継承したクラスとして登録する。
// コンパイルエラーはIDEへ通知する（仕様書5.8節の第1層）。

import { t } from "./i18n.js";
import {
  ArcadeerMain,
  defineClass,
  clearClasses,
  createObject,
  setScreenSize,
  resetScreenSize,
  isKeyDown,
} from "./runtime.js";
import { echo, logClear } from "./console-log.js";
import { resetKindWarnings } from "./kind.js";
import { GLOBAL, clearGlobals } from "./globals.js";
import { GAMEPAD, clearGamepads, setGamepadOption } from "./gamepad.js";
import {
  addLight,
  setLight,
  getLight,
  removeLight,
  clearLights,
  setAmbient,
} from "./light.js";
import {
  addCamera,
  setCamera,
  getCamera,
  setActiveCamera,
  removeCamera,
  clearCameras,
} from "./camera.js";

const COFFEE_VERSION = "2.7.0";
const COFFEE_URL = `https://cdnjs.cloudflare.com/ajax/libs/coffee-script/${COFFEE_VERSION}/coffeescript.min.js`;

let coffeePromise = null;

/**
 * CoffeeScript コンパイラをCDNから一度だけ読み込む
 *
 * 配布されているのは **ESモジュール**（`export default CoffeeScript`）のため、
 * `<script>` タグではなく動的 import で読み込む。
 */
function loadCompiler() {
  if (coffeePromise) return coffeePromise;
  coffeePromise = import(/* @vite-ignore */ COFFEE_URL).then((mod) => {
    const compiler = mod?.default ?? mod;
    if (typeof compiler?.compile !== "function") {
      throw new Error("CoffeeScript compiler is unavailable");
    }
    return compiler;
  });
  return coffeePromise;
}

/**
 * コンパイルエラーを「ファイル名:行:桁 メッセージ」の形へ整える
 *
 * CoffeeScript の位置情報は0起点のため、表示は1起点に直す。
 */
export function formatCompileError(className, err) {
  const message = typeof err === "string" ? err : (err?.message ?? String(err));
  const location = typeof err === "object" ? err?.location : null;
  if (!location || typeof location.first_line !== "number") {
    return `${className}.coffee: ${message}`;
  }
  const line = location.first_line + 1;
  const column = (location.first_column ?? 0) + 1;
  return `${className}.coffee:${line}:${column} ${message}`;
}

/**
 * 1つのクラスファイルをコンパイルして登録する
 * @returns {string|null} 失敗した場合は通知用のメッセージ
 */
function compileClass(compiler, className, source) {
  let js;
  try {
    js = compiler.compile(source, { bare: true });
  } catch (err) {
    return formatCompileError(className, err);
  }

  try {
    // arcadeermain とエンジンの関数をスコープへ渡してからクラスを取り出す。
    // グローバル（window）を汚さずに、ゲームコードから直接呼べるようにするため。
    const factory = new Function(
      "arcadeermain",
      "setScreenSize",
      "isKeyDown",
      "echo",
      "logClear",
      "addCamera",
      "setCamera",
      "getCamera",
      "setActiveCamera",
      "removeCamera",
      "addLight",
      "setLight",
      "getLight",
      "removeLight",
      "setAmbient",
      "GLOBAL",
      "GAMEPAD",
      "setGamepadOption",
      `${js}\nreturn typeof ${className} !== "undefined" ? ${className} : null;`,
    );
    const klass = factory(
      ArcadeerMain,
      setScreenSize,
      isKeyDown,
      echo,
      logClear,
      addCamera,
      setCamera,
      getCamera,
      setActiveCamera,
      removeCamera,
      addLight,
      setLight,
      getLight,
      removeLight,
      setAmbient,
      GLOBAL,
      GAMEPAD,
      setGamepadOption,
    );
    if (typeof klass !== "function") {
      return `${className}.coffee: class ${className} not found`;
    }
    defineClass(className, klass);
    return null;
  } catch (err) {
    return formatCompileError(className, err);
  }
}

/**
 * クラスファイル一式をコンパイルして登録する
 * @param {Array<{name: string, source: string}>} files
 * @returns {Promise<string[]>} エラーメッセージの配列（空なら成功）
 */
export async function buildClasses(files) {
  let compiler;
  try {
    compiler = await loadCompiler();
  } catch {
    // 次回の実行でやり直せるよう、失敗した読み込みは覚えておかない
    coffeePromise = null;
    return [t("msg.coffeeLoadFailed")];
  }

  clearClasses();
  // 前回の実行で指定された内容を持ち越さない
  resetScreenSize();
  clearCameras();
  clearLights();
  // 前回の実行で入れた値を持ち越さない
  clearGlobals();
  clearGamepads();
  // 前回の実行で出した @KIND の警告を持ち越さない
  resetKindWarnings();
  const errors = [];
  for (const { name, source } of files) {
    const error = compileClass(compiler, name, source);
    if (error) errors.push(error);
  }
  return errors;
}

/** 直近の生成に失敗した理由（成功したら null に戻す） */
let instantiateError = null;

/**
 * 直近の生成に失敗した理由
 *
 * 生成が `null` を返した時に、呼び出し側（WASM）が通知へ添えるために使う。
 * 理由が分からないと、書き間違いなのかコンストラクタの不具合なのか切り分けられないため。
 */
export function lastInstantiateError() {
  return instantiateError;
}

/**
 * クラス名からインスタンスを生成する
 * 生成できない場合は null を返し、理由を `lastInstantiateError()` に残す
 */
export function instantiate(name, param = {}) {
  try {
    const object = createObject(name, param);
    instantiateError = null;
    return object;
  } catch (err) {
    const message = typeof err === "string" ? err : (err?.message ?? String(err));
    instantiateError = `${name}.coffee: ${message}`;
    return null;
  }
}

if (typeof window !== "undefined") {
  window.arcadeerBuildClasses = buildClasses;
  window.arcadeerCreateObject = instantiate;
  window.arcadeerLastInstantiateError = lastInstantiateError;
}
