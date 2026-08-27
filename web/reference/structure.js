// リファレンスの構成（仕様書4.9節）
//
// **コードと記号は共通、翻訳が要る文だけを言語ファイルへ置く**。
// 11言語ぶん同じコードを書き写さずに済み、内容を直す時も1か所で済む。
//
// ブロックの種類
//   heading : 見出し（k: 翻訳キー）
//   text    : 本文（k: 翻訳キー）
//   code    : コード（そのまま表示。翻訳しない）
//   table   : 表（head: セルの配列 / rows: セルの配列の配列）
//
// 表のセルは2通り
//   "文字列"      … そのまま表示する（API名や記号など）
//   { k: "キー" } … その言語の文へ置き換える

/** 翻訳キーを表すセルを作る */
const t = (k) => ({ k });

export const SECTIONS = [
  {
    id: "start",
    title: "ref.start.title",
    blocks: [
      { type: "text", k: "ref.start.intro" },
      { type: "heading", k: "ref.start.h1" },
      { type: "text", k: "ref.start.d1" },
      {
        type: "code",
        code: `class gameMain extends arcadeermain
  constructor: (param) ->
    super(param)
    setScreenSize 480, 640

    @cat = @addObject
      name: "myship"
      X: 0
      Y: 0`,
      },
      { type: "heading", k: "ref.start.h2" },
      { type: "text", k: "ref.start.d2" },
      {
        type: "code",
        code: `class myship extends arcadeermain
  constructor: (param) ->
    super(param)
    @MODEL = "default-cat.glb"

  behavior: (e) ->
    super(e)
    @X -= 0.1 if isKeyDown("ArrowLeft")
    @X += 0.1 if isKeyDown("ArrowRight")`,
      },
      { type: "heading", k: "ref.start.h3" },
      { type: "text", k: "ref.start.d3" },
      {
        type: "code",
        code: `@floor = @addObject
  name: "box"
  Y: -2
  SCALEX: 20
  SCALEY: 0.5
  SCALEZ: 20
  COLOR: "#886644"`,
      },
    ],
  },

  {
    id: "basics",
    title: "ref.basics.title",
    blocks: [
      { type: "heading", k: "ref.basics.h.axis" },
      { type: "text", k: "ref.basics.d.axis" },
      {
        type: "table",
        head: [t("ref.col.axis"), t("ref.col.meaning"), t("ref.col.plus")],
        rows: [
          ["X", t("ref.axis.x"), t("ref.axis.x.plus")],
          ["Y", t("ref.axis.y"), t("ref.axis.y.plus")],
          ["Z", t("ref.axis.z"), t("ref.axis.z.plus")],
        ],
      },
      { type: "heading", k: "ref.basics.h.object" },
      { type: "text", k: "ref.basics.d.object" },
      { type: "heading", k: "ref.basics.h.frame" },
      { type: "text", k: "ref.basics.d.frame" },
      {
        type: "table",
        head: [t("ref.col.order"), t("ref.col.what")],
        rows: [
          ["1", t("ref.frame.1")],
          ["2", t("ref.frame.2")],
          ["3", t("ref.frame.3")],
          ["4", t("ref.frame.4")],
        ],
      },
      { type: "heading", k: "ref.basics.h.kind" },
      { type: "text", k: "ref.basics.d.kind" },
      {
        type: "table",
        head: [t("ref.col.value"), t("ref.col.meaning")],
        rows: [
          ['"NONE"', t("ref.kind.none")],
          ['"PRIM"', t("ref.kind.prim")],
          ['"2D"', t("ref.kind.2d")],
          ['"3D"', t("ref.kind.3d")],
        ],
      },
      { type: "heading", k: "ref.basics.h.prim" },
      { type: "text", k: "ref.basics.d.prim" },
      {
        type: "table",
        head: [t("ref.col.name"), t("ref.col.shape"), t("ref.col.size")],
        rows: [
          ["box", t("ref.prim.box"), "1 × 1 × 1"],
          ["sphere", t("ref.prim.sphere"), t("ref.size.diameter1")],
          ["plane", t("ref.prim.plane"), "1 × 1"],
          ["cylinder", t("ref.prim.cylinder"), t("ref.size.d1h1")],
          ["cone", t("ref.prim.cone"), t("ref.size.d1h1")],
        ],
      },
    ],
  },

  {
    id: "api",
    title: "ref.api.title",
    blocks: [
      { type: "heading", k: "ref.api.h.params" },
      { type: "text", k: "ref.api.d.params" },
      {
        type: "table",
        head: [t("ref.col.param"), t("ref.col.meaning"), t("ref.col.default")],
        rows: [
          ["@X @Y @Z", t("ref.p.pos"), "0"],
          ["@XS @YS @ZS", t("ref.p.vel"), "0"],
          ["@GRAVITY", t("ref.p.gravity"), "0"],
          ["@ROTX @ROTY @ROTZ", t("ref.p.rot"), "0"],
          ["@SCALEX @SCALEY @SCALEZ", t("ref.p.scale"), "1"],
          ["@MODEL", t("ref.p.model"), '""'],
          ["@KIND", t("ref.p.kind"), t("ref.p.auto")],
          ["@COLOR", t("ref.p.color"), '""'],
          ["@SHADOW", t("ref.p.shadow"), "true"],
          ["@proc", t("ref.p.proc"), "0"],
          ["@animationFinished", t("ref.p.animfin"), "false"],
        ],
      },
      { type: "heading", k: "ref.api.h.object" },
      {
        type: "table",
        head: [t("ref.col.method"), t("ref.col.what")],
        rows: [
          ["@addObject", t("ref.m.addObject")],
          ["@removeObject", t("ref.m.removeObject")],
          ["@setAnimation", t("ref.m.setAnimation")],
          ["@removeAfterAnimation", t("ref.m.removeAfterAnimation")],
          ["@waitjob", t("ref.m.waitjob")],
        ],
      },
      { type: "code", code: `@enemy = @addObject
  name: "enemy"
  X: 5
  Y: 0` },
      { type: "text", k: "ref.api.d.addObject" },
      { type: "code", code: `@removeObject 弾
@removeObject @

destructor: (e) ->
  GLOBAL.SCORE += 100` },
      { type: "text", k: "ref.api.d.removeObject" },
      { type: "code", code: `@removeAfterAnimation
  name: "Die"
  times: 1` },
      { type: "text", k: "ref.api.d.removeAfterAnimation" },
      { type: "code", code: `@setAnimation
  name: "Jump"
  loop: false
  speed: 1
  rootMotion: false` },
      { type: "text", k: "ref.api.d.setAnimation" },
      {
        type: "table",
        head: [t("ref.col.key"), t("ref.col.meaning"), t("ref.col.default")],
        rows: [
          ["name", t("ref.anim.name"), t("ref.required")],
          ["loop", t("ref.anim.loop"), "false"],
          ["speed", t("ref.anim.speed"), "1"],
          ["rootMotion", t("ref.anim.rootMotion"), "true"],
        ],
      },

      { type: "heading", k: "ref.api.h.event" },
      { type: "text", k: "ref.api.d.event" },
      {
        type: "table",
        head: [t("ref.col.key"), t("ref.col.meaning")],
        rows: [
          ["e.frame", t("ref.event.frame")],
          ["e.time", t("ref.event.time")],
        ],
      },

      { type: "heading", k: "ref.api.h.global" },
      {
        type: "table",
        head: [t("ref.col.method"), t("ref.col.what")],
        rows: [
          ["setScreenSize", t("ref.m.setScreenSize")],
          ["isKeyDown", t("ref.m.isKeyDown")],
          ["echo", t("ref.m.echo")],
          ["random", t("ref.m.random")],
          ["logClear", t("ref.m.logClear")],
          ["GLOBAL", t("ref.m.GLOBAL")],
        ],
      },
      { type: "code", code: `setScreenSize 480, 640

@X += 4 if isKeyDown("ArrowRight")

echo "X=%@ Y=%@", @X, @Y
echo "X=%08.2@", @X

GLOBAL.SCORE = 0
GLOBAL.SCORE += 100` },

      { type: "text", k: "ref.m.echo.format" },
      { type: "code", code: `@X = random 640
@fire() if random(10) is 0` },
      { type: "text", k: "ref.m.random.d" },

      { type: "heading", k: "ref.api.h.camera" },
      {
        type: "table",
        head: [t("ref.col.method"), t("ref.col.what")],
        rows: [
          ["addCamera", t("ref.m.addCamera")],
          ["setCamera", t("ref.m.setCamera")],
          ["getCamera", t("ref.m.getCamera")],
          ["setActiveCamera", t("ref.m.setActiveCamera")],
          ["removeCamera", t("ref.m.removeCamera")],
        ],
      },
      { type: "code", code: `setCamera
  X: @cat.X + 6
  Y: @cat.Y + 6
  targetX: @cat.X
  targetY: @cat.Y` },
      { type: "text", k: "ref.api.d.camera" },
      {
        type: "table",
        head: [t("ref.col.key"), t("ref.col.meaning"), t("ref.col.default")],
        rows: [
          ["X Y Z", t("ref.cam.pos"), "6 / 6 / 10"],
          ["targetX targetY targetZ", t("ref.cam.target"), "0"],
          ["lens", t("ref.cam.lens"), "29"],
          ["fov", t("ref.cam.fov"), "45"],
          ["near far", t("ref.cam.clip"), "0.1 / 1000"],
        ],
      },

      { type: "heading", k: "ref.api.h.light" },
      {
        type: "table",
        head: [t("ref.col.method"), t("ref.col.what")],
        rows: [
          ["addLight", t("ref.m.addLight")],
          ["setLight", t("ref.m.setLight")],
          ["getLight", t("ref.m.getLight")],
          ["removeLight", t("ref.m.removeLight")],
          ["setAmbient", t("ref.m.setAmbient")],
        ],
      },
      { type: "code", code: `addLight
  name: "torch"
  type: "point"
  X: 0
  Y: 2
  Z: 3
  COLOR: "#ff8800"
  range: 10` },
      { type: "text", k: "ref.api.d.light" },
      {
        type: "table",
        head: [t("ref.col.key"), t("ref.col.meaning"), t("ref.col.default")],
        rows: [
          ["type", t("ref.light.type"), '"directional"'],
          ["X Y Z", t("ref.light.pos"), "4 / 10 / 6"],
          ["COLOR", t("ref.light.color"), '"#ffffff"'],
          ["intensity", t("ref.light.intensity"), "0.8"],
          ["range", t("ref.light.range"), "20"],
          ["shadow", t("ref.light.shadow"), "false"],
        ],
      },

      { type: "heading", k: "ref.api.h.hit" },
      { type: "text", k: "ref.hit.d" },
      {
        type: "table",
        head: [t("ref.hit.col.value"), t("ref.hit.col.area"), t("ref.hit.col.scale")],
        rows: [
          [t("ref.hit.row.none"), t("ref.hit.row.none.area"), t("ref.hit.row.none.scale")],
          ["null / false", t("ref.hit.row.off.area"), "-"],
          [t("ref.hit.row.written"), t("ref.hit.row.written.area"), t("ref.hit.row.written.scale")],
        ],
      },
      { type: "code", code: `@BOUNDARY =
  shape: "box"      # "box" / "sphere" / "cylinder"
  width:  1
  height: 1
  depth:  1
  radius: 0.5       # shape: "sphere" / "cylinder" のとき
  offsetX: 0
  offsetY: 0
  offsetZ: 0` },
      { type: "text", k: "ref.hit.scale" },
      { type: "text", k: "ref.hit.ask" },
      {
        type: "table",
        head: [t("ref.col.member"), t("ref.col.meaning")],
        rows: [
          ["@intersect(相手)", t("ref.hit.intersect")],
          ["@collision(相手)", t("ref.hit.collision")],
        ],
      },
      { type: "code", code: `behavior: (e) ->
  super(e)
  if @collision(@ground)
    @Y = 0.5
    @YS = 0

  敵 = @collision(@enemies)
  @damage() if 敵` },
      { type: "text", k: "ref.hit.ret" },
      { type: "text", k: "ref.hit.debug" },
      { type: "code", code: `setDebug debug: true, opacity: 0.3` },

      { type: "heading", k: "ref.api.h.pad" },
      { type: "text", k: "ref.api.d.pad" },
      { type: "code", code: `behavior: (e) ->
  super(e)
  pad = GAMEPAD[0]

  @X -= 4 if pad.cursor[3].pressed
  @X += 4 if pad.cursor[1].pressed
  @XS = pad.axes[0][0] * 4
  @jump() if pad.button[0].pressed` },
      {
        type: "table",
        head: [t("ref.col.member"), t("ref.col.meaning")],
        rows: [
          ["cursor[0..3]", t("ref.pad.cursor")],
          ["button[0..11]", t("ref.pad.button")],
          ["axes[0..1][0..1]", t("ref.pad.axes")],
          [".pressed", t("ref.pad.pressed")],
          [".value", t("ref.pad.value")],
        ],
      },
      { type: "text", k: "ref.pad.note" },
      { type: "text", k: "ref.pad.stick" },
      { type: "code", code: `setGamepadOption
  stickAsCursor: true
  deadzone: 0.5` },
      { type: "text", k: "ref.pad.use" },
      { type: "code", code: `setGamepadOption
  use:
    cursor: true
    button: [0, 1]
    stick: ["left"]` },

      { type: "heading", k: "ref.api.h.padconf" },
      { type: "text", k: "ref.pad.config" },
      { type: "code", code: `openGamePadConfig()` },
      { type: "text", k: "ref.pad.config2" },
    ],
  },

  {
    id: "ide",
    title: "ref.ide.title",
    blocks: [
      { type: "heading", k: "ref.ide.h.project" },
      { type: "text", k: "ref.ide.d.project" },
      { type: "heading", k: "ref.ide.h.pane" },
      { type: "text", k: "ref.ide.d.pane" },
      {
        type: "table",
        head: [t("ref.col.tab"), t("ref.col.what")],
        rows: [
          [t("ref.tab.object"), t("ref.tab.object.d")],
          [t("ref.tab.image"), t("ref.tab.image.d")],
          [t("ref.tab.sound"), t("ref.tab.sound.d")],
          [t("ref.tab.model"), t("ref.tab.model.d")],
        ],
      },
      { type: "heading", k: "ref.ide.h.keys" },
      {
        type: "table",
        head: [t("ref.col.key2"), t("ref.col.what")],
        rows: [
          ["⌘S / Ctrl+S", t("ref.key.save")],
          ["⌘Enter / Ctrl+Enter", t("ref.key.run")],
          ["Esc", t("ref.key.stop")],
        ],
      },
      { type: "text", k: "ref.ide.d.keys" },
      { type: "heading", k: "ref.ide.h.footer" },
      { type: "text", k: "ref.ide.d.footer" },
    ],
  },
];

/** 構成が使っている翻訳キーをすべて集める（重複なし・出現順） */
export function referenceKeys() {
  const keys = [];
  const push = (k) => {
    if (typeof k === "string" && !keys.includes(k)) keys.push(k);
  };
  const cell = (c) => {
    if (c && typeof c === "object" && typeof c.k === "string") push(c.k);
  };
  for (const section of SECTIONS) {
    push(section.title);
    for (const block of section.blocks) {
      push(block.k);
      for (const c of block.head ?? []) cell(c);
      for (const row of block.rows ?? []) for (const c of row) cell(c);
    }
  }
  return keys;
}
