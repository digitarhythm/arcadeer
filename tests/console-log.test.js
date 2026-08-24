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

describe("echo の桁指定（printf に合わせる）", () => {
  test("小数の桁数を指定できる", () => {
    expect(formatEcho("%.2@", 3.14159)).toBe("3.14");
    expect(formatEcho("%.4@", 3.14159)).toBe("3.1416");
    expect(formatEcho("%.0@", 3.7)).toBe("4");
  });

  test("整数にも小数の桁数が付く", () => {
    expect(formatEcho("%.2@", 42)).toBe("42.00");
  });

  test("幅を指定すると右寄せになる", () => {
    expect(formatEcho("%8.2@", 3.14159)).toBe("    3.14");
    expect(formatEcho("%8.2@", 42)).toBe("   42.00");
  });

  test("0 を付けると0埋めになる", () => {
    expect(formatEcho("%08.2@", 3.14159)).toBe("00003.14");
    expect(formatEcho("%04@", 42)).toBe("0042");
  });

  test("整数部と小数部の桁をそろえる書き方", () => {
    // printf と同じく、幅は**全体の文字数**（4 + 小数点 + 4 = 9）
    expect(formatEcho("%09.4@", 3.14159)).toBe("0003.1416");
  });

  test("桁数を指定しなければ、値はそのまま（削らない）", () => {
    // 幅だけの指定で小数を切り捨てると、黙って情報が消えてしまう
    expect(formatEcho("%04@", 3.14159)).toBe("3.14159");
    expect(formatEcho("%10@", 3.5)).toBe("       3.5");
  });

  test("- を付けると左寄せになる", () => {
    expect(formatEcho("[%-8.2@]", 3.14159)).toBe("[3.14    ]");
    // 左寄せと0埋めが重なったら、左寄せを採る（printf と同じ）
    expect(formatEcho("[%-08.2@]", 3.14159)).toBe("[3.14    ]");
  });

  test("+ を付けると符号が必ず出る", () => {
    expect(formatEcho("%+.2@", 3.14159)).toBe("+3.14");
    expect(formatEcho("%+.2@", -3.14159)).toBe("-3.14");
  });

  test("空白を付けると、正の数の前に空白が入る", () => {
    expect(formatEcho("[% .2@]", 3.14159)).toBe("[ 3.14]");
    expect(formatEcho("[% .2@]", -3.14159)).toBe("[-3.14]");
  });

  test("0埋めは符号のあとに入る", () => {
    expect(formatEcho("%08.2@", -3.14159)).toBe("-0003.14");
    expect(formatEcho("%+08.2@", 3.14159)).toBe("+0003.14");
  });

  test("幅に足りていれば、そのまま出す", () => {
    expect(formatEcho("%2.2@", 3.14159)).toBe("3.14");
  });

  test("文字列にも幅が効く", () => {
    expect(formatEcho("[%6@]", "abc")).toBe("[   abc]");
    expect(formatEcho("[%-6@]", "abc")).toBe("[abc   ]");
    // 数値でないものは 0 埋めしない（printf と同じ）
    expect(formatEcho("[%06@]", "abc")).toBe("[   abc]");
  });

  test("文字列に桁数を指定すると切り詰める", () => {
    expect(formatEcho("%.3@", "abcdef")).toBe("abc");
  });

  test("数でないものは符号を付けない", () => {
    expect(formatEcho("%+@", "abc")).toBe("abc");
  });

  test("NaN や Infinity はそのまま出す", () => {
    expect(formatEcho("%.2@", NaN)).toBe("NaN");
    expect(formatEcho("%.2@", Infinity)).toBe("Infinity");
    expect(formatEcho("%.2@", -Infinity)).toBe("-Infinity");
  });

  test("引数が足りなければ、書式をそのまま残す", () => {
    expect(formatEcho("%08.2@")).toBe("%08.2@");
    expect(formatEcho("%.2@ と %.3@", 1)).toBe("1.00 と %.3@");
  });

  test("解釈できない並びは、そのまま出す", () => {
    expect(formatEcho("%4.4x", 1)).toBe("%4.4x 1");
    expect(formatEcho("%z@", 1)).toBe("%z@ 1");
  });

  test("%% は今までどおり % になる", () => {
    expect(formatEcho("%08.2@%%", 3.14159)).toBe("00003.14%");
  });

  test("桁指定なしの %@ は、これまでと変わらない", () => {
    expect(formatEcho("%@", 3.14159)).toBe("3.14159");
    expect(formatEcho("%@", "abc")).toBe("abc");
  });
});
