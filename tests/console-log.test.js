// フッターのログ履歴と echo() の書式化のテスト
import { beforeEach, describe, expect, test } from "bun:test";

import {
  MAX_LOG_LINES,
  formatEcho,
  pushLog,
  logLines,
  clearLogs,
  echo,
  logClear,
} from "../web/console-log.js";

beforeEach(() => clearLogs());

describe("echo の書式化", () => {
  test("%@ が引数で置き換わる", () => {
    expect(formatEcho("%@, %@", "a", "b")).toBe("a, b");
  });

  test("数値や真偽値も文字列にする", () => {
    expect(formatEcho("x=%@ ok=%@", 12, true)).toBe("x=12 ok=true");
  });

  test("引数が足りない場合は %@ をそのまま残す", () => {
    // 書き間違いに気づけるよう、黙って空にはしない
    expect(formatEcho("%@ と %@", "a")).toBe("a と %@");
  });

  test("引数が余った場合は末尾へ空白区切りで並べる", () => {
    expect(formatEcho("%@", "a", "b", "c")).toBe("a b c");
  });

  test("%% は % そのものにする", () => {
    expect(formatEcho("100%% 完了")).toBe("100% 完了");
  });

  test("%% は置き換えの対象にならない", () => {
    expect(formatEcho("%%@ %@", "a")).toBe("%@ a");
  });

  test("null と undefined が分かるように出す", () => {
    expect(formatEcho("%@ %@", null, undefined)).toBe("null undefined");
  });

  test("オブジェクトはJSONにする", () => {
    expect(formatEcho("%@", { x: 1 })).toBe('{"x":1}');
  });

  test("循環参照のオブジェクトでも落ちない", () => {
    const o = { name: "loop" };
    o.self = o;
    expect(typeof formatEcho("%@", o)).toBe("string");
  });

  test("書式が文字列でなければ、すべて空白区切りで並べる", () => {
    expect(formatEcho(42, "a")).toBe("42 a");
    expect(formatEcho()).toBe("");
  });

  test("置き換えた文字列の中の %@ は再解釈しない", () => {
    expect(formatEcho("%@ %@", "%@", "b")).toBe("%@ b");
  });
});

describe("ログ履歴", () => {
  test("新しいものが末尾に積まれる", () => {
    pushLog("1件目");
    pushLog("2件目");
    expect(logLines()).toEqual(["1件目", "2件目"]);
  });

  test("保持するのは1000行", () => {
    expect(MAX_LOG_LINES).toBe(1000);
  });

  test("上限を超えると古いものから捨てる", () => {
    for (let i = 0; i < MAX_LOG_LINES + 10; i += 1) pushLog(`行${i}`);
    const lines = logLines();
    expect(lines.length).toBe(MAX_LOG_LINES);
    // 最も古い10件が消えている
    expect(lines[0]).toBe("行10");
    expect(lines[lines.length - 1]).toBe(`行${MAX_LOG_LINES + 9}`);
  });

  test("履歴を消せる", () => {
    pushLog("消える");
    clearLogs();
    expect(logLines()).toEqual([]);
  });

  test("取り出した配列を書き換えても履歴は壊れない", () => {
    pushLog("a");
    logLines().push("b");
    expect(logLines()).toEqual(["a"]);
  });

  test("上限ちょうどでは捨てない", () => {
    for (let i = 0; i < MAX_LOG_LINES; i += 1) pushLog(`行${i}`);
    expect(logLines().length).toBe(MAX_LOG_LINES);
    expect(logLines()[0]).toBe("行0");
  });
});

describe("echo", () => {
  test("書式化した内容が履歴へ積まれる", () => {
    echo("%@ + %@ = %@", 1, 2, 3);
    expect(logLines()).toEqual(["1 + 2 = 3"]);
  });

  test("書式化した内容を返す", () => {
    expect(echo("%@", "戻り値")).toBe("戻り値");
  });
});

describe("logClear", () => {
  test("履歴を空にする", () => {
    echo("%@", "残らない");
    echo("%@", "これも");
    logClear();
    expect(logLines()).toEqual([]);
  });

  test("消したあとも書き足せる", () => {
    echo("古い");
    logClear();
    echo("新しい");
    expect(logLines()).toEqual(["新しい"]);
  });

  test("履歴が空でも落ちない", () => {
    logClear();
    logClear();
    expect(logLines()).toEqual([]);
  });
});
