// ゲーム全体で共有する連想配列（仕様書6.2.7節）
//
// クラスファイルは1つずつ別のスコープでコンパイルされるため、
// そのままでは変数を共有できない。共有したい値はここへ入れる。
//
// **入れ物は `GLOBAL` ひとつだけ**にしてある。名前を自由に生やせるようにすると、
// 書き間違いがエラーにならず、原因の分からない不具合につながるため。

/**
 * ゲーム全体で共有する連想配列
 *
 * ```coffee
 * GLOBAL.SCORE = 0
 * GLOBAL.SCORE += 100
 * echo "得点は %@", GLOBAL.SCORE
 * ```
 *
 * すべてのクラスファイルへ**同じ実体**が渡る。
 */
export const GLOBAL = {};

/** 入っているキーの一覧 */
export function globalKeys() {
  return Object.keys(GLOBAL);
}

/**
 * 中身を空にする（ゲームを実行するたびに呼ぶ）
 *
 * 新しい入れ物へ**差し替えない**。差し替えると、既に受け取っている側が
 * 古いものを見続けてしまうため、キーを削って回る。
 */
export function clearGlobals() {
  for (const key of Object.keys(GLOBAL)) delete GLOBAL[key];
}

if (typeof window !== "undefined") {
  // 開発者コンソールから中身を覗けるようにする
  window.arcadeerGlobal = GLOBAL;
}
