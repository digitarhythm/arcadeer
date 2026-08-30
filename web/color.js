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

/**
 * 透明度（`@ALPHA`）を 0〜1 の値にそろえる
 *
 * 範囲の外は端へ寄せ、数値でないものは 1（不透明）にする。
 * 書き間違いで描画が壊れないようにするため。
 */
export function normalizeAlpha(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * オブジェクトの色を 0〜1 の RGBA にする
 *
 * `@COLOR` の色に `@ALPHA` を掛け合わせる。`@COLOR` を8桁で書いた場合は、
 * そちらの透明度とも掛け合わせる（`#ff880080` と `@ALPHA = 0.5` なら約0.25）。
 *
 * ```coffee
 * @COLOR = "#ff8800"
 * @ALPHA = 0.3        # 3割の濃さで透ける
 * ```
 */
export function objectColor(object) {
  const color = object?.COLOR ? parseColor(object.COLOR) : WHITE;
  const alpha = normalizeAlpha(object?.ALPHA);
  if (alpha === 1) return color;
  return [color[0], color[1], color[2], color[3] * alpha];
}
