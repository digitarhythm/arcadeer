// 3Dモデルのプレビュー生成モジュール
// GLBを解析し、WebGLで描画してサムネイル画像（data URL）を作る。
// ホバー中は共有canvasへ差し替えてY軸回転させる。
// アニメーション・テクスチャ・PBRは扱わない（一覧のアイコン用途のため）。

import { parseGlb, collectPrimitives, computeBounds } from "./glb.js";
import { buildPrimitive } from "./primitive.js";
import { identity, multiply, translation, rotationY, perspective, lookAt } from "./matrix.js";

/** 生成するサムネイルの一辺（表示は約130pxなので2倍で用意する） */
const SIZE = 256;
/** ホバー回転の速さ（ラジアン／秒） */
const ROTATION_SPEED = Math.PI / 2;

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aColor;
uniform mat4 uModelView;
uniform mat4 uProjection;
varying vec3 vNormal;
varying vec4 vColor;
void main() {
  vNormal = mat3(uModelView) * aNormal;
  vColor = aColor;
  gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec4 vColor;
void main() {
  // 斜め上手前からの平行光源＋環境光のみの簡易シェーディング
  vec3 normal = normalize(vNormal);
  vec3 light = normalize(vec3(0.4, 0.8, 0.6));
  float diffuse = max(dot(normal, light), 0.0);
  vec3 color = vColor.rgb * (0.35 + 0.75 * diffuse);
  gl_FragColor = vec4(color, vColor.a);
}`;

// --- WebGL ---

/** シェーダをコンパイルしてプログラムを作る */
function createProgram(gl) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
    }
    return shader;
  };

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  }
  return program;
}

/** 頂点データをGPUへ載せる（描画のたびに送り直さないよう1度だけ行う） */
function uploadPrimitives(gl, model) {
  return model.primitives.map((primitive) => {
    const buffer = (data, target) => {
      const handle = gl.createBuffer();
      gl.bindBuffer(target, handle);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return handle;
    };

    // WebGL1 の既定では 32bit インデックスを扱えないため、必要なら拡張を有効にする
    let indices = primitive.indices;
    let indexType = gl.UNSIGNED_SHORT;
    if (indices instanceof Uint32Array) {
      if (gl.getExtension("OES_element_index_uint")) {
        indexType = gl.UNSIGNED_INT;
      } else {
        indices = new Uint16Array(indices);
      }
    } else if (indices instanceof Uint8Array) {
      indexType = gl.UNSIGNED_BYTE;
    }

    return {
      position: buffer(primitive.positions, gl.ARRAY_BUFFER),
      normal: buffer(primitive.normals, gl.ARRAY_BUFFER),
      color: buffer(primitive.colors, gl.ARRAY_BUFFER),
      index: buffer(indices, gl.ELEMENT_ARRAY_BUFFER),
      count: indices.length,
      indexType,
      matrix: new Float32Array(primitive.matrix),
    };
  });
}

/** 属性を割り当てる */
function bindAttribute(gl, program, name, buffer, size) {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

/**
 * モデルを1枚描く
 * @param {number} yaw モデル中心まわりのY軸回転（ラジアン）
 */
function drawModel(gl, program, model, gpu, yaw) {
  const { center, radius } = model.bounds;

  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.viewport(0, 0, SIZE, SIZE);

  // モデル全体が収まる位置へカメラを置く（斜め前方から見下ろす）
  // 画角の半頂角 18度 に対し、余白を1割ほど持たせた距離
  const distance = radius * 3.5;
  const eye = [
    center[0] + distance * 0.6,
    center[1] + distance * 0.45,
    center[2] + distance * 0.75,
  ];
  const view = lookAt(eye, center, [0, 1, 0]);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(program, "uProjection"),
    false,
    perspective(Math.PI / 5, 1, radius * 0.05, distance * 4),
  );

  // モデル中心を軸にして回す
  const spin = multiply(
    translation(center[0], center[1], center[2]),
    multiply(rotationY(yaw), translation(-center[0], -center[1], -center[2])),
  );
  const modelViewLocation = gl.getUniformLocation(program, "uModelView");

  for (const primitive of gpu) {
    bindAttribute(gl, program, "aPosition", primitive.position, 3);
    bindAttribute(gl, program, "aNormal", primitive.normal, 3);
    bindAttribute(gl, program, "aColor", primitive.color, 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index);
    gl.uniformMatrix4fv(modelViewLocation, false, multiply(view, multiply(spin, primitive.matrix)));
    gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0);
  }
}

/** GLBを描画に使える形へ変換する */
function parseModel(arrayBuffer) {
  const { json, bin } = parseGlb(arrayBuffer);
  const primitives = collectPrimitives(json, bin);
  if (primitives.length === 0) return null;
  const bounds = computeBounds(primitives);
  if (bounds.radius <= 0) return null;
  return { primitives, bounds };
}

// --- 静止画サムネイル ---

/**
 * GLBのバイナリからサムネイル画像（PNGのdata URL）を作る
 * 生成できない場合は null を返す。
 */
export function renderModelThumbnail(arrayBuffer) {
  const model = parseModel(arrayBuffer);
  if (!model) return null;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;

  const program = createProgram(gl);
  drawModel(gl, program, model, uploadPrimitives(gl, model), 0);

  const dataUrl = canvas.toDataURL("image/png");
  // GPUリソースを明示的に解放する（一覧では多数のモデルを続けて描くため）
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return dataUrl;
}

/**
 * 組み込みプリミティブ（box / sphere など）を、モデルと同じ形へ包む
 *
 * `buildPrimitive` が返す頂点色はすべて白のため、そのまま白い形として描ける。
 * 知らない形状名なら null。
 */
function primitiveModel(shape) {
  const built = buildPrimitive(shape);
  if (!built) return null;
  const primitives = [{ ...built, matrix: identity() }];
  const bounds = computeBounds(primitives);
  if (bounds.radius <= 0) return null;
  return { primitives, bounds };
}

/**
 * 組み込みプリミティブのサムネイル画像（PNGのdata URL）を作る
 *
 * `@MODEL = "sphere"` のように形状名を書いたクラスへ、その形のサムネイルを出す。
 * 知らない形状名なら null を返し、呼び出し側はアイコンのままにする。
 */
export function buildPrimitiveThumbnail(shape) {
  const model = primitiveModel(shape);
  if (!model) return null;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;

  const program = createProgram(gl);
  drawModel(gl, program, model, uploadPrimitives(gl, model), 0);

  const dataUrl = canvas.toDataURL("image/png");
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return dataUrl;
}

/**
 * object URL から読み込んでサムネイルを作る
 * 失敗した場合は null を返し、呼び出し側はプレースホルダーのままにする。
 */
export async function buildModelThumbnail(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return renderModelThumbnail(await response.arrayBuffer());
  } catch {
    return null;
  }
}

// --- ホバー中の回転表示 ---

/** ホバー表示は1枚のcanvas／1つのWebGLコンテキストを使い回す（同時に1件しか見ないため） */
let hoverCanvas = null;
let hoverGl = null;
let hoverProgram = null;
let hoverFrame = 0;
let hoverCard = null;
/** 回転表示中のサムネイル枠（静止画を隠すためのクラスを外すのに使う） */
let hoverThumb = null;
/** 解析済みモデルと、そのGPUバッファのキャッシュ（object URL をキーにする） */
const modelCache = new Map();

/** ホバー用のcanvasとWebGLコンテキストを用意する */
function ensureHoverContext() {
  if (hoverGl) return true;
  hoverCanvas = document.createElement("canvas");
  hoverCanvas.width = SIZE;
  hoverCanvas.height = SIZE;
  hoverCanvas.className = "model-hover-canvas";
  hoverGl = hoverCanvas.getContext("webgl", { alpha: true, antialias: true });
  if (!hoverGl) return false;
  hoverProgram = createProgram(hoverGl);
  return true;
}

/** プリミティブをGPUへ載せる（形状ごとに1度だけ） */
function getPrimitive(shape) {
  const key = `primitive:${shape}`;
  if (modelCache.has(key)) return modelCache.get(key);
  const model = primitiveModel(shape);
  if (!model) return null;
  model.gpu = uploadPrimitives(hoverGl, model);
  modelCache.set(key, model);
  return model;
}

/** モデルを解析してGPUへ載せる（一度読んだものは使い回す） */
async function getModel(url) {
  if (modelCache.has(url)) return modelCache.get(url);
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const model = parseModel(await response.arrayBuffer());
    if (!model) return null;
    model.gpu = uploadPrimitives(hoverGl, model);
    modelCache.set(url, model);
    return model;
  } catch {
    return null;
  }
}

/** ホバー回転を止め、静止画サムネイルへ戻す */
export function stopModelHover() {
  if (hoverFrame) {
    cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
  }
  if (hoverCanvas?.parentElement) hoverCanvas.remove();
  // 隠していた静止画サムネイルを戻す
  hoverThumb?.classList.remove("model-hover-active");
  hoverThumb = null;
  hoverCard = null;
}

/** ホバーしたカードのモデルをY軸回転させる */
async function startModelHover(card) {
  const shape = card.getAttribute("data-primitive");
  const url = card.getAttribute("data-url");
  if ((!shape && !url) || !ensureHoverContext()) return;

  hoverCard = card;
  // プリミティブは読み込みが要らないので、その場で組み立てる
  const model = shape ? getPrimitive(shape) : await getModel(url);
  // 読み込み中にホバーが外れていたら描かない
  if (!model || hoverCard !== card) return;

  const thumb = card.querySelector(".object-card-thumb");
  if (!thumb) return;
  // canvas は背景が透過のため、重ねる前に静止画サムネイルを隠す
  thumb.classList.add("model-hover-active");
  hoverThumb = thumb;
  thumb.appendChild(hoverCanvas);

  const started = performance.now();
  const loop = (now) => {
    drawModel(hoverGl, hoverProgram, model, model.gpu, ((now - started) / 1000) * ROTATION_SPEED);
    hoverFrame = requestAnimationFrame(loop);
  };
  hoverFrame = requestAnimationFrame(loop);
}

/** 解放された object URL のキャッシュを捨てる */
export function clearModelCache() {
  stopModelHover();
  modelCache.clear();
}

/**
 * 1つの object URL ぶんだけキャッシュから落とす
 *
 * 1件だけサムネイルを作り直す時に使う。**他のカードのぶんは残す**ため、
 * 全部捨てる `clearModelCache` とは分けてある。
 * いま回しているカードのものだった場合だけ、回転を止める。
 */
export function forgetModel(url) {
  if (!url) return;
  modelCache.delete(url);
  if (hoverCard?.getAttribute("data-url") === url) stopModelHover();
}

if (typeof window !== "undefined") {
  window.arcadeerBuildModelThumbnail = buildModelThumbnail;
  window.arcadeerBuildPrimitiveThumbnail = buildPrimitiveThumbnail;
  window.arcadeerStopModelHover = stopModelHover;
  window.arcadeerClearModelCache = clearModelCache;
  window.arcadeerForgetModel = forgetModel;

  // カードは再描画のたびに作り直されるため、イベントは委譲で受ける
  document.addEventListener(
    "mouseover",
    (e) => {
      const card = e.target.closest?.(".model-card[data-url], .model-card[data-primitive]");
      if (card && card !== hoverCard) {
        stopModelHover();
        startModelHover(card);
      }
    },
    true,
  );
  document.addEventListener(
    "mouseout",
    (e) => {
      if (!hoverCard) return;
      // カード内での移動では止めない
      const to = e.relatedTarget;
      if (to && hoverCard.contains(to)) return;
      stopModelHover();
    },
    true,
  );
}
