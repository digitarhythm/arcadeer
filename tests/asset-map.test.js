// アセットの対応表（キー名 ↔ ファイル名）のテスト
import { describe, expect, test } from "bun:test";
import {
  ASSET_KINDS,
  defaultKey,
  validateKey,
  parseAssetMap,
  serializeAssetMap,
  mergeFiles,
  duplicateKeys,
  lookupFile,
} from "../web/asset-map.js";

describe("扱う種別", () => {
  test("画像・音声・モデルの3種類", () => {
    expect(ASSET_KINDS).toEqual(["images", "sounds", "models"]);
  });
});

describe("ファイル名から仮のキー名を作る", () => {
  test("拡張子を落とす", () => {
    expect(defaultKey("title.png")).toBe("title");
  });

  test("使えない文字はアンダースコアにする", () => {
    expect(defaultKey("default-cat.glb")).toBe("default_cat");
    expect(defaultKey("stage 1 bgm.ogg")).toBe("stage_1_bgm");
  });

  test("数字で始まる場合は先頭にアンダースコアを足す", () => {
    // そのままだと識別子として書きにくい
    expect(defaultKey("1up.wav")).toBe("_1up");
  });

  test("拡張子が複数あっても、最後だけを落とす", () => {
    expect(defaultKey("boss.stage1.glb")).toBe("boss_stage1");
  });

  test("名前が無くなる場合は asset にする", () => {
    expect(defaultKey(".png")).toBe("asset");
    expect(defaultKey("")).toBe("asset");
    expect(defaultKey(null)).toBe("asset");
  });
});

describe("キー名の検査", () => {
  test("英数字とアンダースコアだけを通す", () => {
    expect(validateKey("cat")).toBeNull();
    expect(validateKey("boss_2")).toBeNull();
    expect(validateKey("_tmp")).toBeNull();
  });

  test("空は受け付けない", () => {
    expect(validateKey("")).toBe("empty");
    expect(validateKey("   ")).toBe("empty");
    expect(validateKey(null)).toBe("empty");
  });

  test("数字で始まるものは受け付けない", () => {
    expect(validateKey("1up")).toBe("invalid");
  });

  test("記号や空白、マルチバイトは受け付けない", () => {
    // ゲームコードへそのまま書くため、扱いやすい形に限る
    expect(validateKey("my cat")).toBe("invalid");
    expect(validateKey("cat-1")).toBe("invalid");
    expect(validateKey("ねこ")).toBe("invalid");
  });
});

describe("対応表の読み取り", () => {
  test("種別ごとに読み取る", () => {
    const toml = [
      "[images]",
      'title = "title.png"',
      "",
      "[sounds]",
      'jump = "jump.wav"',
      'bgm = "stage1.ogg"',
      "",
      "[models]",
      'cat = "default-cat.glb"',
    ].join("\n");
    expect(parseAssetMap(toml)).toEqual({
      images: { title: "title.png" },
      sounds: { jump: "jump.wav", bgm: "stage1.ogg" },
      models: { cat: "default-cat.glb" },
    });
  });

  test("知らない種別は読み飛ばす", () => {
    const map = parseAssetMap('[fonts]\nmain = "a.ttf"\n[images]\nx = "x.png"');
    expect(map.images).toEqual({ x: "x.png" });
    expect(map.fonts).toBeUndefined();
  });

  test("コメントと空行は読み飛ばす", () => {
    const map = parseAssetMap('# メモ\n[images]\n\n  # ここも\n  a = "a.png"\n');
    expect(map.images).toEqual({ a: "a.png" });
  });

  test("単引用符でも読める", () => {
    expect(parseAssetMap("[images]\na = 'a.png'").images).toEqual({ a: "a.png" });
  });

  test("読めない行は無視する", () => {
    expect(parseAssetMap("[images]\nこわれた\nb = \"b.png\"").images).toEqual({ b: "b.png" });
  });

  test("空や壊れた入力でも、3種類の入れ物を返す", () => {
    for (const input of ["", null, undefined, "でたらめ"]) {
      expect(parseAssetMap(input)).toEqual({ images: {}, sounds: {}, models: {} });
    }
  });
});

describe("対応表の書き出し", () => {
  test("種別ごとに、キー名順で書き出す", () => {
    const text = serializeAssetMap({
      images: { b: "b.png", a: "a.png" },
      sounds: {},
      models: { cat: "cat.glb" },
    });
    expect(text).toBe(
      [
        "[images]",
        'a = "a.png"',
        'b = "b.png"',
        "",
        "[sounds]",
        "",
        "[models]",
        'cat = "cat.glb"',
        "",
      ].join("\n"),
    );
  });

  test("書き出した内容は読み戻せる", () => {
    const map = { images: { a: "a.png" }, sounds: { s: "s.wav" }, models: { m: "m.glb" } };
    expect(parseAssetMap(serializeAssetMap(map))).toEqual(map);
  });

  test("中身が空でも種別の見出しは残す", () => {
    // 何を書けるのかが分かるようにしておく
    const text = serializeAssetMap({ images: {}, sounds: {}, models: {} });
    expect(text).toBe("[images]\n\n[sounds]\n\n[models]\n");
  });
});

describe("実際のファイルと突き合わせる", () => {
  const files = { images: ["title.png"], sounds: ["jump.wav"], models: ["default-cat.glb"] };

  test("対応表に無いファイルは、仮のキー名で足す", () => {
    const merged = mergeFiles({ images: {}, sounds: {}, models: {} }, files);
    expect(merged.images).toEqual({ title: "title.png" });
    expect(merged.models).toEqual({ default_cat: "default-cat.glb" });
  });

  test("既にあるキー名は変えない", () => {
    const merged = mergeFiles(
      { images: {}, sounds: {}, models: { cat: "default-cat.glb" } },
      files,
    );
    expect(merged.models).toEqual({ cat: "default-cat.glb" });
  });

  test("消えたファイルの行は落とす", () => {
    const merged = mergeFiles(
      { images: { old: "old.png" }, sounds: {}, models: {} },
      files,
    );
    expect(merged.images).toEqual({ title: "title.png" });
  });

  test("仮のキー名が既に使われていれば、番号を足す", () => {
    const merged = mergeFiles(
      { images: { title: "other.png" }, sounds: {}, models: {} },
      { images: ["title.png", "other.png"], sounds: [], models: [] },
    );
    expect(merged.images).toEqual({ title: "other.png", title2: "title.png" });
  });
});

describe("キー名の重複", () => {
  test("種別をまたいで重なっていれば見つける", () => {
    // ゲームコードからは種別を書かずに引くため、全体で一意にする
    const dup = duplicateKeys({
      images: { cat: "cat.png" },
      sounds: {},
      models: { cat: "cat.glb" },
    });
    expect(dup).toEqual(["cat"]);
  });

  test("重なりが無ければ空", () => {
    expect(duplicateKeys({ images: { a: "a.png" }, sounds: { b: "b.wav" }, models: {} }))
      .toEqual([]);
  });
});

describe("キー名からファイル名を引く", () => {
  const map = {
    images: { title: "title.png" },
    sounds: { jump: "jump.wav" },
    models: { cat: "default-cat.glb" },
  };

  test("種別を問わず引ける", () => {
    expect(lookupFile(map, "cat")).toBe("default-cat.glb");
    expect(lookupFile(map, "jump")).toBe("jump.wav");
  });

  test("登録が無ければ null", () => {
    // 呼び出し側は、これまでどおりファイル名として扱えばよい
    expect(lookupFile(map, "default-cat.glb")).toBeNull();
    expect(lookupFile(map, "")).toBeNull();
    expect(lookupFile(null, "cat")).toBeNull();
  });
});
