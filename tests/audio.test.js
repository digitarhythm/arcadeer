// 音の土台（web/audio.js）のテスト
//
// ブラウザは利用者の操作（タップ／クリック）があるまで音を鳴らせない。
// 起動時のバナー画面でのタップを受けて共有の AudioContext を動かし、
// 以降の音の再生はすべてこの1つを使う。
import { beforeEach, describe, expect, test } from "bun:test";
import { audioContext, unlockAudio, resetAudio, setAudioContextClass } from "../web/audio.js";

/** 偽の AudioContext。state と resume() の呼び出し回数だけを持つ */
class FakeAudioContext {
  static created = 0;
  constructor() {
    FakeAudioContext.created += 1;
    this.state = "suspended";
    this.resumed = 0;
  }
  resume() {
    this.resumed += 1;
    this.state = "running";
    return Promise.resolve();
  }
}

beforeEach(() => {
  FakeAudioContext.created = 0;
  resetAudio();
  setAudioContextClass(FakeAudioContext);
});

describe("共有の AudioContext", () => {
  test("最初に求められた時に1つだけ作り、以後は同じものを返す", () => {
    const a = audioContext();
    const b = audioContext();
    expect(a).toBe(b);
    expect(FakeAudioContext.created).toBe(1);
  });

  test("求められるまでは作らない", () => {
    expect(FakeAudioContext.created).toBe(0);
  });

  test("ブラウザが Web Audio に対応していなければ null", () => {
    setAudioContextClass(null);
    expect(audioContext()).toBeNull();
  });
});

describe("音の解放（unlockAudio）", () => {
  test("止まっていれば resume して true を返す", async () => {
    await expect(unlockAudio()).resolves.toBe(true);
    const ctx = audioContext();
    expect(ctx.resumed).toBe(1);
    expect(ctx.state).toBe("running");
  });

  test("すでに動いていれば resume を呼ばず true", async () => {
    await unlockAudio();
    await expect(unlockAudio()).resolves.toBe(true);
    expect(audioContext().resumed).toBe(1);
  });

  test("Web Audio が無ければ false", async () => {
    setAudioContextClass(null);
    await expect(unlockAudio()).resolves.toBe(false);
  });

  test("resume が失敗しても例外を外へ出さず false", async () => {
    class Failing extends FakeAudioContext {
      resume() {
        return Promise.reject(new Error("blocked"));
      }
    }
    setAudioContextClass(Failing);
    await expect(unlockAudio()).resolves.toBe(false);
  });
});
