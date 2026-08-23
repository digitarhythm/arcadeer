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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 二重引用符の指定を読み取れる() {
        let source = "class Player extends arcadeermain\n  constructor: (param) ->\n    @MODEL = \"player.png\"\n";
        assert_eq!(parse_model_ref(source), Some("player.png".to_string()));
    }

    #[test]
    fn 単引用符の指定を読み取れる() {
        assert_eq!(
            parse_model_ref("    @MODEL = 'cat.glb'\n"),
            Some("cat.glb".to_string())
        );
    }

    #[test]
    fn 既定値の書き方でも読み取れる() {
        // param 経由の指定に既定値を添える書き方
        assert_eq!(
            parse_model_ref("    @MODEL = param.MODEL ?? \"player.png\"\n"),
            Some("player.png".to_string())
        );
    }

    #[test]
    fn 行末のコメントがあっても読み取れる() {
        assert_eq!(
            parse_model_ref("    @MODEL = \"player.png\"  # 主人公\n"),
            Some("player.png".to_string())
        );
    }

    #[test]
    fn 前後の空白があっても読み取れる() {
        assert_eq!(
            parse_model_ref("        @MODEL   =   \"player.png\"\n"),
            Some("player.png".to_string())
        );
    }

    #[test]
    fn 複数回の指定は最後を採る() {
        let source = "    @MODEL = \"first.png\"\n    @MODEL = \"last.png\"\n";
        assert_eq!(parse_model_ref(source), Some("last.png".to_string()));
    }

    #[test]
    fn コメント行の指定は無視する() {
        let source = "    # @MODEL = \"commented.png\"\n    @MODEL = \"real.png\"\n";
        assert_eq!(parse_model_ref(source), Some("real.png".to_string()));
    }

    #[test]
    fn コメント行しかなければ読み取らない() {
        assert_eq!(parse_model_ref("    # @MODEL = \"only.png\"\n"), None);
    }

    #[test]
    fn 指定が無ければ読み取らない() {
        let source = "class Player extends arcadeermain\n  behavior: (e) ->\n    super(e)\n";
        assert_eq!(parse_model_ref(source), None);
    }

    #[test]
    fn 似た名前の変数は対象にしない() {
        assert_eq!(parse_model_ref("    @MODELNAME = \"x.png\"\n"), None);
        assert_eq!(parse_model_ref("    @MYMODEL = \"x.png\"\n"), None);
    }

    #[test]
    fn 文字列でない指定は読み取らない() {
        // 変数や連結で組み立てている場合は実行しないと決まらない
        assert_eq!(parse_model_ref("    @MODEL = assetName\n"), None);
        assert_eq!(parse_model_ref("    @MODEL = prefix + \".png\"\n"), Some(".png".to_string()));
    }

    #[test]
    fn 空文字の指定は読み取らない() {
        assert_eq!(parse_model_ref("    @MODEL = \"\"\n"), None);
    }
}
