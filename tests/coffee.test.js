// コンパイルエラーの表示形式のテスト
// （コンパイラ本体はCDNから読み込むため、ここでは整形処理だけを検証する）
import { describe, expect, test } from "bun:test";
import {
  formatCompileError,
  instantiate,
  lastInstantiateError,
} from "../web/coffee.js";
import { ArcadeerMain, defineClass, clearClasses } from "../web/runtime.js";

describe("コンパイルエラーの表示", () => {
  test("ファイル名と行・桁を添える", () => {
    // CoffeeScript の location は0起点なので、表示は1起点にする
    const err = { message: "unexpected indentation", location: { first_line: 5, first_column: 0 } };
    expect(formatCompileError("gameMain", err)).toBe(
      "gameMain.coffee:6:1 unexpected indentation",
    );
  });

  test("桁が途中でも正しく足す", () => {
    const err = { message: "unexpected", location: { first_line: 0, first_column: 4 } };
    expect(formatCompileError("myship", err)).toBe("myship.coffee:1:5 unexpected");
  });

  test("位置情報が無ければファイル名だけ添える", () => {
    expect(formatCompileError("enemy", { message: "boom" })).toBe("enemy.coffee: boom");
  });

  test("行番号だけある場合も扱える", () => {
    const err = { message: "boom", location: { first_line: 2 } };
    expect(formatCompileError("enemy", err)).toBe("enemy.coffee:3:1 boom");
  });

  test("文字列で投げられた場合も扱える", () => {
    expect(formatCompileError("enemy", "boom")).toBe("enemy.coffee: boom");
  });

  test("メッセージが無い場合も壊れない", () => {
    expect(formatCompileError("enemy", {})).toContain("enemy.coffee");
  });
});

describe("生成に失敗した時の通知", () => {
  test("成功した場合は理由が残らない", () => {
    clearClasses();
    class ok extends ArcadeerMain {}
    defineClass("ok", ok);
    expect(instantiate("ok")).toBeInstanceOf(ok);
    expect(lastInstantiateError()).toBeNull();
    clearClasses();
  });

  test("コンストラクタで例外が出たら理由を残す", () => {
    clearClasses();
    class broken extends ArcadeerMain {
      constructor(param) {
        super(param);
        throw new Error("something went wrong");
      }
    }
    defineClass("broken", broken);

    expect(instantiate("broken")).toBeNull();
    const reason = lastInstantiateError();
    expect(reason).toContain("broken");
    expect(reason).toContain("something went wrong");
    clearClasses();
  });

  test("クラスが見つからない場合も理由を残す", () => {
    clearClasses();
    expect(instantiate("missing")).toBeNull();
    expect(lastInstantiateError()).toContain("missing");
  });

  test("次に成功したら前の理由は消える", () => {
    clearClasses();
    instantiate("missing");
    expect(lastInstantiateError()).not.toBeNull();

    class ok extends ArcadeerMain {}
    defineClass("ok", ok);
    instantiate("ok");
    expect(lastInstantiateError()).toBeNull();
    clearClasses();
  });

  test("例外以外が投げられても文字列にする", () => {
    clearClasses();
    class odd extends ArcadeerMain {
      constructor(param) {
        super(param);
        throw "文字列の例外";
      }
    }
    defineClass("odd", odd);
    instantiate("odd");
    expect(lastInstantiateError()).toContain("文字列の例外");
    clearClasses();
  });
});
