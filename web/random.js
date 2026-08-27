// 乱数（仕様書6.2.3節）
//
// ゲームコードから `random(n)` として呼ぶ。
//
// ```coffee
// @X = random 640            # 0〜639 のどれか
// @fire() if random(10) is 0 # 10回に1回
// ```
//
// 元になる乱数は差し替えられるようにしてあり、単体テストできる。

/**
 * 0 から `max - 1` までの整数を返す（**`max` は含まない**）
 *
 * 渡した数がそのまま**通りの数**になる。`random(5)` は 0・1・2・3・4 の5通り。
 * 配列の長さをそのまま渡せば、必ず添字の範囲に収まる。
 *
 * 小数は切り捨て、負の数や数として読めないものは 0 として扱う
 * （選ぶものが無いので必ず 0 が返る）。
 *
 * @param max 通りの数（この値そのものは出ない）
 * @param rng 0以上1未満を返す元。試験用に差し替えられる
 */
export function random(max, rng = Math.random) {
  const 通り = typeof max === "number" && Number.isFinite(max) ? Math.floor(max) : 0;
  if (通り <= 1) return 0;

  // 元が 1 ちょうどや負の値を返しても、範囲からはみ出さないようにする
  const 割合 = Math.min(Math.max(rng(), 0), 0.9999999999);
  return Math.floor(割合 * 通り);
}
