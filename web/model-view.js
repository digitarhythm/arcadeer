// 3Dモデルの詳細表示（仕様書4.4節）
//
// 左ペインの3Dモデルタブでモデルを選ぶと、メイン部に
//
// - 正面から見た**大きめのプレビュー**
// - 内包する**アニメーションの名前と、その動きのプレビュー**
//
// を縦に並べて表示する。名前をクリックするとクリップボードへコピーでき、
// ゲームコードの `@setAnimation name: "..."` へそのまま貼れる。
//
// 描画は WebGL のコンテキストを**1つだけ**使い回し、各行の2Dキャンバスへ写す。
// 行ごとにコンテキストを作ると、モデルによっては上限に達してしまうため。

import { t } from "./i18n.js";
import { parseGlb, collectPrimitives, collectSkin, collectClips, computeBounds } from "./glb.js";
import { sampleClip, jointMatrices } from "./animation.js";
import { multiply, perspective, lookAt } from "./matrix.js";

/** 正面プレビューの一辺 */
const BIG_SIZE = 512;
/** アニメーション1件ぶんのプレビューの一辺 */
const ROW_SIZE = 256;
/** 骨の数の上限（シェーダーの配列長） */
const MAX_JOINTS = 64;

// --- 見せ方の決まり（DOMに依存しないため単体テストできる） ---

/**
 * 正面から見るカメラの位置
 *
 * ゲームの決まりでは **-Z が前方**なので、手前側（-Z）へ置く。
 * 見上げ・見下ろしをせず、モデルの中心と同じ高さから見る。
 */
export function frontEye(bounds) {
  const center = bounds?.center ?? [0, 0, 0];
  const radius = Number.isFinite(bounds?.radius) && bounds.radius > 0 ? bounds.radius : 1;
  // 画角に対して少し余白を持たせた距離
  return [center[0], center[1], center[2] - radius * 3.2];
}

/**
 * アニメーション一覧を、表示に使う形へそろえる
 *
 * **並べ替えない。**作った側が意図した順で見せる。
 */
export function clipList(clips) {
  return (clips ?? [])
    .filter((c) => typeof c?.name === "string" && c.name !== "")
    .map((c) => ({
      name: c.name,
      duration: Number.isFinite(c.duration) ? c.duration : 0,
    }));
}

/**
 * 隠した入力欄を経由してコピーする（昔ながらのやり方）
 *
 * `navigator.clipboard` は安全な文脈と利用者の操作を必要とし、
 * 断られることがある。その時の逃げ道。
 */
function copyViaTextarea(text) {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  // 画面に出さず、それでも選択できる位置に置く
  area.style.cssText = "position:fixed;top:-1000px;opacity:0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/**
 * クリップボードへ書き込む
 *
 * `navigator.clipboard` を先に試し、断られたら隠した入力欄で写す。
 * どちらも駄目なら **false**。コピーできなかったことは呼び出し側が知らせる。
 */
export async function copyToClipboard(
  text,
  api = globalThis.navigator?.clipboard,
  fallback = copyViaTextarea,
) {
  if (!text) return false;
  if (typeof api?.writeText === "function") {
    try {
      await api.writeText(text);
      return true;
    } catch {
      // 断られた場合は下の逃げ道へ回す
    }
  }
  return Boolean(fallback?.(text));
}

// --- WebGL ---

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aColor;
attribute vec4 aJoints;
attribute vec4 aWeights;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform mat4 uJoints[${MAX_JOINTS}];
uniform bool uSkinned;
varying vec3 vNormal;
varying vec4 vColor;

mat4 skinMatrix() {
  return aWeights.x * uJoints[int(aJoints.x)]
       + aWeights.y * uJoints[int(aJoints.y)]
       + aWeights.z * uJoints[int(aJoints.z)]
       + aWeights.w * uJoints[int(aJoints.w)];
}

void main() {
  mat4 skin = uSkinned ? skinMatrix() : mat4(1.0);
  vec4 posed = skin * vec4(aPosition, 1.0);
  vNormal = mat3(uModelView) * mat3(skin) * aNormal;
  vColor = aColor;
  gl_Position = uProjection * uModelView * posed;
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec4 vColor;
void main() {
  // 斜め上手前からの平行光源＋環境光のみの簡易シェーディング
  vec3 normal = normalize(vNormal);
  vec3 light = normalize(vec3(0.35, 0.75, 0.55));
  float diffuse = max(dot(normal, light), 0.0);
  gl_FragColor = vec4(vColor.rgb * (0.38 + 0.72 * diffuse), vColor.a);
}`;

/** 使い回すWebGLのコンテキスト一式 */
let gl = null;
let glCanvas = null;
let program = null;

function ensureContext() {
  if (gl && !gl.isContextLost()) return true;
  glCanvas = document.createElement("canvas");
  glCanvas.width = BIG_SIZE;
  glCanvas.height = BIG_SIZE;
  gl = glCanvas.getContext("webgl", { alpha: true, antialias: true, preserveDrawingBuffer: true });
  if (!gl) return false;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
    }
    return shader;
  };
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  }
  return true;
}

/** 頂点データをGPUへ載せる */
function upload(primitives) {
  return primitives.map((p) => {
    const buffer = (data, target) => {
      const handle = gl.createBuffer();
      gl.bindBuffer(target, handle);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return handle;
    };
    let indices = p.indices;
    let indexType = gl.UNSIGNED_SHORT;
    if (indices instanceof Uint32Array) {
      if (gl.getExtension("OES_element_index_uint")) indexType = gl.UNSIGNED_INT;
      else indices = new Uint16Array(indices);
    } else if (indices instanceof Uint8Array) {
      indexType = gl.UNSIGNED_BYTE;
    }
    return {
      position: buffer(p.positions, gl.ARRAY_BUFFER),
      normal: buffer(p.normals, gl.ARRAY_BUFFER),
      color: buffer(p.colors, gl.ARRAY_BUFFER),
      joints: buffer(p.joints ?? new Float32Array(p.positions.length / 3 * 4), gl.ARRAY_BUFFER),
      weights: buffer(p.weights ?? new Float32Array(p.positions.length / 3 * 4), gl.ARRAY_BUFFER),
      index: buffer(indices, gl.ELEMENT_ARRAY_BUFFER),
      count: indices.length,
      indexType,
      matrix: new Float32Array(p.matrix),
    };
  });
}

function bindAttribute(name, buffer, size) {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

/**
 * モデルを1枚描く
 *
 * `pose` を渡すとその姿勢で、渡さなければ静止姿勢で描く。
 */
function draw(model, size, pose) {
  glCanvas.width = size;
  glCanvas.height = size;
  gl.viewport(0, 0, size, size);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);

  const { center, radius } = model.bounds;
  const eye = frontEye(model.bounds);
  const view = lookAt(eye, center, [0, 1, 0]);
  const far = Math.max(radius, 0.001) * 12;
  gl.uniformMatrix4fv(
    gl.getUniformLocation(program, "uProjection"),
    false,
    perspective(Math.PI / 5, 1, Math.max(radius, 0.001) * 0.05, far),
  );

  const skinned = Boolean(model.skin) && model.skin.joints.length <= MAX_JOINTS && Boolean(pose);
  gl.uniform1i(gl.getUniformLocation(program, "uSkinned"), skinned ? 1 : 0);
  if (skinned) {
    gl.uniformMatrix4fv(
      gl.getUniformLocation(program, "uJoints[0]"),
      false,
      jointMatrices(model.json, model.skin, pose),
    );
  }

  const modelViewLocation = gl.getUniformLocation(program, "uModelView");
  for (const p of model.gpu) {
    bindAttribute("aPosition", p.position, 3);
    bindAttribute("aNormal", p.normal, 3);
    bindAttribute("aColor", p.color, 4);
    bindAttribute("aJoints", p.joints, 4);
    bindAttribute("aWeights", p.weights, 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.index);
    // スキニングを使う時は、頂点は既に世界座標に揃っている
    const placement = skinned ? view : multiply(view, p.matrix);
    gl.uniformMatrix4fv(modelViewLocation, false, placement);
    gl.drawElements(gl.TRIANGLES, p.count, p.indexType, 0);
  }
}

/** GLBを読み込んで、描ける形にする */
async function loadModel(url) {
  const response = await fetch(url);
  if (!response.ok) return null;
  const { json, bin } = parseGlb(await response.arrayBuffer());
  const primitives = collectPrimitives(json, bin);
  if (primitives.length === 0) return null;
  const bounds = computeBounds(primitives);
  if (bounds.radius <= 0) return null;
  const skin = json.skins?.length ? collectSkin(json, bin, 0) : null;
  return { json, bin, bounds, skin, gpu: upload(primitives), clips: collectClips(json, bin) };
}

// --- 画面 ---

/** 動かしているプレビュー（画面を差し替える時に止める） */
let frame = 0;

/** 再生を止める */
export function stopModelView() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

/** 知らせを出す（コピーの成否など） */
function notify(message) {
  const note = document.getElementById("modelview-note");
  if (note) note.textContent = message;
}

/** 1つのアニメーションぶんの行を作る */
function buildRow(model, clip) {
  const row = document.createElement("div");
  row.className = "modelview-row";

  const canvas = document.createElement("canvas");
  canvas.width = ROW_SIZE;
  canvas.height = ROW_SIZE;
  canvas.className = "modelview-row-canvas";
  row.appendChild(canvas);

  const side = document.createElement("div");
  side.className = "modelview-row-side";

  // 名前はボタンにする。押せることが分かるように
  const name = document.createElement("button");
  name.type = "button";
  name.className = "modelview-clip-name";
  name.textContent = clip.name;
  name.title = t("modelView.copyHint");
  name.addEventListener("click", async () => {
    const ok = await copyToClipboard(clip.name);
    notify(ok ? t("modelView.copied", { name: clip.name }) : t("modelView.copyFailed"));
  });
  side.appendChild(name);

  const length = document.createElement("div");
  length.className = "modelview-clip-length";
  length.textContent = `${clip.duration.toFixed(2)}s`;
  side.appendChild(length);

  row.appendChild(side);
  return { row, canvas, clip: model.clips.find((c) => c.name === clip.name) };
}

/**
 * モデルの詳細をメイン部へ表示する
 *
 * @param fileName 表示するファイル名（見出しに使う）
 * @param url そのモデルの object URL
 */
export async function showModelView(fileName, url) {
  const main = document.getElementById("ide-content");
  if (!main) return;
  stopModelView();

  main.innerHTML = `
    <div class="modelview-pane">
      <div class="modelview-header">
        <span class="modelview-title" id="modelview-title"></span>
        <span class="modelview-note" id="modelview-note"></span>
      </div>
      <div class="modelview-body" id="modelview-body"></div>
    </div>
  `;
  document.getElementById("modelview-title").textContent = fileName;
  const body = document.getElementById("modelview-body");

  if (!ensureContext()) {
    notify(t("modelView.unavailable"));
    return;
  }

  let model = null;
  try {
    model = await loadModel(url);
  } catch {
    model = null;
  }
  if (!model) {
    notify(t("modelView.unreadable"));
    return;
  }

  // 正面の大きなプレビュー（静止姿勢）
  const big = document.createElement("canvas");
  big.width = BIG_SIZE;
  big.height = BIG_SIZE;
  big.className = "modelview-front";
  body.appendChild(big);
  draw(model, BIG_SIZE, null);
  big.getContext("2d").drawImage(glCanvas, 0, 0, BIG_SIZE, BIG_SIZE);

  const clips = clipList(model.clips);
  const heading = document.createElement("h3");
  heading.className = "modelview-heading";
  heading.textContent = t("modelView.animations");
  body.appendChild(heading);

  if (clips.length === 0) {
    const empty = document.createElement("p");
    empty.className = "modelview-empty";
    empty.textContent = t("modelView.noAnimations");
    body.appendChild(empty);
    return;
  }

  notify(t("modelView.copyHint"));

  const rows = clips.map((clip) => buildRow(model, clip));
  for (const r of rows) body.appendChild(r.row);

  // 1つのWebGLキャンバスで順に描き、各行へ写す
  const started = performance.now();
  const loop = (now) => {
    const elapsed = (now - started) / 1000;
    for (const r of rows) {
      if (!r.clip) continue;
      const time = r.clip.duration > 0 ? elapsed % r.clip.duration : 0;
      draw(model, ROW_SIZE, sampleClip(r.clip, time));
      r.canvas.getContext("2d").clearRect(0, 0, ROW_SIZE, ROW_SIZE);
      r.canvas.getContext("2d").drawImage(glCanvas, 0, 0, ROW_SIZE, ROW_SIZE);
    }
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
}

if (typeof window !== "undefined") {
  window.arcadeerShowModelView = showModelView;
  window.arcadeerStopModelView = stopModelView;
}
