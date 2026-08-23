//! CoffeeScript のクラス名として使える名前かを検証するモジュール。
//!
//! クラスファイル名（`code/<クラス名>.coffee`）にもなるため、
//! CoffeeScript の識別子規則に加えて重複と長さも確認する。

/// クラス名として使えない理由
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClassNameError {
    /// 未入力
    Empty,
    /// 先頭に使えない文字（数字始まり等）
    InvalidStart,
    /// 名前の途中に使えない文字
    InvalidChar,
    /// 予約語
    Reserved,
    /// 長すぎる
    TooLong,
    /// 同名のオブジェクトが既にある
    Duplicate,
    /// ゲームの起点となるオブジェクト名（削除・再作成できない）
    EntryReserved,
}

impl ClassNameError {
    /// 案内文の翻訳キー
    pub fn message_key(self) -> &'static str {
        match self {
            ClassNameError::Empty => "validate.class.empty",
            ClassNameError::InvalidStart => "validate.class.invalidStart",
            ClassNameError::InvalidChar => "validate.class.invalidChar",
            ClassNameError::Reserved => "validate.class.reserved",
            ClassNameError::TooLong => "validate.class.tooLong",
            ClassNameError::Duplicate => "validate.class.duplicate",
            ClassNameError::EntryReserved => "validate.class.entryReserved",
        }
    }
}

/// クラス名の最大文字数（ファイル名にもなるため上限を設ける）
pub const MAX_CLASS_NAME_LEN: usize = 64;

/// CoffeeScript / JavaScript の予約語
///
/// CoffeeScript のレキサが持つ JS_KEYWORDS / COFFEE_KEYWORDS / RESERVED /
/// STRICT_PROSCRIBED に相当するものを列挙する。
const RESERVED_WORDS: &[&str] = &[
    // JavaScript のキーワード
    "true", "false", "null", "this", "new", "delete", "typeof", "in", "instanceof", "return",
    "throw", "break", "continue", "debugger", "yield", "await", "if", "else", "switch", "for",
    "while", "do", "try", "catch", "finally", "class", "extends", "super", "import", "export",
    "default",
    // CoffeeScript のキーワードと別名
    "undefined", "Infinity", "NaN", "then", "unless", "until", "loop", "of", "by", "when", "and",
    "or", "is", "isnt", "not", "yes", "no", "on", "off",
    // 将来の予約語・使用を避けるべき語
    "case", "function", "var", "void", "with", "const", "let", "enum", "native", "implements",
    "interface", "package", "private", "protected", "public", "static", "arguments", "eval",
];

/// 識別子の先頭に使える文字か
fn is_ident_start(c: char) -> bool {
    // CoffeeScript は非ASCII（\x7f-￿）も識別子に使える
    c == '$' || c == '_' || c.is_ascii_alphabetic() || (c as u32 >= 0x7f && !c.is_control() && !c.is_whitespace())
}

/// 識別子の2文字目以降に使える文字か
fn is_ident_part(c: char) -> bool {
    is_ident_start(c) || c.is_ascii_digit()
}

/// クラス名を検証する
///
/// 前後の空白は取り除いたうえで判定し、成功時は整形後の名前を返す。
/// `existing` には既存のオブジェクト名を渡す（大文字小文字を区別せず重複を判定する）。
pub fn validate_class_name(name: &str, existing: &[String]) -> Result<String, ClassNameError> {
    let name = name.trim();

    if name.is_empty() {
        return Err(ClassNameError::Empty);
    }
    if name.chars().count() > MAX_CLASS_NAME_LEN {
        return Err(ClassNameError::TooLong);
    }

    let mut chars = name.chars();
    let first = chars.next().expect("空でないことを確認済み");
    if !is_ident_start(first) {
        return Err(ClassNameError::InvalidStart);
    }
    if !chars.all(is_ident_part) {
        return Err(ClassNameError::InvalidChar);
    }

    if RESERVED_WORDS.contains(&name) {
        return Err(ClassNameError::Reserved);
    }

    // 起点オブジェクトはプロジェクト作成時に配置され、作り直せない
    if crate::listing::is_entry_object(name) {
        return Err(ClassNameError::EntryReserved);
    }

    // ファイルシステムが大文字小文字を区別しない場合があるため、小文字化して比較する
    let lowered = name.to_lowercase();
    if existing.iter().any(|e| e.to_lowercase() == lowered) {
        return Err(ClassNameError::Duplicate);
    }

    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(name: &str) -> Result<String, ClassNameError> {
        validate_class_name(name, &[])
    }

    #[test]
    fn 一般的なクラス名を受け入れる() {
        assert_eq!(ok("Player"), Ok("Player".to_string()));
        assert_eq!(ok("Enemy2"), Ok("Enemy2".to_string()));
        assert_eq!(ok("A"), Ok("A".to_string()));
    }

    #[test]
    fn アンダースコアとドル記号で始められる() {
        assert_eq!(ok("_private"), Ok("_private".to_string()));
        assert_eq!(ok("$dollar"), Ok("$dollar".to_string()));
    }

    #[test]
    fn 非アスキーの識別子も使える() {
        // CoffeeScript は \x7f-￿ を識別子に使えるため
        assert_eq!(ok("敵キャラ"), Ok("敵キャラ".to_string()));
    }

    #[test]
    fn 前後の空白は取り除く() {
        assert_eq!(ok("  Player  "), Ok("Player".to_string()));
    }

    #[test]
    fn 未入力は空エラーになる() {
        assert_eq!(ok(""), Err(ClassNameError::Empty));
        assert_eq!(ok("   "), Err(ClassNameError::Empty));
    }

    #[test]
    fn 数字で始まる名前は拒否する() {
        assert_eq!(ok("2Player"), Err(ClassNameError::InvalidStart));
        assert_eq!(ok("9"), Err(ClassNameError::InvalidStart));
    }

    #[test]
    fn 使えない文字を含む名前は拒否する() {
        for name in ["Player-1", "Player Name", "Player.X", "Player!", "Player/X", "Player#"] {
            assert_eq!(ok(name), Err(ClassNameError::InvalidChar), "{name}");
        }
    }

    #[test]
    fn 予約語は拒否する() {
        for name in [
            "class", "if", "then", "unless", "yes", "no", "arguments", "eval", "static", "true",
            "null", "Infinity", "NaN", "super", "extends",
        ] {
            assert_eq!(ok(name), Err(ClassNameError::Reserved), "{name}");
        }
    }

    #[test]
    fn 予約語に似ているだけの名前は受け入れる() {
        assert_eq!(ok("Class"), Ok("Class".to_string()));
        assert_eq!(ok("ifBlock"), Ok("ifBlock".to_string()));
    }

    #[test]
    fn 長すぎる名前は拒否する() {
        let long = "A".repeat(MAX_CLASS_NAME_LEN + 1);
        assert_eq!(ok(&long), Err(ClassNameError::TooLong));
        let limit = "A".repeat(MAX_CLASS_NAME_LEN);
        assert!(ok(&limit).is_ok());
    }

    #[test]
    fn 起点オブジェクト名は使えない() {
        // gameMain はゲームの起点として予約されており、作り直せない
        assert_eq!(ok("gameMain"), Err(ClassNameError::EntryReserved));
        assert_eq!(ok("gamemain"), Err(ClassNameError::EntryReserved));
        assert_eq!(ok("GAMEMAIN"), Err(ClassNameError::EntryReserved));
    }

    #[test]
    fn 起点オブジェクトに似た名前は使える() {
        assert_eq!(ok("gameMainSub"), Ok("gameMainSub".to_string()));
        assert_eq!(ok("myGameMain"), Ok("myGameMain".to_string()));
    }

    #[test]
    fn 既存と同名は拒否する() {
        let existing = vec!["Player".to_string(), "Enemy".to_string()];
        assert_eq!(
            validate_class_name("Player", &existing),
            Err(ClassNameError::Duplicate)
        );
    }

    #[test]
    fn 重複判定は大文字小文字を区別しない() {
        // ファイルシステムが大文字小文字を区別しない環境で衝突するため
        let existing = vec!["Player".to_string()];
        assert_eq!(
            validate_class_name("player", &existing),
            Err(ClassNameError::Duplicate)
        );
        assert_eq!(
            validate_class_name("PLAYER", &existing),
            Err(ClassNameError::Duplicate)
        );
    }

    #[test]
    fn 既存に無い名前は受け入れる() {
        let existing = vec!["Player".to_string()];
        assert_eq!(
            validate_class_name("Enemy", &existing),
            Ok("Enemy".to_string())
        );
    }

    #[test]
    fn 理由ごとに翻訳キーを返す() {
        assert_eq!(ClassNameError::Empty.message_key(), "validate.class.empty");
        assert_eq!(
            ClassNameError::InvalidStart.message_key(),
            "validate.class.invalidStart"
        );
        assert_eq!(
            ClassNameError::InvalidChar.message_key(),
            "validate.class.invalidChar"
        );
        assert_eq!(
            ClassNameError::Reserved.message_key(),
            "validate.class.reserved"
        );
        assert_eq!(
            ClassNameError::TooLong.message_key(),
            "validate.class.tooLong"
        );
        assert_eq!(
            ClassNameError::Duplicate.message_key(),
            "validate.class.duplicate"
        );
        assert_eq!(
            ClassNameError::EntryReserved.message_key(),
            "validate.class.entryReserved"
        );
    }
}
