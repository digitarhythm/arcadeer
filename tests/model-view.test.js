// 3Dモデルの詳細表示（正面プレビューとアニメーション一覧）のテスト
import { describe, expect, test } from "bun:test";
import { frontEye, clipList, copyToClipboard } from "../web/model-view.js";

describe("正面から見るカメラ", () => {
  test("モデルの手前（-Z側）に置く", () => {
    // ゲームの決まりでは -Z が前方。背中側から見ないようにする
    const eye = frontEye({ center: [0, 1, 0], radius: 1 });
    expect(eye[2]).toBeLessThan(0);
  });

  test("高さは中心に合わせる", () => {
    // 見上げ・見下ろしをせず、正面から見る
    const eye = frontEye({ center: [0, 1.2, 0], radius: 1 });
    expect(eye[1]).toBeCloseTo(1.2, 6);
  });

  test("左右にも寄らない", () => {
    expect(frontEye({ center: [0.5, 0, 0], radius: 1 })[0]).toBeCloseTo(0.5, 6);
  });

  test("大きいモデルほど離れる", () => {
    const near = frontEye({ center: [0, 0, 0], radius: 1 })[2];
    const far = frontEye({ center: [0, 0, 0], radius: 4 })[2];
    expect(Math.abs(far)).toBeGreaterThan(Math.abs(near));
  });

  test("大きさが取れない場合でも位置を返す", () => {
    // 0除算やNaNで描画が止まらないように
    const eye = frontEye({ center: [0, 0, 0], radius: 0 });
    expect(eye.every((v) => Number.isFinite(v))).toBe(true);
    expect(frontEye(null).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("アニメーション一覧", () => {
  test("名前と長さを取り出す", () => {
    const rows = clipList([
      { name: "Walk", duration: 1 },
      { name: "Down", duration: 1.4 },
    ]);
    expect(rows).toEqual([
      { name: "Walk", duration: 1 },
      { name: "Down", duration: 1.4 },
    ]);
  });

  test("モデルの並び順のまま（並べ替えない）", () => {
    // 作った側の意図した順で見せる
    const rows = clipList([{ name: "Zzz", duration: 1 }, { name: "Aaa", duration: 1 }]);
    expect(rows.map((r) => r.name)).toEqual(["Zzz", "Aaa"]);
  });

  test("名前が無いものは飛ばす", () => {
    expect(clipList([{ duration: 1 }, { name: "", duration: 1 }, { name: "OK", duration: 1 }]))
      .toEqual([{ name: "OK", duration: 1 }]);
  });

  test("長さが読めなければ0にする", () => {
    expect(clipList([{ name: "X" }])).toEqual([{ name: "X", duration: 0 }]);
  });

  test("空や未指定でも落ちない", () => {
    expect(clipList(null)).toEqual([]);
    expect(clipList([])).toEqual([]);
  });
});

describe("クリップボードへのコピー", () => {
  test("書き込めたら true", async () => {
    const written = [];
    const api = { writeText: async (text) => { written.push(text); } };
    expect(await copyToClipboard("Walk", api)).toBe(true);
    expect(written).toEqual(["Walk"]);
  });

  test("書き込めなければ false", async () => {
    // 権限が無い・安全な文脈でない場合に落ちないようにする
    const api = { writeText: async () => { throw new Error("denied"); } };
    expect(await copyToClipboard("Walk", api)).toBe(false);
  });

  test("使えない環境では代替手段を試す", async () => {
    // navigator.clipboard は「利用者の操作の直後」しか使えないことがある。
    // 断られた時に黙って諦めない
    const tried = [];
    const fallback = (text) => { tried.push(text); return true; };
    expect(await copyToClipboard("Walk", null, fallback)).toBe(true);
    expect(await copyToClipboard("Walk", {}, fallback)).toBe(true);
    expect(tried).toEqual(["Walk", "Walk"]);
  });

  test("本命が断られた時も代替手段へ回す", async () => {
    const tried = [];
    const api = { writeText: async () => { throw new Error("denied"); } };
    expect(await copyToClipboard("Run", api, (t) => { tried.push(t); return true; })).toBe(true);
    expect(tried).toEqual(["Run"]);
  });

  test("代替手段も駄目なら false", async () => {
    expect(await copyToClipboard("Walk", null, () => false)).toBe(false);
  });

  test("空文字はコピーしない", async () => {
    const api = { writeText: async () => {} };
    expect(await copyToClipboard("", api)).toBe(false);
  });
});
