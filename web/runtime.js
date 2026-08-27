// ゲーム実行基盤
//
// ユーザーが書くクラスの共通スーパークラス（arcadeermain）と、
// クラス名からインスタンスを生成する仕組みを提供する。
// CoffeeScriptのコンパイルは coffee.js が担当し、ここは実行時の土台だけを持つ。

import { isPrimitiveName } from "./primitive.js";
import { findHit } from "./collision.js";

/** 現在時刻（ミリ秒）を返す関数。テストから差し替えられるようにする */
let clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** 時計を差し替える（テスト用） */
export function setClock(fn) {
  clock = fn;
}

/** 既定の画面解像度（ゲーム内の座標系） */
export const DEFAULT_SCREEN_WIDTH = 640;
export const DEFAULT_SCREEN_HEIGHT = 480;
/** 描画バッファが大きくなりすぎないための上限 */
export const MAX_SCREEN_SIZE = 4096;

/** 現在の画面解像度 */
let screen = { width: DEFAULT_SCREEN_WIDTH, height: DEFAULT_SCREEN_HEIGHT };

/** 解像度として使える値か（正の有限数のみ） */
function validSize(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
}

/**
 * ゲーム内の画面解像度を指定する
 *
 * canvas の**内部解像度**（描画バッファ）になる。画面上の表示サイズは
 * ブラウザの大きさから決まるため、ここで指定した座標系のまま拡大縮小される。
 * 不正な値は無視して直前の指定を保つ。
 */
export function setScreenSize(width, height) {
  if (!validSize(width) || !validSize(height)) return;
  screen = {
    width: Math.min(Math.floor(width), MAX_SCREEN_SIZE),
    height: Math.min(Math.floor(height), MAX_SCREEN_SIZE),
  };
}

/** 現在の画面解像度を返す */
export function screenSize() {
  return { ...screen };
}

/** 既定の解像度へ戻す（ゲーム停止・作り直し時に使う） */
export function resetScreenSize() {
  screen = { width: DEFAULT_SCREEN_WIDTH, height: DEFAULT_SCREEN_HEIGHT };
}

/** 現在押されているキー（KeyboardEvent.code） */
const keys = new Set();

/** キーが押された */
export function keyDown(code) {
  if (typeof code === "string" && code !== "") keys.add(code);
}

/** キーが離された */
export function keyUp(code) {
  keys.delete(code);
}

/** そのキーが押されているか（ゲームコードから使う） */
export function isKeyDown(code) {
  return keys.has(code);
}

/** 押されているキーの一覧 */
export function pressedKeys() {
  return [...keys];
}

/** 押下状態をすべて解除する（ゲーム停止時に使う） */
export function clearKeys() {
  keys.clear();
}

/**
 * 生成したオブジェクトをオブジェクトリストへ渡す関数
 *
 * エンジン全体で1つだけ持つ。個々のオブジェクトへ後から差し込む形にすると、
 * **コンストラクタの中で addObject を呼んだ場合に間に合わない**ため。
 */
let registrar = null;

/** 登録先を差し込む（エンジンが実行開始時に設定する） */
export function setObjectRegistrar(fn) {
  registrar = fn;
}

/** 登録先を外す（ゲーム停止時） */
export function clearObjectRegistrar() {
  registrar = null;
}

/**
 * 削除の予約先（エンジンが差し込む）
 *
 * 実際に取り除くのはフレーム末。走査の途中で配列が変わると、
 * 呼び出し順が崩れてしまうため。
 */
let remover = null;

/** 削除の予約先を差し込む（エンジンが実行開始時に設定する） */
export function setObjectRemover(fn) {
  remover = fn;
}

/** 削除の予約先を外す（ゲーム停止時） */
export function clearObjectRemover() {
  remover = null;
}

/**
 * オブジェクトの削除を予約する（仕様書6.2節）
 *
 * ゲームコードからは `@removeObject` を使う。こちらはエンジンの内部用で、
 * アニメーションを再生し終えたものを消す時にも通る。
 *
 * 登録されていないものを渡した場合は何もしない。
 */
export function removeFromList(object) {
  const id = object?._objectId;
  if (typeof id !== "number") return;
  remover?.(id);
}

/**
 * アニメーションの再生位置を進める
 *
 * @param anim `{ time, loop, speed }`
 * @param deltaSec 経過時間（秒）
 * @param duration クリップの長さ（秒）
 * @returns `{ time, finished }`
 */
export function stepAnimation(anim, deltaSec, duration) {
  // 長さが無いクリップは、進めずに終了扱いにする。
  // 回数を数える側を待たせ続けないよう、1回ぶん再生したものとして返す
  if (!(duration > 0)) {
    return { time: 0, finished: true, plays: 1 };
  }

  const time = anim.time + deltaSec * anim.speed;
  if (time < duration) {
    return { time, finished: false, plays: 0 };
  }
  if (anim.loop) {
    // 何周ぶん過ぎていても正しい位置に戻す
    return { time: time % duration, finished: false, plays: Math.floor(time / duration) };
  }
  // ループしない場合は末尾で止める
  return { time: duration, finished: true, plays: 1 };
}

/**
 * オブジェクトのアニメーションを1フレームぶん進める
 *
 * 進めた結果をオブジェクトへ書き戻し、**消す頃合いかどうか**を返す。
 * 回数を数える場所を1か所にまとめてあるため、描画側に依存せず試せる。
 *
 * @returns `removeAfterAnimation` で指定した回数を再生し終えたら true
 */
export function stepObjectAnimation(object, deltaSec, duration) {
  const anim = object?.animation;
  if (!anim) return false;

  const result = stepAnimation(anim, deltaSec, duration);
  anim.time = result.time;
  object.animationFinished = result.finished;

  if (!anim.removeAtEnd) return false;
  anim.played += result.plays;
  return anim.played >= anim.times;
}

/** 1周ぶんの角度 */
const FULL_TURN = 360;

/**
 * 回転角を **0以上360未満**に収める
 *
 * `-3` は `357` に、`370` は `10` になる。何周していても収まる。
 * 回し続けても値が際限なく膨らまないようにするためで、
 * 見た目は変わらないが、角度を比べる処理が書きやすくなる。
 *
 * 数値として扱えない値は `0` にする。
 */
export function normalizeAngle(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return ((value % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/** クラス名 → クラス の対応表 */
const classes = new Map();

/** クラスを登録する */
export function defineClass(name, klass) {
  classes.set(name, klass);
}

/** 登録済みのクラス名を返す */
export function knownClasses() {
  return [...classes.keys()];
}

/** 登録を全て消す（ゲーム停止・作り直し時に使う） */
export function clearClasses() {
  classes.clear();
}

/**
 * クラス名からインスタンスを生成する
 *
 * **組み込みプリミティブの形状名は、クラスファイルが無くても生成できる**（6.2.5節）。
 * 床や弾のように処理を持たないものへ、いちいちクラスを用意しなくて済むように。
 * その場合は共通スーパークラス `arcadeermain` のインスタンスになるため、
 * `waitjob` や `setAnimation` などのメソッドはそのまま使える。
 *
 * ```coffee
 * @floor = @addObject
 *   name: "box"
 *   Y: -2
 *   SCALEX: 20
 * ```
 *
 * 同じ名前のクラスファイルがある場合は**そちらを優先する**。
 * 形状名でもクラス名でもない場合は例外にする（綴り間違いを早く気づけるように）。
 */
export function createObject(name, param = {}) {
  const klass = classes.get(name);
  if (klass) return new klass(param);

  if (isPrimitiveName(name)) {
    // 形状名をそのまま @MODEL にする。明示された @MODEL があればそちらを立てる
    return new ArcadeerMain({ ...param, MODEL: param.MODEL ?? name });
  }
  throw new Error(`class not found: ${name}`);
}

/**
 * ユーザーが書くクラスの共通スーパークラス
 *
 * 仕様書6.3節のパラメータを持ち、`behavior` で加速度と座標を更新する。
 */
export class ArcadeerMain {
  constructor(param = {}) {
    // 座標と加速度
    this.X = param.X ?? 0;
    this.Y = param.Y ?? 0;
    this.Z = param.Z ?? 0;
    this.XS = param.XS ?? 0;
    this.YS = param.YS ?? 0;
    this.ZS = param.ZS ?? 0;

    // 毎フレーム Y加速度へ効く。**正の値が下向きの力**（Yは上が正）
    this.GRAVITY = param.GRAVITY ?? 0;

    // 各軸まわりの回転（度）。Z → X → Y の順に効く。
    // 0以上360未満へそろえる（6.2.8節）
    this.ROTX = normalizeAngle(param.ROTX ?? 0);
    this.ROTY = normalizeAngle(param.ROTY ?? 0);
    this.ROTZ = normalizeAngle(param.ROTZ ?? 0);

    this.SCALEX = param.SCALEX ?? 1;
    this.SCALEY = param.SCALEY ?? 1;
    this.SCALEZ = param.SCALEZ ?? 1;

    // 表示に使うアセット（IDEはこの値をサムネイルに使う）
    this.MODEL = param.MODEL ?? "primitive";
    // 0:2D / 1:3D
    // 種別。"PRIM" / "2D" / "3D"（数値の 0 / 1 / 2 も可）。
    // 既定は**指定なし**。この場合は @MODEL の内容から自動で決める（6.2.5節）
    this.KIND = param.KIND ?? "";

    // 描画色。空なら素材そのままの色で描く（`"#ff8800"` のように指定する）
    this.COLOR = param.COLOR ?? "";

    // 影を落とすか。false にすると、このオブジェクトは影を作らない（6.2.6節）
    this.SHADOW = param.SHADOW ?? true;

    // 当たり判定に使う範囲（5.5節）。
    // **書かなければ見た目そのもの**が範囲になる（拡大縮小が効く）。
    // 自分で書いた場合は見た目と切り離され、@SCALE や @ROT に影響されない。
    // null や false を入れれば、判定を持たせないこともできる。
    //
    // `?? null` にしてはいけない。「書かない」と「外す」を区別できなくなる
    if (param.BOUNDARY !== undefined) this.BOUNDARY = param.BOUNDARY;

    // ステータス番号
    this.proc = param.proc ?? 0;

    /** 再生中のアニメーション。未指定のときは null */
    this.animation = null;
    /** ループしないクリップが最後まで再生されたか */
    this.animationFinished = false;

    /** waitjob の解除時刻。待機していないときは null */
    this._waitUntil = null;
    /** 待機が明けたときに進めるステータス番号 */
    this._waitNext = 0;
  }

  /** 待機中かどうか */
  isWaiting() {
    return this._waitUntil !== null;
  }

  /**
   * 指定ミリ秒だけ待ってから、ステータス番号を次へ進める
   *
   * 待機中は `proc` が変わらないため、`switch @proc` の分岐はそのまま保たれる。
   */
  waitjob(millsec) {
    this._waitUntil = clock() + millsec;
    this._waitNext = this.proc + 1;
  }

  /**
   * 毎フレーム呼ばれる共通処理
   *
   * 待機の解除 → 重力の加算 → 座標の更新 の順に行う。
   * ユーザーのクラスは `super(e)` でこれを呼んでから独自処理を書く。
   *
   * `e` にはそのフレームの情報が入る（6.2.8節）。
   * ここでは使わないが、`super(e)` と書けるよう受け取っておく。
   *
   * ```coffee
   * behavior: (e) ->
   *   super(e)
   *   echo "%@ フレーム目", e.frame
   * ```
   */
  // eslint-disable-next-line no-unused-vars
  behavior(e) {
    if (this._waitUntil !== null && clock() >= this._waitUntil) {
      this.proc = this._waitNext;
      this._waitUntil = null;
    }

    // Yは上が正。重力は正の値で「下へ引く力」を表すため、YS からは引く
    this.YS -= this.GRAVITY;
    this.X += this.XS;
    this.Y += this.YS;
    this.Z += this.ZS;

    // 回転角を 0以上360未満へそろえる。
    // 回し続けても値が際限なく膨らまないようにするため
    this.ROTX = normalizeAngle(this.ROTX);
    this.ROTY = normalizeAngle(this.ROTY);
    this.ROTZ = normalizeAngle(this.ROTZ);
  }

  /**
   * オブジェクトを消す（仕様書6.2節）
   *
   * ```coffee
   * @removeObject 弾      # 別のオブジェクトを消す
   * @removeObject @       # 自分自身を消す
   * ```
   *
   * **消えるのは渡した相手**で、呼び出し元ではない。
   * 自分を消したい場合は自分を渡す。
   *
   * このフレームの走査が終わった時点で、**`destructor(e)` が呼ばれてから**
   * 一覧から外れる。以後は描画もされず、参照が切れれば後始末に回る。
   *
   * 登録されていないものを渡した場合は何もしない。
   */
  removeObject(target) {
    removeFromList(target);
  }

  /**
   * アニメーションを指定した回数だけ再生し、そのあと自分自身を消す
   *
   * ```coffee
   * @removeAfterAnimation
   *   name: "Die"
   *   times: 1        # 省略すると1回
   * ```
   *
   * 弾の着弾や敵の撃破のように、**演出を見せてから消したい**場面で使う。
   * 引数は `setAnimation` と同じものを受け取る。
   *
   * 再生し終えると `removeObject` と同じ流れに入り、`destructor(e)` が
   * 呼ばれてから一覧を外れる（6.2節）。
   */
  removeAfterAnimation(param) {
    const times = param?.times;
    // 2回以上ならループさせないと、2周目が再生されない
    const 回数 = Number.isInteger(times) && times > 0 ? times : 1;
    this.setAnimation({ ...param, loop: 回数 > 1 });
    this.animation.times = 回数;
    this.animation.played = 0;
    this.animation.removeAtEnd = true;
  }

  /**
   * 相手と重なっているかを調べる（**奥行きを見ない**）
   *
   * 見下ろし型や横スクロールのように、Z方向を気にしない遊びで使う。
   *
   * ```coffee
   * @damage() if @intersect(@enemy)
   * 敵 = @intersect(@enemies)      # 配列も渡せる
   * ```
   *
   * @returns 当たった相手。当たっていなければ null
   */
  intersect(target) {
    return findHit(this, target, "2d");
  }

  /**
   * 相手と衝突しているかを調べる（XYZ すべてを見る）
   *
   * **呼んだ瞬間の位置**で判断するため、動かした直後に聞いて、
   * その場で戻す、という書き方ができる。
   *
   * ```coffee
   * behavior: (e) ->
   *   super(e)
   *   if @collision(@ground)
   *     @Y = 0.5
   *     @YS = 0
   * ```
   *
   * @returns 当たった相手。当たっていなければ null
   */
  collision(target) {
    return findHit(this, target);
  }

  /**
   * 再生するアニメーションを指定する
   *
   * ```coffee
   * @setAnimation
   *   name: "Run"
   *   loop: true
   *   speed: 1.5
   * ```
   *
   * - **同じクリップを指定した場合は何もしない**（再生位置を戻さない）
   * - 別のクリップを指定すると**即座に切り替わる**
   * - `loop` の既定は `false`。繰り返すには明示的に `true` を指定する
   * - `speed` の既定は `1`。`0` は一時停止として扱う
   * - `rootMotion` の既定は `true`（クリップをそのまま再生する）
   *
   * ゲーム側で位置を制御しながらクリップの姿勢だけを使いたい場合は
   * `rootMotion: false` を指定する。ジャンプのように上下移動を含むクリップを
   * 重力や速度と組み合わせると、移動が二重に効いてしまうため。
   *
   * ```coffee
   * @YS = -12                  # 位置はゲームが制御する
   * @setAnimation
   *   name: "Jump"
   *   rootMotion: false        # 姿勢だけを使う
   * ```
   *
   * `rootMotion` は**同じクリップの再生中でも切り替えられる**（再生位置は戻らない）。
   */
  setAnimation(param) {
    const name = param?.name;
    if (typeof name !== "string" || name === "") {
      throw new Error("setAnimation: name is required");
    }
    // ルートモーションは既定で有効。無効化は false を明示した場合だけ
    const rootMotion = param.rootMotion !== false;

    // 同じクリップなら継続する（ルートモーションの指定だけは反映する）
    if (this.animation?.name === name) {
      this.animation.rootMotion = rootMotion;
      return;
    }

    const speed = param.speed;
    this.animation = {
      name,
      time: 0,
      // ループは明示された場合だけ
      loop: param.loop === true,
      speed: typeof speed === "number" && Number.isFinite(speed) && speed >= 0 ? speed : 1,
      rootMotion,
    };
    this.animationFinished = false;
  }

  /**
   * オブジェクトを生成してオブジェクトリストへ追加し、**その参照を返す**
   *
   * 引数は**すべてキー指定**で、`name` にクラス名を書く。
   *
   * ```coffee
   * @myship = @addObject
   *   name: "myship"
   *   X: 0
   *   Y: 0
   *   Z: 0
   * ```
   */
  addObject(param) {
    const name = param?.name;
    if (typeof name !== "string" || name === "") {
      throw new Error("addObject: name is required");
    }
    const object = createObject(name, param);
    // 受け取った識別子は、消す時に使う
    const id = registrar?.(object);
    if (typeof id === "number") object._objectId = id;
    return object;
  }
}

if (typeof window !== "undefined") {
  window.arcadeermain = ArcadeerMain;
  // WASM側が canvas の内部解像度を設定するために参照する
  window.arcadeerScreenSize = screenSize;
  window.arcadeerKeyDown = keyDown;
  window.arcadeerKeyUp = keyUp;
  window.arcadeerClearKeys = clearKeys;
  window.arcadeerStepAnimation = stepAnimation;
  window.arcadeerSetObjectRegistrar = setObjectRegistrar;
  window.arcadeerClearObjectRegistrar = clearObjectRegistrar;
  window.arcadeerSetObjectRemover = setObjectRemover;
  window.arcadeerClearObjectRemover = clearObjectRemover;
}
