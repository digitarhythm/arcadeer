// ゲーム実行基盤（arcadeermain とクラス登録）のテスト
import { describe, expect, test, beforeEach } from "bun:test";
import {
  ArcadeerMain,
  defineClass,
  createObject,
  clearClasses,
  knownClasses,
  setClock,
  setScreenSize,
  screenSize,
  resetScreenSize,
  DEFAULT_SCREEN_WIDTH,
  DEFAULT_SCREEN_HEIGHT,
  MAX_SCREEN_SIZE,
  keyDown,
  keyUp,
  isKeyDown,
  clearKeys,
  pressedKeys,
  setObjectRegistrar,
  clearObjectRegistrar,
  stepAnimation,
  normalizeAngle,
} from "../web/runtime.js";

/** テスト用の時計 */
let now = 0;
beforeEach(() => {
  now = 0;
  setClock(() => now);
  clearClasses();
});

describe("arcadeermain の初期値", () => {
  test("座標や加速度は0から始まる", () => {
    const o = new ArcadeerMain({});
    expect([o.X, o.Y, o.Z]).toEqual([0, 0, 0]);
    expect([o.XS, o.YS, o.ZS]).toEqual([0, 0, 0]);
  });

  test("ステータス番号は0から始まる", () => {
    expect(new ArcadeerMain({}).proc).toBe(0);
  });

  test("既定値が用意されている", () => {
    const o = new ArcadeerMain({});
    expect(o.GRAVITY).toBe(0);
    expect(o.SCALEX).toBe(1);
    expect(o.SCALEY).toBe(1);
    expect(o.SCALEZ).toBe(1);
    expect(o.MODEL).toBe("primitive");
    // 既定は指定なし（@MODEL から自動で決まるようにする）
    expect(o.KIND).toBe("");
  });

  test("回転は0から始まる", () => {
    const o = new ArcadeerMain({});
    expect([o.ROTX, o.ROTY, o.ROTZ]).toEqual([0, 0, 0]);
  });

  test("回転をパラメータで指定できる", () => {
    const o = new ArcadeerMain({ ROTX: 10, ROTY: 20, ROTZ: 30 });
    expect([o.ROTX, o.ROTY, o.ROTZ]).toEqual([10, 20, 30]);
  });

  test("パラメータで上書きできる", () => {
    const o = new ArcadeerMain({ X: 10, Y: -5, MODEL: "cat.glb", KIND: "3D" });
    expect(o.X).toBe(10);
    expect(o.Y).toBe(-5);
    expect(o.MODEL).toBe("cat.glb");
    expect(o.KIND).toBe("3D");
  });

  test("パラメータ無しでも作れる", () => {
    expect(() => new ArcadeerMain()).not.toThrow();
  });
});

describe("arcadeermain の behavior", () => {
  test("加速度が座標へ加算される", () => {
    const o = new ArcadeerMain({ X: 1, Y: 2, Z: 3, XS: 10, YS: 20, ZS: 30 });
    o.behavior();
    expect([o.X, o.Y, o.Z]).toEqual([11, 22, 33]);
  });

  test("正の重力はY加速度を下向きにする", () => {
    // Yは上が正。重力は正の値で「下へ引く力」を表すため、YS からは引く
    const o = new ArcadeerMain({ GRAVITY: 2, YS: 0 });
    o.behavior();
    expect(o.YS).toBe(-2);
    o.behavior();
    expect(o.YS).toBe(-4);
  });

  test("負の重力はY加速度を上向きにする", () => {
    const o = new ArcadeerMain({ GRAVITY: -2, YS: 0 });
    o.behavior();
    expect(o.YS).toBe(2);
  });

  test("重力は座標更新の前に効く", () => {
    const o = new ArcadeerMain({ GRAVITY: 3, Y: 0, YS: 0 });
    o.behavior();
    // YS が -3 になってから Y へ加算される
    expect(o.Y).toBe(-3);
  });

  test("上向きの初速に重力がかかると放物線になる", () => {
    // 上へ跳ばして重力で戻ってくる、というゲームらしい使い方
    const o = new ArcadeerMain({ GRAVITY: 1, Y: 0, YS: 3 });
    const heights = [];
    for (let i = 0; i < 6; i += 1) {
      o.behavior();
      heights.push(o.Y);
    }
    // 上がってから下がる
    expect(heights).toEqual([2, 3, 3, 2, 0, -3]);
  });
});

describe("waitjob", () => {
  test("待機中はステータス番号が変わらない", () => {
    const o = new ArcadeerMain({});
    o.waitjob(1000);
    now = 999;
    o.behavior();
    expect(o.proc).toBe(0);
  });

  test("待機時間が過ぎるとステータス番号が進む", () => {
    const o = new ArcadeerMain({});
    o.waitjob(1000);
    now = 1000;
    o.behavior();
    expect(o.proc).toBe(1);
  });

  test("待機は一度だけ解除される", () => {
    const o = new ArcadeerMain({});
    o.waitjob(100);
    now = 100;
    o.behavior();
    now = 200;
    o.behavior();
    expect(o.proc).toBe(1);
  });

  test("待機中かどうかを問い合わせられる", () => {
    const o = new ArcadeerMain({});
    expect(o.isWaiting()).toBe(false);
    o.waitjob(500);
    expect(o.isWaiting()).toBe(true);
    now = 500;
    o.behavior();
    expect(o.isWaiting()).toBe(false);
  });
});

describe("クラスの登録と生成", () => {
  class Ship extends ArcadeerMain {}

  test("登録したクラスから生成できる", () => {
    defineClass("myship", Ship);
    const o = createObject("myship", { X: 5 });
    expect(o).toBeInstanceOf(Ship);
    expect(o.X).toBe(5);
  });

  test("登録済みのクラス名を一覧できる", () => {
    defineClass("myship", Ship);
    defineClass("enemy", Ship);
    expect(knownClasses().sort()).toEqual(["enemy", "myship"]);
  });

  test("未登録のクラスは生成できない", () => {
    expect(() => createObject("unknown", {})).toThrow();
  });

  test("クラス一覧を消せる", () => {
    defineClass("myship", Ship);
    clearClasses();
    expect(knownClasses()).toEqual([]);
  });
});

describe("addObject", () => {
  class Ship extends ArcadeerMain {}

  function parentObject() {
    const added = [];
    // 登録先はエンジン全体で1つ。個々のオブジェクトには持たせない
    setObjectRegistrar((obj) => added.push(obj));
    const parent = new ArcadeerMain({});
    return { parent, added };
  }

  test("name でクラスを指定し、生成したインスタンスの参照を返す", () => {
    defineClass("myship", Ship);
    const { parent, added } = parentObject();

    const ship = parent.addObject({ name: "myship", X: 3, Y: 4 });
    expect(ship).toBeInstanceOf(Ship);
    expect(ship.X).toBe(3);
    expect(ship.Y).toBe(4);
    // オブジェクトリストへも渡される
    expect(added).toEqual([ship]);
  });

  test("name 以外を省略できる", () => {
    defineClass("myship", Ship);
    const { parent } = parentObject();
    expect(parent.addObject({ name: "myship" }).X).toBe(0);
  });

  test("生成したオブジェクトも addObject を使える", () => {
    defineClass("myship", Ship);
    const { parent, added } = parentObject();
    const ship = parent.addObject({ name: "myship" });
    ship.addObject({ name: "myship" });
    expect(added.length).toBe(2);
  });

  test("コンストラクタの中で作ったオブジェクトも登録される", () => {
    // gameMain のコンストラクタで addObject を呼ぶ書き方に対応する
    const added = [];
    setObjectRegistrar((obj) => added.push(obj));
    defineClass("myship", Ship);
    class Boss extends ArcadeerMain {
      constructor(param) {
        super(param);
        this.ship = this.addObject({ name: "myship", X: 9 });
      }
    }
    defineClass("boss", Boss);

    const boss = createObject("boss", {});
    expect(boss.ship.X).toBe(9);
    expect(added).toEqual([boss.ship]);
  });

  test("登録先を外すと追加されない", () => {
    defineClass("myship", Ship);
    const { parent, added } = parentObject();
    clearObjectRegistrar();
    parent.addObject({ name: "myship" });
    expect(added).toEqual([]);
  });

  test("name が無ければ例外にする", () => {
    const { parent } = parentObject();
    expect(() => parent.addObject({ X: 1 })).toThrow();
    expect(() => parent.addObject()).toThrow();
  });

  test("未登録のクラス名は例外にする", () => {
    const { parent } = parentObject();
    expect(() => parent.addObject({ name: "unknown" })).toThrow();
  });
});

describe("画面解像度（setScreenSize）", () => {
  beforeEach(() => resetScreenSize());

  test("既定は640x480", () => {
    expect(screenSize()).toEqual({
      width: DEFAULT_SCREEN_WIDTH,
      height: DEFAULT_SCREEN_HEIGHT,
    });
    expect([DEFAULT_SCREEN_WIDTH, DEFAULT_SCREEN_HEIGHT]).toEqual([640, 480]);
  });

  test("指定した解像度になる", () => {
    setScreenSize(1280, 720);
    expect(screenSize()).toEqual({ width: 1280, height: 720 });
  });

  test("小数は切り捨てる", () => {
    setScreenSize(640.9, 480.7);
    expect(screenSize()).toEqual({ width: 640, height: 480 });
  });

  test("上限を超える指定は上限に収める", () => {
    setScreenSize(99999, 99999);
    expect(screenSize()).toEqual({ width: MAX_SCREEN_SIZE, height: MAX_SCREEN_SIZE });
  });

  test("0以下や数値でない指定は無視する", () => {
    setScreenSize(800, 600);
    for (const bad of [[0, 600], [800, -1], ["a", 600], [NaN, 600], [Infinity, 600]]) {
      setScreenSize(bad[0], bad[1]);
      // 直前の正しい値が保たれる
      expect(screenSize()).toEqual({ width: 800, height: 600 });
    }
  });

  test("引数が足りない場合も無視する", () => {
    setScreenSize(800, 600);
    setScreenSize(1024);
    expect(screenSize()).toEqual({ width: 800, height: 600 });
  });

  test("既定へ戻せる", () => {
    setScreenSize(1280, 720);
    resetScreenSize();
    expect(screenSize()).toEqual({ width: 640, height: 480 });
  });
});

describe("キー入力", () => {
  beforeEach(() => clearKeys());

  test("押されていないキーは false", () => {
    expect(isKeyDown("ArrowLeft")).toBe(false);
  });

  test("押すと true、離すと false になる", () => {
    keyDown("ArrowLeft");
    expect(isKeyDown("ArrowLeft")).toBe(true);
    keyUp("ArrowLeft");
    expect(isKeyDown("ArrowLeft")).toBe(false);
  });

  test("複数のキーを同時に扱える", () => {
    keyDown("ArrowLeft");
    keyDown("Space");
    expect(isKeyDown("ArrowLeft")).toBe(true);
    expect(isKeyDown("Space")).toBe(true);
    expect(pressedKeys().sort()).toEqual(["ArrowLeft", "Space"]);
  });

  test("同じキーを繰り返し押しても重複しない", () => {
    keyDown("Space");
    keyDown("Space");
    expect(pressedKeys()).toEqual(["Space"]);
  });

  test("押していないキーを離しても壊れない", () => {
    expect(() => keyUp("Space")).not.toThrow();
    expect(isKeyDown("Space")).toBe(false);
  });

  test("まとめて解除できる（ゲーム停止時）", () => {
    keyDown("ArrowLeft");
    keyDown("Space");
    clearKeys();
    expect(pressedKeys()).toEqual([]);
  });

  test("キー名以外は無視する", () => {
    keyDown(null);
    keyDown("");
    expect(pressedKeys()).toEqual([]);
  });
});

describe("アニメーションの指定（setAnimation）", () => {
  test("クリップ名を指定して再生を始める", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Walk" });
    expect(o.animation.name).toBe("Walk");
    expect(o.animation.time).toBe(0);
  });

  test("ループの既定は false", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Walk" });
    expect(o.animation.loop).toBe(false);
  });

  test("ループは明示した場合だけ true になる", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Walk", loop: true });
    expect(o.animation.loop).toBe(true);
    o.setAnimation({ name: "Run", loop: "yes" });
    expect(o.animation.loop).toBe(false);
  });

  test("再生速度の既定は1倍", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Walk" });
    expect(o.animation.speed).toBe(1);
  });

  test("再生速度を指定できる", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Walk", speed: 2.5 });
    expect(o.animation.speed).toBe(2.5);
    // 0 は一時停止として認める
    o.setAnimation({ name: "Run", speed: 0 });
    expect(o.animation.speed).toBe(0);
  });

  test("扱えない再生速度は1倍にする", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Walk", speed: -1 });
    expect(o.animation.speed).toBe(1);
    o.setAnimation({ name: "Run", speed: "fast" });
    expect(o.animation.speed).toBe(1);
  });

  test("同じクリップを指定しても再生位置は戻らない", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Walk", loop: true });
    o.animation.time = 0.4;
    o.setAnimation({ name: "Walk", loop: true });
    expect(o.animation.time).toBe(0.4);
  });

  test("ルートモーションの既定は有効（そのまま再生）", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Jump" });
    expect(o.animation.rootMotion).toBe(true);
  });

  test("ルートモーションを無効にできる", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Jump", rootMotion: false });
    expect(o.animation.rootMotion).toBe(false);
  });

  test("false 以外を指定した場合は有効のままにする", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Jump", rootMotion: "no" });
    expect(o.animation.rootMotion).toBe(true);
    o.setAnimation({ name: "Run", rootMotion: 0 });
    expect(o.animation.rootMotion).toBe(true);
  });

  test("同じクリップの再生中でもルートモーションの指定だけ切り替わる", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Jump" });
    o.animation.time = 0.4;
    o.setAnimation({ name: "Jump", rootMotion: false });
    // 再生位置は戻さずに指定だけ反映する
    expect(o.animation.time).toBe(0.4);
    expect(o.animation.rootMotion).toBe(false);
  });

  test("別のクリップを指定すると即座に切り替わる", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Walk" });
    o.animation.time = 0.4;
    o.setAnimation({ name: "Run" });
    expect(o.animation.name).toBe("Run");
    expect(o.animation.time).toBe(0);
  });

  test("切り替えると終了フラグが下りる", () => {
    const o = new ArcadeerMain({});
    o.setAnimation({ name: "Jump" });
    o.animationFinished = true;
    o.setAnimation({ name: "Walk" });
    expect(o.animationFinished).toBe(false);
  });

  test("クリップ名が無ければ例外にする", () => {
    const o = new ArcadeerMain({});
    expect(() => o.setAnimation({})).toThrow();
    expect(() => o.setAnimation()).toThrow();
  });

  test("最初はアニメーション未指定", () => {
    const o = new ArcadeerMain({});
    expect(o.animation).toBeNull();
    expect(o.animationFinished).toBe(false);
  });
});

describe("アニメーションの進行（stepAnimation）", () => {
  const anim = (extra = {}) => ({ name: "Walk", time: 0, loop: false, speed: 1, ...extra });

  test("経過時間ぶん進む", () => {
    const a = anim();
    expect(stepAnimation(a, 0.25, 1.0).time).toBeCloseTo(0.25, 6);
  });

  test("再生速度が反映される", () => {
    expect(stepAnimation(anim({ speed: 2 }), 0.25, 1.0).time).toBeCloseTo(0.5, 6);
    expect(stepAnimation(anim({ speed: 0.5 }), 0.4, 1.0).time).toBeCloseTo(0.2, 6);
  });

  test("速度0では進まない", () => {
    expect(stepAnimation(anim({ speed: 0 }), 1.0, 1.0).time).toBe(0);
  });

  test("ループしない場合は末尾で止まり、終了フラグが立つ", () => {
    const r = stepAnimation(anim({ time: 0.9 }), 0.5, 1.0);
    expect(r.time).toBeCloseTo(1.0, 6);
    expect(r.finished).toBe(true);
  });

  test("ループする場合は先頭へ戻り、終了フラグは立たない", () => {
    const r = stepAnimation(anim({ time: 0.9, loop: true }), 0.3, 1.0);
    expect(r.time).toBeCloseTo(0.2, 6);
    expect(r.finished).toBe(false);
  });

  test("長さを大きく超えてもループの位置は正しい", () => {
    const r = stepAnimation(anim({ time: 0, loop: true }), 3.25, 1.0);
    expect(r.time).toBeCloseTo(0.25, 6);
  });

  test("途中では終了フラグは立たない", () => {
    expect(stepAnimation(anim(), 0.5, 1.0).finished).toBe(false);
  });

  test("長さが0でも壊れない", () => {
    const r = stepAnimation(anim(), 0.5, 0);
    expect(Number.isFinite(r.time)).toBe(true);
    expect(r.finished).toBe(true);
  });
});

describe("色の指定（COLOR）", () => {
  test("既定は指定なし", () => {
    expect(new ArcadeerMain({}).COLOR).toBe("");
  });

  test("指定した値を保つ", () => {
    expect(new ArcadeerMain({ COLOR: "#ff8800" }).COLOR).toBe("#ff8800");
  });

  test("途中で書き換えられる", () => {
    const o = new ArcadeerMain({});
    o.COLOR = "#00ff00";
    expect(o.COLOR).toBe("#00ff00");
  });
});

describe("プリミティブの単独生成", () => {
  test("クラスファイルが無くても形状名だけで作れる", () => {
    // 組み込み形状は arcadeermain のインスタンスとして生成する
    const o = createObject("box");
    expect(o).toBeInstanceOf(ArcadeerMain);
    expect(o.MODEL).toBe("box");
  });

  test("5種類すべて作れる", () => {
    for (const name of ["box", "sphere", "plane", "cylinder", "cone"]) {
      expect(createObject(name).MODEL).toBe(name);
    }
  });

  test("大文字小文字を問わず作れる（MODELは書いたとおりに残す）", () => {
    expect(createObject("Box").MODEL).toBe("Box");
  });

  test("座標や色をまとめて指定できる", () => {
    const o = createObject("box", { X: 1, Y: 2, Z: 3, SCALEX: 20, COLOR: "#ff8800" });
    expect([o.X, o.Y, o.Z]).toEqual([1, 2, 3]);
    expect(o.SCALEX).toBe(20);
    expect(o.COLOR).toBe("#ff8800");
  });

  test("インスタンスメソッドがそのまま呼べる", () => {
    const o = createObject("box", { XS: 2, YS: 0, GRAVITY: 1 });
    o.behavior();
    expect(o.X).toBe(2);
    expect(o.YS).toBe(-1);
    // アニメーションや待機の仕組みも共通のものが使える
    expect(typeof o.waitjob).toBe("function");
    expect(typeof o.setAnimation).toBe("function");
    expect(typeof o.addObject).toBe("function");
  });

  test("MODELを明示すればそちらを使う", () => {
    expect(createObject("box", { MODEL: "sphere" }).MODEL).toBe("sphere");
  });

  test("同じ名前のクラスがあればそちらを優先する", () => {
    class box extends ArcadeerMain {}
    defineClass("box", box);
    expect(createObject("box")).toBeInstanceOf(box);
    clearClasses();
  });

  test("形状名でもクラスでもない名前は例外にする", () => {
    // 綴り間違いに早く気づけるようにする
    expect(() => createObject("torus")).toThrow();
    expect(() => createObject("myship")).toThrow();
  });
});

describe("影の指定（SHADOW）", () => {
  test("既定は影を落とす", () => {
    expect(new ArcadeerMain({}).SHADOW).toBe(true);
  });

  test("false にすると影を落とさない", () => {
    expect(new ArcadeerMain({ SHADOW: false }).SHADOW).toBe(false);
  });

  test("途中で切り替えられる", () => {
    const o = new ArcadeerMain({});
    o.SHADOW = false;
    expect(o.SHADOW).toBe(false);
  });
});

describe("behavior が受け取るフレーム情報", () => {
  test("引数を渡しても落ちない", () => {
    const o = new ArcadeerMain({ XS: 2 });
    o.behavior({ frame: 10, time: 0.166 });
    expect(o.X).toBe(2);
  });

  test("引数を渡さなくても動く（従来どおり）", () => {
    const o = new ArcadeerMain({ XS: 2 });
    o.behavior();
    expect(o.X).toBe(2);
  });

  test("継承したクラスから super(e) で渡せる", () => {
    let received = null;
    class child extends ArcadeerMain {
      behavior(e) {
        super.behavior(e);
        received = e;
      }
    }
    const o = new child({ YS: 1 });
    const event = { frame: 3, time: 0.05 };
    o.behavior(event);
    expect(received).toBe(event);
    expect(o.Y).toBe(1);
  });
});

describe("回転角の正規化", () => {
  test("0以上360未満はそのまま", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(90)).toBe(90);
    expect(normalizeAngle(359.5)).toBe(359.5);
  });

  test("0を下回ると足し戻す", () => {
    expect(normalizeAngle(-3)).toBe(357);
    expect(normalizeAngle(-90)).toBe(270);
  });

  test("360以上は引き戻す", () => {
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(370)).toBe(10);
  });

  test("何周していても収める", () => {
    expect(normalizeAngle(725)).toBe(5);
    expect(normalizeAngle(-725)).toBe(355);
  });

  test("小数も保つ", () => {
    expect(normalizeAngle(-0.5)).toBeCloseTo(359.5, 6);
    expect(normalizeAngle(360.25)).toBeCloseTo(0.25, 6);
  });

  test("数値でない値は0にする", () => {
    expect(normalizeAngle(undefined)).toBe(0);
    expect(normalizeAngle(NaN)).toBe(0);
    expect(normalizeAngle(Infinity)).toBe(0);
    expect(normalizeAngle("90")).toBe(0);
  });
});

describe("回転角は自動でそろう", () => {
  test("生成した時点でそろっている", () => {
    const o = new ArcadeerMain({ ROTX: -3, ROTY: 370, ROTZ: -725 });
    expect(o.ROTX).toBe(357);
    expect(o.ROTY).toBe(10);
    expect(o.ROTZ).toBe(355);
  });

  test("毎フレームの共通処理でそろう", () => {
    const o = new ArcadeerMain({});
    o.ROTY = -3;
    o.behavior();
    expect(o.ROTY).toBe(357);
  });

  test("回し続けても値が膨らまない", () => {
    const o = new ArcadeerMain({ ROTY: 0 });
    for (let i = 0; i < 200; i += 1) {
      o.ROTY += 2;
      o.behavior();
    }
    // 200回×2度 = 400度 → 40度
    expect(o.ROTY).toBe(40);
  });

  test("逆回しでも0を下回ったままにならない", () => {
    const o = new ArcadeerMain({ ROTY: 0 });
    for (let i = 0; i < 5; i += 1) {
      o.ROTY -= 1;
      o.behavior();
      expect(o.ROTY).toBeGreaterThanOrEqual(0);
      expect(o.ROTY).toBeLessThan(360);
    }
    expect(o.ROTY).toBe(355);
  });

  test("3軸ともそろう", () => {
    const o = new ArcadeerMain({});
    o.ROTX = -10;
    o.ROTY = 400;
    o.ROTZ = -400;
    o.behavior();
    expect([o.ROTX, o.ROTY, o.ROTZ]).toEqual([350, 40, 320]);
  });
});
