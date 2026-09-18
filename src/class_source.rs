//! クラスファイル（CoffeeScript）から、IDEが表示に使う情報を読み取る。
//!
//! 実行しないと決まらない値もあるため、**ソース上に直接書かれた文字列だけ**を対象にする。
//! 読み取れない場合はサムネイルをプレースホルダーのままにする。

/// オブジェクトが使うアセットを指す変数名
pub const MODEL_PROPERTY: &str = "@MODEL";

/// クラスファイルから `@MODEL` に指定されたアセット名を読み取る
///
/// - `@MODEL = "player.png"` のような**文字列リテラル**のみを対象にする
/// - `@MODEL = param.MODEL ?? "player.png"` のように既定値を書いた場合は、その文字列を採る
/// - 複数回代入されている場合は**最後の指定**を採る
/// - コメント行（`#` で始まる行）は無視する
/// - 変数や連結で組み立てている場合は読み取れないため `None`
pub fn parse_model_ref(source: &str) -> Option<String> {
    let mut found = None;
    for line in source.lines() {
        let line = line.trim();
        // コメント行は対象外
        if line.starts_with('#') {
            continue;
        }
        let Some(rest) = line.strip_prefix(MODEL_PROPERTY) else {
            continue;
        };
        // @MODELNAME のような別の変数を拾わないよう、直後が代入であることを確かめる
        let rest = rest.trim_start();
        let Some(value) = rest.strip_prefix('=') else {
            continue;
        };
        if let Some(literal) = first_string_literal(value) {
            if !literal.is_empty() {
                // 複数回指定されている場合は最後の指定を採る
                found = Some(literal);
            }
        }
    }
    found
}

/// 行頭の空白の数（インデントの深さ）
fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// `key: 値` の形の行なら、キーの後ろの値部分を返す（`key` はインデントを除いた行頭にあること）
fn keyed_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let rest = line.trim_start().strip_prefix(key)?;
    let rest = rest.trim_start();
    rest.strip_prefix(':')
}

/// ある画像を使う `@addObject` の `size:` を読み取る（画像の詳細表示の初期値に使う。4.4節）
///
/// `model: "画像名"` の行を見つけ、**同じブロック**（空行、またはその行より浅いインデントで区切る）
/// の中から `size: 整数` を探す。`size` が `model` より前に書かれていてもよい。
///
/// - コメント行（`#` で始まる行）は無視する
/// - 数値でない指定（`size: @cellSize`）は読み取れないため飛ばす
/// - 同じ画像を何か所かで使っている場合は**最初に見つけたもの**を採る
pub fn find_sprite_size(source: &str, file_name: &str) -> Option<u32> {
    let lines: Vec<&str> = source.lines().collect();
    let is_comment = |line: &str| line.trim_start().starts_with('#');

    for (index, line) in lines.iter().enumerate() {
        if is_comment(line) {
            continue;
        }
        let Some(value) = keyed_value(line, "model") else {
            continue;
        };
        if first_string_literal(value).as_deref() != Some(file_name) {
            continue;
        }

        // ブロックの範囲を決める（同じかそれより深いインデントで、空行までの続き）
        let depth = indent_of(line);
        let in_block = |candidate: &str| !candidate.trim().is_empty() && indent_of(candidate) >= depth;
        let start = (0..index).rev().take_while(|&i| in_block(lines[i])).last().unwrap_or(index);
        let end = (index + 1..lines.len())
            .take_while(|&i| in_block(lines[i]))
            .last()
            .unwrap_or(index);

        for candidate in &lines[start..=end] {
            if is_comment(candidate) || indent_of(candidate) != depth {
                continue;
            }
            let Some(value) = keyed_value(candidate, "size") else {
                continue;
            };
            let number: String = value.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
            let after = value.trim()[number.len()..].trim_start();
            let clean = after.is_empty() || after.starts_with('#');
            if let (Ok(size), true) = (number.parse::<u32>(), clean) {
                return Some(size);
            }
        }
    }
    None
}

/// 行の中で最初に現れる文字列リテラルの中身を取り出す
fn first_string_literal(text: &str) -> Option<String> {
    let mut chars = text.chars();
    while let Some(ch) = chars.next() {
        // 行コメントに入ったら打ち切る
        if ch == '#' {
            return None;
        }
        if ch == '"' || ch == '\'' {
            let quote = ch;
            let mut value = String::new();
            let mut escaped = false;
            for inner in chars.by_ref() {
                if escaped {
                    value.push(inner);
                    escaped = false;
                    continue;
                }
                match inner {
                    '\\' => escaped = true,
                    c if c == quote => return Some(value),
                    c => value.push(c),
                }
            }
            // 閉じられていない文字列は読み取らない
            return None;
        }
    }
    None
}

/// クラスファイルの雛形を組み立てる（内容は docs/templete.md に準拠）
pub fn build_class_template(name: &str) -> String {
    format!(
        "class {name} extends arcadeermain\n  constructor: (param) ->\n    super(param)\n\n  \
         behavior: (e) ->\n    super(e)\n\n    switch @proc\n      when 0\n        \
         @waitjob(1000)\n"
    )
}

/// ゲームの起点（`gameMain`）の雛形を組み立てる（仕様書6.2.2節）
///
/// 通常のクラスと違い、**すぐ動くもの**を置く。
/// 同梱の猫を出し、こちらを向かせ、歩かせながら回す。
/// 新しく作った人が、実行すればいきなり絵が動くところから始められるようにするため。
pub fn build_entry_template(name: &str) -> String {
    format!(
        "class {name} extends arcadeermain\n\
         \x20 constructor: (param) ->\n\
         \x20   super(param)\n\
         \x20   \n\
         \x20   @MODEL = \"default-cat.glb\"\n\
         \x20   @X = 0.0\n\
         \x20   @Y = 0.0\n\
         \x20   @Z = 0.0\n\
         \x20   @scaleX = 1.0\n\
         \x20   @scaleY = 1.0\n\
         \x20   @scaleZ = 1.0\n\
         \x20   \n\
         \x20   @ROTY = 180.0\n\
         \x20   \n\
         \x20   @setAnimation({{name:\"Walk\", loop:true}})\n\
         \n\
         \x20 behavior: (e) ->\n\
         \x20   super(e)\n\
         \n\
         \x20   switch @proc\n\
         \x20     when 0\n\
         \x20       @ROTY += 1\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_double_quoted_value() {
        let source = "class Player extends arcadeermain\n  constructor: (param) ->\n    @MODEL = \"player.png\"\n";
        assert_eq!(parse_model_ref(source), Some("player.png".to_string()));
    }

    #[test]
    fn reads_single_quoted_value() {
        assert_eq!(
            parse_model_ref("    @MODEL = 'cat.glb'\n"),
            Some("cat.glb".to_string())
        );
    }

    #[test]
    fn reads_default_style_value() {
        // param 経由の指定に既定値を添える書き方
        assert_eq!(
            parse_model_ref("    @MODEL = param.MODEL ?? \"player.png\"\n"),
            Some("player.png".to_string())
        );
    }

    #[test]
    fn reads_with_trailing_comment() {
        assert_eq!(
            parse_model_ref("    @MODEL = \"player.png\"  # 主人公\n"),
            Some("player.png".to_string())
        );
    }

    #[test]
    fn reads_with_surrounding_spaces() {
        assert_eq!(
            parse_model_ref("        @MODEL   =   \"player.png\"\n"),
            Some("player.png".to_string())
        );
    }

    #[test]
    fn takes_last_of_repeated_values() {
        let source = "    @MODEL = \"first.png\"\n    @MODEL = \"last.png\"\n";
        assert_eq!(parse_model_ref(source), Some("last.png".to_string()));
    }

    #[test]
    fn ignores_commented_out_value() {
        let source = "    # @MODEL = \"commented.png\"\n    @MODEL = \"real.png\"\n";
        assert_eq!(parse_model_ref(source), Some("real.png".to_string()));
    }

    #[test]
    fn reads_nothing_when_only_comments() {
        assert_eq!(parse_model_ref("    # @MODEL = \"only.png\"\n"), None);
    }

    #[test]
    fn reads_nothing_without_value() {
        let source = "class Player extends arcadeermain\n  behavior: (e) ->\n    super(e)\n";
        assert_eq!(parse_model_ref(source), None);
    }

    #[test]
    fn ignores_similarly_named_variables() {
        assert_eq!(parse_model_ref("    @MODELNAME = \"x.png\"\n"), None);
        assert_eq!(parse_model_ref("    @MYMODEL = \"x.png\"\n"), None);
    }

    #[test]
    fn ignores_non_string_value() {
        // 変数や連結で組み立てている場合は実行しないと決まらない
        assert_eq!(parse_model_ref("    @MODEL = assetName\n"), None);
        assert_eq!(parse_model_ref("    @MODEL = prefix + \".png\"\n"), Some(".png".to_string()));
    }

    #[test]
    fn ignores_empty_string_value() {
        assert_eq!(parse_model_ref("    @MODEL = \"\"\n"), None);
    }

    // --- 雛形 ---

    // --- find_sprite_size ---

    #[test]
    fn sprite_size_is_read_next_to_the_model_argument() {
        let source = "\
class gameMain extends arcadeermain
  constructor: (param) ->
    super(param)
    @cat = @addObject
      name: \"cat\"
      model: \"default-cat.png\"
      size: 32
      pattern: [[0], [1, 2, 3]]
";
        assert_eq!(find_sprite_size(source, "default-cat.png"), Some(32));
    }

    #[test]
    fn sprite_size_written_before_model_is_also_found() {
        let source = "\
    @cat = @addObject
      name: \"cat\"
      size: 48
      x: 100
      model: 'default-cat.png'
";
        assert_eq!(find_sprite_size(source, "default-cat.png"), Some(48));
    }

    #[test]
    fn sprite_size_belongs_to_the_same_add_object_block() {
        // 別の @addObject の size は拾わない
        let source = "\
    @a = @addObject
      name: \"a\"
      model: \"other.png\"
      size: 16

    @b = @addObject
      name: \"b\"
      model: \"default-cat.png\"
      x: 0
";
        assert_eq!(find_sprite_size(source, "default-cat.png"), None);
        assert_eq!(find_sprite_size(source, "other.png"), Some(16));
    }

    #[test]
    fn sprite_size_ignores_comment_lines() {
        let source = "\
    @cat = @addObject
      model: \"default-cat.png\"
      # size: 99
      size: 24
";
        assert_eq!(find_sprite_size(source, "default-cat.png"), Some(24));
    }

    #[test]
    fn sprite_size_needs_a_whole_number() {
        let source = "\
    @cat = @addObject
      model: \"default-cat.png\"
      size: @cellSize
";
        assert_eq!(find_sprite_size(source, "default-cat.png"), None);
    }

    #[test]
    fn sprite_size_matches_the_exact_file_name() {
        let source = "\
    @cat = @addObject
      model: \"default-cat-2.png\"
      size: 64
";
        assert_eq!(find_sprite_size(source, "default-cat.png"), None);
        assert_eq!(find_sprite_size(source, "default-cat-2.png"), Some(64));
    }

    #[test]
    fn sprite_size_takes_the_first_use_when_the_image_is_used_twice() {
        let source = "\
    @a = @addObject
      model: \"default-cat.png\"
      size: 32
    @b = @addObject
      model: \"default-cat.png\"
      size: 16
";
        assert_eq!(find_sprite_size(source, "default-cat.png"), Some(32));
    }

    #[test]
    fn sprite_size_is_none_when_the_image_is_not_used() {
        assert_eq!(find_sprite_size("class a extends arcadeermain\n", "default-cat.png"), None);
        assert_eq!(find_sprite_size("", "default-cat.png"), None);
    }

    #[test]
    fn class_template_starts_from_waitjob() {
        let text = build_class_template("enemy");
        assert!(text.starts_with("class enemy extends arcadeermain\n"));
        assert!(text.contains("@waitjob(1000)"));
        // 通常のクラスには、モデルもアニメーションも入れない
        assert!(!text.contains("@MODEL"));
    }

    #[test]
    fn entry_template_shows_the_bundled_cat() {
        let text = build_entry_template("gameMain");
        assert!(text.starts_with("class gameMain extends arcadeermain\n"));
        assert!(text.contains("@MODEL = \"default-cat.glb\""));
        // 実行すればすぐ動くように、歩かせて回す
        assert!(text.contains("@setAnimation({name:\"Walk\", loop:true})"));
        assert!(text.contains("@ROTY = 180.0"));
        assert!(text.contains("@ROTY += 1"));
    }

    #[test]
    fn entry_template_is_indented_by_two_spaces() {
        // CoffeeScript はインデントで構造が決まる
        let text = build_entry_template("gameMain");
        assert!(text.contains("\n  constructor: (param) ->\n    super(param)\n"));
        assert!(text.contains("\n  behavior: (e) ->\n    super(e)\n"));
        assert!(text.contains("\n    switch @proc\n      when 0\n        @ROTY += 1\n"));
    }

    #[test]
    fn entry_template_ends_with_a_newline() {
        assert!(build_entry_template("gameMain").ends_with("\n"));
    }

    #[test]
    fn templates_use_the_given_name() {
        assert!(build_class_template("Ship").starts_with("class Ship "));
        assert!(build_entry_template("Ship").starts_with("class Ship "));
    }
}
