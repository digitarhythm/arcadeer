// 色指定（@COLOR）の解釈
//
// ゲームコードでは `@COLOR = "#ff8800"` のように文字列で指定する。
// 描画時に 0〜1 の RGBA へ直して、頂点カラーへ掛け合わせる。
//
// DOMに依存しないため単体テストできる。

/** 色の指定が無いときの既定（掛け合わせても元の色が変わらない） */
export const WHITE = [1, 1, 1, 1];

/** 16進数2桁を 0〜1 にする */
function channel(hex) {
  return parseInt(hex, 16) / 255;
}

/**
 * 色の文字列を 0〜1 の RGBA にする
 *
 * `#rgb` `#rrggbb` `#rrggbbaa` に対応する。先頭の `#` は省略できる。
 * **読めない値は白にする**（色の書き間違いで描画が止まらないように）。
 */
export function parseColor(value) {
  return parseColorOrNull(value) ?? WHITE;
}

/**
 * 色の文字列を 0〜1 の RGBA にする（読めなければ `null`）
 *
 * 白に落とすと困る場面で使う。環境光を白にすると、陰も含めて全面が
 * 最大の明るさになり、絵が破綻してしまうため。
 */
export function parseColorOrNull(value) {
  if (typeof value !== "string") return null;

  const text = value.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(text)) return null;

  if (text.length === 3) {
    // 短縮形は各桁を2回繰り返したものと同じ
    const [r, g, b] = [...text].map((c) => channel(c + c));
    return [r, g, b, 1];
  }
  if (text.length === 6 || text.length === 8) {
    const at = (i) => channel(text.slice(i, i + 2));
    return [at(0), at(2), at(4), text.length === 8 ? at(6) : 1];
  }
  return null;
}
