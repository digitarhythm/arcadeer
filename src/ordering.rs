//! サムネイル一覧の並び順。
//!
//! ドラッグ＆ドロップで変えた順序を保持し、ファイル一覧へ適用する。
//! 実際のファイルは増減するため、保存済みの順序と実在ファイルの突き合わせを行う。

use std::collections::HashMap;

use crate::listing::{compare_display_names, is_entry_object};

/// `info.toml` の並び順セクション名
pub const ORDER_SECTION: &str = "order";

/// タブの翻訳キーから、並び順の保存キーを得る
pub fn order_key_for_tab(tab_key: &str) -> Option<&'static str> {
    match tab_key {
        "pane.tab.object" => Some("objects"),
        "pane.tab.image" => Some("images"),
        "pane.tab.sound" => Some("sounds"),
        "pane.tab.model" => Some("models"),
        _ => None,
    }
}

/// 書き出すキーの順序（安定した並びにするため）
const ORDER_KEYS: [&str; 4] = ["objects", "images", "sounds", "models"];

/// `info.toml` から `[order]` セクションを読み取る
///
/// セクションが無い場合や配列でない値は無視する。
pub fn parse_order(text: &str) -> HashMap<String, Vec<String>> {
    let mut order = HashMap::new();
    let mut in_section = false;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            // 別のセクションが始まったら読み取りを止める
            in_section = line == format!("[{ORDER_SECTION}]");
            continue;
        }
        if !in_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim();
        if value.starts_with('[') && value.ends_with(']') {
            order.insert(
                key.trim().to_string(),
                parse_string_array(&value[1..value.len() - 1]),
            );
        }
    }
    order
}

/// `"a", "b"` 形式の並びを文字列の配列にする
fn parse_string_array(inner: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut escaped = false;

    for ch in inner.chars() {
        if escaped {
            // TOMLの基本文字列でよく使うものだけ戻す
            current.push(match ch {
                'n' => '\n',
                't' => '\t',
                other => other,
            });
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_string => escaped = true,
            '"' => {
                if in_string {
                    items.push(std::mem::take(&mut current));
                }
                in_string = !in_string;
            }
            _ if in_string => current.push(ch),
            _ => {}
        }
    }
    items
}

/// TOMLの基本文字列としてエスケープする
fn escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\t', "\\t")
}

/// `[order]` セクションのTOML文字列を組み立てる
///
/// キーは安定した順序（objects → images → sounds → models）で書き出す。
/// 中身が空のキーは書き出さない。
pub fn format_order(order: &HashMap<String, Vec<String>>) -> String {
    let mut lines = Vec::new();
    for key in ORDER_KEYS {
        let Some(items) = order.get(key) else { continue };
        // 中身が空のキーは書き出さない（既定の名前順に戻る）
        if items.is_empty() {
            continue;
        }
        let values: Vec<String> = items.iter().map(|v| format!("\"{}\"", escape(v))).collect();
        lines.push(format!("{key} = [{}]", values.join(", ")));
    }
    if lines.is_empty() {
        return String::new();
    }
    format!("[{ORDER_SECTION}]\n{}\n", lines.join("\n"))
}

/// 保存済みの並び順を、実在するファイル一覧へ適用する
///
/// - 保存済みの順序に含まれる項目は、その順に並べる
/// - 保存後に増えた項目（順序に無いもの）は**末尾**へ名前順で並べる
/// - 保存済みだが実在しない項目は無視する
/// - 起点オブジェクト（`gameMain`）は保存内容に関わらず**常に先頭**
pub fn apply_order(items: &[String], saved_order: &[String]) -> Vec<String> {
    let mut remaining: Vec<String> = items.to_vec();
    let mut ordered = Vec::with_capacity(items.len());

    // 保存済みの順に取り出す（実在しないものは飛ばす）
    for name in saved_order {
        if let Some(position) = remaining.iter().position(|item| item == name) {
            ordered.push(remaining.remove(position));
        }
    }
    // 保存後に増えたものは末尾へ名前順で並べる
    remaining.sort_by(|a, b| compare_display_names(a, b));
    ordered.extend(remaining);

    // ゲームの起点は保存内容に関わらず先頭に置く
    if let Some(position) = ordered.iter().position(|item| is_entry_object(item)) {
        let entry = ordered.remove(position);
        ordered.insert(0, entry);
    }
    ordered
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    // --- order_key_for_tab ---

    #[test]
    fn タブごとの保存キーを得られる() {
        assert_eq!(order_key_for_tab("pane.tab.object"), Some("objects"));
        assert_eq!(order_key_for_tab("pane.tab.image"), Some("images"));
        assert_eq!(order_key_for_tab("pane.tab.sound"), Some("sounds"));
        assert_eq!(order_key_for_tab("pane.tab.model"), Some("models"));
        assert_eq!(order_key_for_tab("pane.tab.unknown"), None);
    }

    // --- parse_order ---

    #[test]
    fn 並び順セクションを読み取れる() {
        let text = concat!(
            "project_name = \"my-game\"\n",
            "\n",
            "[order]\n",
            "objects = [\"gameMain\", \"Player\"]\n",
            "images = [\"bg.png\"]\n",
        );
        let order = parse_order(text);
        assert_eq!(order.get("objects"), Some(&names(&["gameMain", "Player"])));
        assert_eq!(order.get("images"), Some(&names(&["bg.png"])));
    }

    #[test]
    fn 空の配列も読み取れる() {
        let order = parse_order("[order]\nobjects = []\n");
        assert_eq!(order.get("objects"), Some(&Vec::<String>::new()));
    }

    #[test]
    fn 並び順セクションが無ければ空になる() {
        assert!(parse_order("project_name = \"my-game\"\n").is_empty());
    }

    #[test]
    fn セクション外の配列は読み取らない() {
        // [order] の前に書かれた配列は対象外
        let text = "objects = [\"A\"]\n[order]\nimages = [\"b.png\"]\n";
        let order = parse_order(text);
        assert_eq!(order.get("objects"), None);
        assert_eq!(order.get("images"), Some(&names(&["b.png"])));
    }

    #[test]
    fn 別セクションが始まったら読み取りを止める() {
        let text = "[order]\nobjects = [\"A\"]\n[other]\nimages = [\"b.png\"]\n";
        let order = parse_order(text);
        assert_eq!(order.get("objects"), Some(&names(&["A"])));
        assert_eq!(order.get("images"), None);
    }

    #[test]
    fn 引用符やバックスラッシュを含む名前も読み取れる() {
        // TOML上は objects = ["a\"b", "c\\d"] という記述になる
        let text = "[order]\nobjects = [\"a\\\"b\", \"c\\\\d\"]\n";
        let order = parse_order(text);
        assert_eq!(order.get("objects"), Some(&names(&["a\"b", "c\\d"])));
    }

    // --- format_order ---

    #[test]
    fn 並び順セクションを書き出せる() {
        let mut order = HashMap::new();
        order.insert("objects".to_string(), names(&["gameMain", "Player"]));
        let text = format_order(&order);
        assert!(text.contains("[order]"));
        assert!(text.contains(r#"objects = ["gameMain", "Player"]"#));
    }

    #[test]
    fn 書き出す順序は安定している() {
        let mut order = HashMap::new();
        order.insert("models".to_string(), names(&["c.glb"]));
        order.insert("objects".to_string(), names(&["A"]));
        order.insert("sounds".to_string(), names(&["b.ogg"]));
        let text = format_order(&order);
        let objects = text.find("objects").unwrap();
        let sounds = text.find("sounds").unwrap();
        let models = text.find("models").unwrap();
        assert!(objects < sounds && sounds < models);
    }

    #[test]
    fn 中身が空のキーは書き出さない() {
        let mut order = HashMap::new();
        order.insert("objects".to_string(), names(&["A"]));
        order.insert("images".to_string(), Vec::new());
        let text = format_order(&order);
        assert!(text.contains("objects"));
        assert!(!text.contains("images"));
    }

    #[test]
    fn すべて空ならセクションごと書き出さない() {
        assert_eq!(format_order(&HashMap::new()), "");
    }

    #[test]
    fn 書き出した内容は読み戻せる() {
        let mut order = HashMap::new();
        order.insert("objects".to_string(), names(&["a\"b", "Player"]));
        let text = format_order(&order);
        assert_eq!(parse_order(&text).get("objects"), Some(&names(&["a\"b", "Player"])));
    }

    // --- apply_order ---

    #[test]
    fn 保存済みの順序どおりに並べる() {
        let items = names(&["Enemy", "Player", "Boss"]);
        let saved = names(&["Boss", "Player", "Enemy"]);
        assert_eq!(apply_order(&items, &saved), names(&["Boss", "Player", "Enemy"]));
    }

    #[test]
    fn 保存後に増えた項目は末尾へ名前順で並べる() {
        let items = names(&["Enemy", "Player", "Zombie", "Angel"]);
        let saved = names(&["Player", "Enemy"]);
        assert_eq!(
            apply_order(&items, &saved),
            names(&["Player", "Enemy", "Angel", "Zombie"])
        );
    }

    #[test]
    fn 保存済みだが実在しない項目は無視する() {
        let items = names(&["Player"]);
        let saved = names(&["Boss", "Player", "Enemy"]);
        assert_eq!(apply_order(&items, &saved), names(&["Player"]));
    }

    #[test]
    fn 保存が空なら名前順になる() {
        let items = names(&["Player", "Boss", "enemy"]);
        assert_eq!(apply_order(&items, &[]), names(&["Boss", "enemy", "Player"]));
    }

    #[test]
    fn 起点オブジェクトは保存内容に関わらず先頭になる() {
        let items = names(&["Player", "gameMain", "Boss"]);
        let saved = names(&["Player", "Boss", "gameMain"]);
        assert_eq!(
            apply_order(&items, &saved),
            names(&["gameMain", "Player", "Boss"])
        );
    }

    #[test]
    fn 起点オブジェクトが保存に無くても先頭になる() {
        let items = names(&["Player", "gameMain"]);
        let saved = names(&["Player"]);
        assert_eq!(apply_order(&items, &saved), names(&["gameMain", "Player"]));
    }

    #[test]
    fn 空の一覧でも適用できる() {
        assert_eq!(apply_order(&[], &names(&["A"])), Vec::<String>::new());
    }
}
