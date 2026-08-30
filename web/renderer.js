// WebGL描画（3D）
//
// 仕様書6.1節のとおり、描画は**裏フレームバッファ（FBO）**へ行い、
// 入れ替えの判断が下りた時点で表示側へ転送する。
// ブラウザは requestAnimationFrame の終わりに自動で画面を更新するため、
// 「表示時間まで待ってから入れ替える」挙動を自前のバッファで再現している。

import { parseGlb, collectPrimitives, collectClips, collectSkin, computeBox } from "./glb.js";
import { sampleClip, jointMatrices, stripRootMotion } from "./animation.js";
import { stepObjectAnimation, removeFromList } from "./runtime.js";
import { multiply, lightViewProjection, transformPoint } from "./matrix.js";
import { viewMatrix, projectionMatrix } from "./camera.js";
import { lights, shadowLight, ambient, lightVector, MAX_LIGHTS as LIGHT_LIMIT } from "./light.js";
import { isRenderable3D, isPrimitive, modelMatrix } from "./scene.js";
import { buildPrimitive } from "./primitive.js";
import { parseColor, objectColor } from "./color.js";
import { splitByAlpha } from "./draw-order.js";
import { splitCasters, transmittanceOf } from "./shadow-cast.js";
import { setModelBoxLookup, boundsOf } from "./collision.js";
import { debugOption, boundaryLines, DEBUG_COLOR } from "./debug-draw.js";
import { resolveKind } from "./kind.js";

/** シェーダーへ渡せるボーンの上限 */
const MAX_JOINTS = 32;
/** シェーダーへ渡せるライトの上限（light.js と合わせる） */
const MAX_LIGHTS = 4;
/** 影の解像度（一辺の画素数） */
const SHADOW_SIZE = 1024;

const SCENE_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aColor;
attribute vec4 aJoints;
attribute vec4 aWeights;
uniform mat4 uModelView;
uniform mat4 uProjection;
uniform mat4 uJoints[${MAX_JOINTS}];
uniform mat4 uShadowMatrix;
uniform bool uSkinned;
uniform vec4 uColor;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vViewPos;
varying vec4 vShadowPos;

mat4 skinMatrix() {
  // 4本ぶんのボーンを重み付きで合成する
  return aWeights.x * uJoints[int(aJoints.x)]
       + aWeights.y * uJoints[int(aJoints.y)]
       + aWeights.z * uJoints[int(aJoints.z)]
       + aWeights.w * uJoints[int(aJoints.w)];
}

void main() {
  mat4 skin = uSkinned ? skinMatrix() : mat4(1.0);
  vec4 posed = skin * vec4(aPosition, 1.0);
  vec4 viewPos = uModelView * posed;
  vNormal = mat3(uModelView) * mat3(skin) * aNormal;
  vViewPos = viewPos.xyz;
  // 影の判定に使う、ライトから見た位置
  vShadowPos = uShadowMatrix * posed;
  // @COLOR は素材の色へ掛け合わせる（指定が無ければ白なので変わらない）
  vColor = aColor * uColor;
  gl_Position = uProjection * viewPos;
}`;

const SCENE_FRAGMENT = `
precision mediump float;
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vViewPos;
varying vec4 vShadowPos;

uniform vec4 uAmbient;
uniform int uLightCount;
// 0:平行光 1:点光源 2:環境光として足す
uniform int uLightType[${MAX_LIGHTS}];
// 平行光は「進む向き」、点光源は「位置」。どちらも視点から見た座標系にそろえてある
uniform vec3 uLightVector[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform float uLightIntensity[${MAX_LIGHTS}];
uniform float uLightRange[${MAX_LIGHTS}];

uniform bool uShadowOn;
uniform sampler2D uShadowMap;
uniform float uShadowBias;
uniform float uShadowTexel;
// 半透明のものが、光をどれだけ通したか（1で素通し）
uniform sampler2D uTransmitMap;

// 深度を RGBA へ詰めた値から元へ戻す（WebGL1 では深度テクスチャが使えない環境があるため）
float unpackDepth(vec4 rgba) {
  return dot(rgba, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

// 影の中にいる割合（0:日向 〜 1:影）
float shadowRatio() {
  if (!uShadowOn) return 0.0;
  vec3 coord = vShadowPos.xyz / vShadowPos.w;
  coord = coord * 0.5 + 0.5;
  // 光の写した範囲の外は影にしない
  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) {
    return 0.0;
  }
  // 近くの9点を調べて、輪郭のギザギザをやわらげる
  float shadowed = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 at = coord.xy + vec2(float(x), float(y)) * uShadowTexel;
      float depth = unpackDepth(texture2D(uShadowMap, at));
      shadowed += coord.z - uShadowBias > depth ? 1.0 : 0.0;
    }
  }
  return shadowed / 9.0;
}

// 半透明ごしに届く光の割合（0:さえぎられた 〜 1:素通し）
float transmitRatio() {
  if (!uShadowOn) return 1.0;
  vec3 coord = vShadowPos.xyz / vShadowPos.w;
  coord = coord * 0.5 + 0.5;
  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) {
    return 1.0;
  }
  // 影の輪郭と同じだけぼかす。片方だけくっきりしていると境目が浮く
  float through = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 at = coord.xy + vec2(float(x), float(y)) * uShadowTexel;
      through += texture2D(uTransmitMap, at).r;
    }
  }
  return through / 9.0;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lit = uAmbient.rgb;
  // 不透明にさえぎられた分と、半透明を通ってきた分を合わせる。
  // 半透明が無ければ透過率は1になり、これまでと同じ結果になる
  float blocked = 1.0 - (1.0 - shadowRatio()) * transmitRatio();
  float shade = 1.0 - blocked * 0.75;

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;

    vec3 color = uLightColor[i] * uLightIntensity[i];
    if (uLightType[i] == 2) {
      // 環境光として素通しで足す
      lit += color;
    } else if (uLightType[i] == 0) {
      // 平行光。uLightVector は光が進む向きなので、面から光源へ向けて反転する
      float diffuse = max(dot(normal, -uLightVector[i]), 0.0);
      lit += color * diffuse * shade;
    } else {
      // 点光源。距離が離れるほど弱くする
      vec3 toLight = uLightVector[i] - vViewPos;
      float distance = length(toLight);
      float diffuse = max(dot(normal, normalize(toLight)), 0.0);
      float falloff = max(1.0 - distance / max(uLightRange[i], 0.0001), 0.0);
      lit += color * diffuse * falloff * falloff * shade;
    }
  }

  gl_FragColor = vec4(vColor.rgb * lit, vColor.a);
}`;

// 影を描くためのシェーダー。ライトから見た深度だけを記録する
const SHADOW_VERTEX = `
attribute vec3 aPosition;
attribute vec4 aJoints;
attribute vec4 aWeights;
uniform mat4 uShadowMatrix;
uniform mat4 uJoints[${MAX_JOINTS}];
uniform bool uSkinned;

mat4 skinMatrix() {
  return aWeights.x * uJoints[int(aJoints.x)]
       + aWeights.y * uJoints[int(aJoints.y)]
       + aWeights.z * uJoints[int(aJoints.z)]
       + aWeights.w * uJoints[int(aJoints.w)];
}

void main() {
  mat4 skin = uSkinned ? skinMatrix() : mat4(1.0);
  gl_Position = uShadowMatrix * skin * vec4(aPosition, 1.0);
}`;

const SHADOW_FRAGMENT = `
precision highp float;

// 深度を RGBA の4成分へ分けて詰める（8bit×4で精度を稼ぐ）
vec4 packDepth(float depth) {
  vec4 bits = fract(depth * vec4(1.0, 255.0, 65025.0, 16581375.0));
  bits -= bits.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  return bits;
}

void main() {
  gl_FragColor = packDepth(gl_FragCoord.z);
}`;

// 透過率を書き込むシェーダー。掛け算のブレンドで塗り重ねる
const TRANSMIT_FRAGMENT = `
precision highp float;
uniform float uTransmit;

void main() {
  gl_FragColor = vec4(vec3(uTransmit), 1.0);
}`;

// 裏バッファを画面へ転送するための、画面いっぱいの四角形
// 当たり判定の枠を描くだけの、いちばん簡単な組（5.5節）
const LINE_VERTEX = `
attribute vec3 aPosition;
uniform mat4 uProjection;
uniform mat4 uModelView;
void main() {
  gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
}
`;

const LINE_FRAGMENT = `
precision mediump float;
uniform vec4 uColor;
void main() {
  gl_FragColor = uColor;
}
`;

const BLIT_VERTEX = `
attribute vec2 aCorner;
varying vec2 vUv;
void main() {
  vUv = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

const BLIT_FRAGMENT = `
precision mediump float;
uniform sampler2D uTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTexture, vUv);
}`;

let gl = null;
let sceneProgram = null;
let shadowProgram = null;
/** 影を描き込むフレームバッファ一式 */
let shadowTarget = null;
/** 半透明が光をどれだけ通したかを描き込む組（6.2.6節） */
let transmitProgram = null;
let transmitTarget = null;
let blitProgram = null;
let blitBuffer = null;
/** 裏フレームバッファ一式 */
let back = null;
/** モデル名 → GPUへ載せたデータ */
const models = new Map();

/** シェーダをコンパイルしてプログラムを作る */
/** 当たり判定の枠を描く組と、その頂点置き場（5.5節） */
let lineProgram = null;
let lineBuffer = null;

function createProgram(vertexSource, fragmentSource) {
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
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  }
  return program;
}

/** 指定の大きさで裏フレームバッファを作り直す */
/**
 * 影を描き込むフレームバッファを作る
 *
 * 深度テクスチャの拡張が無い環境でも動くよう、**深度をRGBAへ詰めて**色として書く。
 * 影の輪郭がぼやけないよう、拡大縮小の補間はしない。
 */
function createShadowTarget(sharedDepth = null) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_SIZE, SHADOW_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // 範囲の外を参照した時に、反対側の影を拾わないようにする
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const depth = sharedDepth ?? gl.createRenderbuffer();
  if (!sharedDepth) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_SIZE, SHADOW_SIZE);
  }

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`shadow framebuffer is incomplete (0x${status.toString(16)})`);
  }
  return { framebuffer, texture, depth };
}

function createBackBuffer(width, height) {
  if (back) {
    gl.deleteFramebuffer(back.framebuffer);
    gl.deleteTexture(back.texture);
    gl.deleteRenderbuffer(back.depth);
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  // 拡大縮小して表示するため、なめらかに補間する
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`framebuffer is incomplete (0x${status.toString(16)})`);
  }

  back = { framebuffer, texture, depth, width, height };
}

/**
 * 描画の準備をする（ゲーム実行の開始時に呼ぶ）
 * @returns {boolean} WebGLを使えない場合は false
 */
export function initRenderer(canvas) {
  if (!canvas) throw new Error("#game-canvas not found");
  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error(`canvas has no size (${canvas.width}x${canvas.height})`);
  }
  if (!gl || gl.isContextLost()) {
    // 入れ替えの判断が下りるまで前の絵を保つため、描画バッファを消させない
    gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL is unavailable");
    sceneProgram = createProgram(SCENE_VERTEX, SCENE_FRAGMENT);
    shadowProgram = createProgram(SHADOW_VERTEX, SHADOW_FRAGMENT);
    shadowTarget = createShadowTarget();
    // 深度は影のものと共有する。半透明が不透明の陰に隠れている時は数えないため
    transmitProgram = createProgram(SHADOW_VERTEX, TRANSMIT_FRAGMENT);
    transmitTarget = createShadowTarget(shadowTarget.depth);
    blitProgram = createProgram(BLIT_VERTEX, BLIT_FRAGMENT);
    lineProgram = createProgram(LINE_VERTEX, LINE_FRAGMENT);

    blitBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, blitBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
  }
  // 内部解像度が変わっていれば裏バッファを作り直す
  if (!back || back.width !== canvas.width || back.height !== canvas.height) {
    createBackBuffer(canvas.width, canvas.height);
  }
  return true;
}

/**
 * モデルをGPUへ載せる（読み込み済みなら何もしない）
 * @returns {Promise<boolean>} 使える状態になったか
 */
export async function loadModel(name, url) {
  if (!gl) throw new Error("renderer is not ready");
  if (models.has(name)) return true;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const { json, bin } = parseGlb(await response.arrayBuffer());
  const primitives = collectPrimitives(json, bin);
  if (primitives.length === 0) throw new Error(`${name}: no drawable primitives`);

  {

    const uploaded = primitives.map((primitive) => {
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
        if (gl.getExtension("OES_element_index_uint")) indexType = gl.UNSIGNED_INT;
        else indices = new Uint16Array(indices);
      } else if (indices instanceof Uint8Array) {
        indexType = gl.UNSIGNED_BYTE;
      }
      return {
        position: buffer(primitive.positions, gl.ARRAY_BUFFER),
        normal: buffer(primitive.normals, gl.ARRAY_BUFFER),
        color: buffer(primitive.colors, gl.ARRAY_BUFFER),
        joints: buffer(primitive.joints, gl.ARRAY_BUFFER),
        weights: buffer(primitive.weights, gl.ARRAY_BUFFER),
        index: buffer(indices, gl.ELEMENT_ARRAY_BUFFER),
        count: indices.length,
        indexType,
        matrix: new Float32Array(primitive.matrix),
        skin: primitive.skin,
      };
    });

    // アニメーションとスケルトンは、姿勢の計算に元データが要るため一緒に持つ
    const clips = new Map(collectClips(json, bin).map((clip) => [clip.name, clip]));
    const skinIndex = uploaded.find((p) => p.skin !== null)?.skin ?? null;
    models.set(name, {
      primitives: uploaded,
      clips,
      json,
      skin: skinIndex !== null ? collectSkin(json, bin, skinIndex) : null,
      // 当たり判定で「見た目そのもの」を使う時のもと（5.5節）。
      // 頂点はGPUへ渡してしまうため、この時点で求めて覚えておく
      box: computeBox(primitives),
    });
    return true;
  }
}

// 当たり判定から、モデルの大きさを引けるようにする（5.5節）
setModelBoxLookup((name) => models.get(name)?.box ?? null);

/** 組み込みプリミティブの形状名 → GPUへ載せた頂点 */
const primitives = new Map();

/**
 * 組み込みプリミティブをGPUへ載せる（一度だけ）
 *
 * ファイルの読み込みが無いため同期で済む。3Dモデルと同じ形にそろえて返す。
 */
function primitiveMesh(name) {
  const key = name.toLowerCase();
  const cached = primitives.get(key);
  if (cached) return cached;

  const shape = buildPrimitive(key);
  if (!shape) return null;

  const vertices = shape.positions.length / 3;
  const buffer = (data, target) => {
    const handle = gl.createBuffer();
    gl.bindBuffer(target, handle);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return handle;
  };
  const mesh = {
    position: buffer(shape.positions, gl.ARRAY_BUFFER),
    normal: buffer(shape.normals, gl.ARRAY_BUFFER),
    color: buffer(shape.colors, gl.ARRAY_BUFFER),
    // プリミティブはボーンを持たないため、割り当ては先頭へ固定する
    joints: buffer(new Float32Array(vertices * 4), gl.ARRAY_BUFFER),
    weights: buffer(defaultWeights(vertices), gl.ARRAY_BUFFER),
    index: buffer(shape.indices, gl.ELEMENT_ARRAY_BUFFER),
    count: shape.indices.length,
    indexType: gl.UNSIGNED_SHORT,
    matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    skin: null,
  };
  primitives.set(key, mesh);
  return mesh;
}

/** ボーンの重み（先頭ボーンに全体重を置く） */
function defaultWeights(vertices) {
  const out = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i += 1) out[i * 4] = 1;
  return out;
}

/** 読み込み済みのモデル名（動作確認用） */
export function loadedModels() {
  return [...models.keys()];
}

/** 読み込み済みのモデルをすべて捨てる（ゲーム停止時） */
export function clearModels() {
  if (gl) {
    for (const model of models.values()) {
      for (const p of model.primitives) {
        gl.deleteBuffer(p.position);
        gl.deleteBuffer(p.normal);
        gl.deleteBuffer(p.color);
        gl.deleteBuffer(p.joints);
        gl.deleteBuffer(p.weights);
        gl.deleteBuffer(p.index);
      }
    }
  }
  models.clear();

  if (gl) {
    for (const mesh of primitives.values()) {
      gl.deleteBuffer(mesh.position);
      gl.deleteBuffer(mesh.normal);
      gl.deleteBuffer(mesh.color);
      gl.deleteBuffer(mesh.joints);
      gl.deleteBuffer(mesh.weights);
      gl.deleteBuffer(mesh.index);
    }
  }
  primitives.clear();
}

/** 属性を割り当てる */
function bindAttribute(program, name, buffer, size) {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

/** 種類を番号にする（シェーダーへ渡すため） */
const TYPE_CODES = { directional: 0, point: 1, ambient: 2 };

/**
 * ライトの内容をシェーダーへ渡す
 *
 * 位置と向きは、シェーダー側の計算に合わせて**視点から見た座標系**へそろえておく。
 * 画素ごとに変換し直すより安く済む。
 */
function applyLights(view) {
  const list = lights().slice(0, LIGHT_LIMIT);
  const at = (name) => gl.getUniformLocation(sceneProgram, name);

  gl.uniform4fv(at("uAmbient"), ambient());
  gl.uniform1i(at("uLightCount"), list.length);

  const types = new Int32Array(LIGHT_LIMIT);
  const vectors = new Float32Array(LIGHT_LIMIT * 3);
  const colors = new Float32Array(LIGHT_LIMIT * 3);
  const intensities = new Float32Array(LIGHT_LIMIT);
  const ranges = new Float32Array(LIGHT_LIMIT);

  list.forEach((light, i) => {
    types[i] = TYPE_CODES[light.type] ?? 0;
    const raw = lightVector(light);
    // 点光源は「点」として、平行光は「向き」として変換する
    const converted =
      light.type === "point" ? transformPoint(view, raw) : rotateByView(view, raw);
    vectors.set(converted, i * 3);
    colors.set(parseColor(light.COLOR).slice(0, 3), i * 3);
    intensities[i] = Number.isFinite(light.intensity) ? light.intensity : 1;
    ranges[i] = Number.isFinite(light.range) ? light.range : 20;
  });

  gl.uniform1iv(at("uLightType[0]"), types);
  gl.uniform3fv(at("uLightVector[0]"), vectors);
  gl.uniform3fv(at("uLightColor[0]"), colors);
  gl.uniform1fv(at("uLightIntensity[0]"), intensities);
  gl.uniform1fv(at("uLightRange[0]"), ranges);
}

/** 向きを視点の座標系へ回す（平行移動は掛けない） */
function rotateByView(view, [x, y, z]) {
  return [
    view[0] * x + view[4] * y + view[8] * z,
    view[1] * x + view[5] * y + view[9] * z,
    view[2] * x + view[6] * y + view[10] * z,
  ];
}

/** 影のテクスチャと設定をシェーダーへ渡す */
function applyShadowMap(enabled) {
  const at = (name) => gl.getUniformLocation(sceneProgram, name);
  gl.uniform1i(at("uShadowOn"), enabled ? 1 : 0);
  if (!enabled) return;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shadowTarget.texture);
  gl.uniform1i(at("uShadowMap"), 0);
  // 半透明が光をどれだけ通したか（6.2.6節）
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, transmitTarget.texture);
  gl.uniform1i(at("uTransmitMap"), 1);
  // 面が自分自身を影と誤判定しないよう、わずかに手前へずらす
  gl.uniform1f(at("uShadowBias"), 0.0025);
  gl.uniform1f(at("uShadowTexel"), 1 / SHADOW_SIZE);
}

/**
 * ライトから見た深度を描く
 *
 * @returns 影の判定に使う行列。影を作るライトが無ければ `null`
 */
function drawShadowMap(drawables, camera) {
  const light = shadowLight();
  // 点光源からの影は未対応（全方向を写す必要があり、作りが大きく変わるため）
  if (!light || light.type !== "directional" || !shadowTarget) return null;
  if (drawables.length === 0) return null;

  // 影を写す範囲は**カメラの注視点まわり**に取る。
  // 置かれているオブジェクト全体に合わせると、遠くへ飛んだ1体のせいで
  // 範囲が広がり、肝心の手元の影が粗くなってしまう。
  const radius = Math.max(light.shadowRadius ?? 20, 1);
  const matrix = lightViewProjection(
    {
      ...light,
      targetX: camera?.targetX ?? 0,
      targetY: camera?.targetY ?? 0,
      targetZ: camera?.targetZ ?? 0,
    },
    radius,
    0.1,
    radius * 4 + 100,
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowTarget.framebuffer);
  gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
  gl.enable(gl.DEPTH_TEST);
  // 何も無い場所は「最も奥」にしておく（影にならない）
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // 影を落とす側を、不透明と半透明に分ける（6.2.6節）
  const { solid, translucent } = splitCasters(drawables);

  /** 光の目線で1組ぶん描く */
  const castGroup = (program, list, onObject) => {
    const matrixLocation = gl.getUniformLocation(program, "uShadowMatrix");
    const skinnedLocation = gl.getUniformLocation(program, "uSkinned");
    const jointsLocation = gl.getUniformLocation(program, "uJoints[0]");

    for (const object of list) {
      const { meshes, model } = meshesFor(object);
      gl.uniform1i(skinnedLocation, applyPose(object, model, jointsLocation) ? 1 : 0);
      onObject?.(object);

      const placement = multiply(matrix, modelMatrix(object));
      for (const primitive of meshes) {
        bindAttribute(program, "aPosition", primitive.position, 3);
        bindAttribute(program, "aJoints", primitive.joints, 4);
        bindAttribute(program, "aWeights", primitive.weights, 4);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index);
        gl.uniformMatrix4fv(matrixLocation, false, multiply(placement, primitive.matrix));
        gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0);
      }
    }
  };

  // 深度マップには**不透明なものだけ**を描く
  gl.useProgram(shadowProgram);
  castGroup(shadowProgram, solid);

  drawTransmitMap(matrix, translucent, castGroup);
  return matrix;
}

/**
 * 半透明が光をどれだけ通したかを描き込む（6.2.6節）
 *
 * 白（＝全部通す）で塗ってから、半透明なものを `1 - ALPHA` の色で塗り重ねる。
 * **掛け算のブレンド**にしてあるため、2枚重なれば `0.5 × 0.5 = 0.25` と
 * 自然に濃くなる。掛け算は順序を選ばないので、並べ替えも要らない。
 */
function drawTransmitMap(matrix, translucent, castGroup) {
  if (!transmitTarget) return;

  gl.bindFramebuffer(gl.FRAMEBUFFER, transmitTarget.framebuffer);
  gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (translucent.length === 0) return;

  gl.useProgram(transmitProgram);
  const transmitLocation = gl.getUniformLocation(transmitProgram, "uTransmit");

  gl.enable(gl.BLEND);
  // 掛け算で塗り重ねる（新しい値 = いまの値 × 描いた色）
  gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
  // 深度は不透明のものと共有している。その陰に隠れた半透明は数えない。
  // 書き込みはしない（半透明どうしが打ち消し合わないように）
  gl.depthMask(false);

  castGroup(transmitProgram, translucent, (object) => {
    gl.uniform1f(transmitLocation, transmittanceOf(object));
  });

  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

/**
 * オブジェクトの姿勢からボーン行列を求めて渡す
 * @returns スキニングを使うかどうか
 */
function applyPose(object, model, jointsLocation) {
  if (!model?.skin || model.skin.joints.length > MAX_JOINTS) return false;
  const clip = object.animation ? model.clips.get(object.animation.name) : null;
  let pose = clip ? sampleClip(clip, object.animation.time) : new Map();
  // ルートモーションが無効なら、根ボーンの移動を取り除いてその場で再生する
  if (clip && object.animation.rootMotion === false) {
    pose = stripRootMotion(pose, model.skin.root);
  }
  gl.uniformMatrix4fv(jointsLocation, false, jointMatrices(model.json, model.skin, pose));
  return true;
}

/**
 * オブジェクトが使う頂点データを取り出す/**
 * オブジェクトが使う頂点データを取り出す
 *
 * 3Dモデルなら読み込み済みのものを、プリミティブならその場で作ったものを返す。
 * どちらでもない（描かない）場合は `null`。
 */
function meshesFor(object) {
  if (isRenderable3D(object)) {
    const model = models.get(object.MODEL);
    return model ? { meshes: model.primitives, model } : null;
  }
  if (isPrimitive(object)) {
    const mesh = primitiveMesh(object.MODEL);
    return mesh ? { meshes: [mesh], model: null } : null;
  }
  return null;
}

/**
 * オブジェクト一式を裏フレームバッファへ描く
 *
 * 画面への反映は行わない（`present()` を呼ぶまで表示は変わらない）。
 */
export function drawScene(objects, camera) {
  if (!gl || !back) return;

  const drawables = (objects ?? []).filter((o) => meshesFor(o));
  // 先にライトから見た深度を描いておく（影の判定に使う）
  const shadowMatrix = drawShadowMap(drawables, camera);

  gl.bindFramebuffer(gl.FRAMEBUFFER, back.framebuffer);
  gl.viewport(0, 0, back.width, back.height);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.06, 0.06, 0.1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(sceneProgram);
  const view = viewMatrix(camera);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(sceneProgram, "uProjection"),
    false,
    projectionMatrix(camera, back.width / back.height),
  );
  const modelViewLocation = gl.getUniformLocation(sceneProgram, "uModelView");

  const skinnedLocation = gl.getUniformLocation(sceneProgram, "uSkinned");
  const jointsLocation = gl.getUniformLocation(sceneProgram, "uJoints[0]");
  const colorLocation = gl.getUniformLocation(sceneProgram, "uColor");
  const shadowMatrixLocation = gl.getUniformLocation(sceneProgram, "uShadowMatrix");

  applyLights(view);
  applyShadowMap(shadowMatrix !== null);

  /** まとめて1組ぶん描く */
  const drawGroup = (list) => {
    for (const object of list) {
      const { meshes, model } = meshesFor(object);

      // 再生中のクリップから、この時刻のボーン行列を求める（プリミティブは持たない）
      gl.uniform1i(skinnedLocation, applyPose(object, model, jointsLocation) ? 1 : 0);
      gl.uniform4fv(colorLocation, objectColor(object));

      const model4 = modelMatrix(object);
      const placement = multiply(view, model4);
      const shadowPlacement = shadowMatrix ? multiply(shadowMatrix, model4) : null;
      for (const primitive of meshes) {
        if (shadowPlacement) {
          gl.uniformMatrix4fv(
            shadowMatrixLocation, false, multiply(shadowPlacement, primitive.matrix),
          );
        }
        bindAttribute(sceneProgram, "aPosition", primitive.position, 3);
        bindAttribute(sceneProgram, "aNormal", primitive.normal, 3);
        bindAttribute(sceneProgram, "aColor", primitive.color, 4);
        bindAttribute(sceneProgram, "aJoints", primitive.joints, 4);
        bindAttribute(sceneProgram, "aWeights", primitive.weights, 4);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index);
        gl.uniformMatrix4fv(modelViewLocation, false, multiply(placement, primitive.matrix));
        gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0);
      }
    }
  };

  // 不透明を先に描き、そのあと半透明を奥から手前へ重ねる（6.2.5節）
  const { opaque, transparent } = splitByAlpha(drawables, camera);
  drawGroup(opaque);

  if (transparent.length > 0) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // 深度は読むが書かない。書いてしまうと、手前の半透明が
    // 奥の半透明を深度テストで消してしまう
    gl.depthMask(false);
    drawGroup(transparent);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawBoundaries(objects ?? [], view, camera);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * 当たり判定の枠を、赤い線で重ねて描く（5.5節）
 *
 * **深度判定を効かせたまま描く。**モデルの後ろへ回った辺は隠れ、
 * 前後の関係が見た目どおりになる。
 * `setDebug debug: true` を呼んでいない間は何もしない。
 */
function drawBoundaries(objects, view, camera) {
  const option = debugOption();
  if (!option.debug || !lineProgram) return;

  const lines = [];
  for (const object of objects) {
    const vertices = boundaryLines(boundsOf(object), resolveKind(object));
    if (vertices.length > 0) lines.push(...vertices);
  }
  if (lines.length === 0) return;

  if (!lineBuffer) lineBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);

  gl.useProgram(lineProgram);
  gl.uniformMatrix4fv(
    gl.getUniformLocation(lineProgram, "uProjection"),
    false,
    projectionMatrix(camera, back.width / back.height),
  );
  // 判定は世界座標そのままなので、配置行列は要らない
  gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, "uModelView"), false, view);
  gl.uniform4f(
    gl.getUniformLocation(lineProgram, "uColor"),
    DEBUG_COLOR[0], DEBUG_COLOR[1], DEBUG_COLOR[2], option.opacity,
  );

  const attrib = gl.getAttribLocation(lineProgram, "aPosition");
  gl.enableVertexAttribArray(attrib);
  gl.vertexAttribPointer(attrib, 3, gl.FLOAT, false, 0, 0);

  // 半透明で重ねる。枠は補助なので、下の絵を塗り潰さない
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  // 線そのものは深度を書き換えない。あとから描くものへ影響させないため
  gl.depthMask(false);
  gl.drawArrays(gl.LINES, 0, lines.length / 3);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

/** 裏フレームバッファを画面へ転送する（バッファの入れ替えにあたる） */
export function present() {
  if (!gl || !back) return;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, back.width, back.height);
  gl.disable(gl.DEPTH_TEST);

  gl.useProgram(blitProgram);
  const corner = gl.getAttribLocation(blitProgram, "aCorner");
  gl.bindBuffer(gl.ARRAY_BUFFER, blitBuffer);
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, back.texture);
  gl.uniform1i(gl.getUniformLocation(blitProgram, "uTexture"), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * 再生中のアニメーションを経過時間ぶん進める
 *
 * クリップの長さはモデル側が持つため、ここでまとめて面倒を見る。
 */
export function advanceAnimations(objects, deltaSec) {
  for (const object of objects ?? []) {
    const anim = object?.animation;
    if (!anim) continue;
    const clip = models.get(object.MODEL)?.clips.get(anim.name);
    if (!clip) continue;

    // 指定回数を再生し終えたものは、ここで消す合図が返る（6.2節）
    if (stepObjectAnimation(object, deltaSec, clip.duration)) removeFromList(object);
  }
}

/** 画面を消す（ゲーム停止時） */
export function clearScreen() {
  if (!gl) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

if (typeof window !== "undefined") {
  window.arcadeerInitRenderer = () =>
    initRenderer(document.getElementById("game-canvas"));
  window.arcadeerLoadModel = loadModel;
  window.arcadeerLoadedModels = loadedModels;
  window.arcadeerClearModels = clearModels;
  window.arcadeerDrawScene = (objects) => {
    const camera = window.arcadeerActiveCamera?.();
    if (camera) drawScene(objects, camera);
  };
  window.arcadeerAdvanceAnimations = advanceAnimations;
  window.arcadeerPresent = present;
  window.arcadeerClearScreen = clearScreen;
}
