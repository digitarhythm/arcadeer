//! object URL の持ち主管理。
//!
//! サムネイルに使う object URL は、作った側が責任を持って解放する必要がある。
//! ただし**まとめて全部捨ててよい場面と、1件だけ捨てたい場面**がある。
//!
//! - 一覧を作り直す（タブの切り替えなど）… 前の一覧のカードはもう無いので、全部捨てる
//! - 1件だけ作り直す（⌘S・実行前の自動保存）… **他のカードは画面に残っている**ので、
//!   そのぶんまで捨てると、ホバー回転などが効かなくなる
//!
//! そこで「誰のURLか」を一緒に覚え、持ち主を指定して取り出せるようにする。
//! DOMに依存しないため単体テストできる。

/// 持ち主とURLの組
pub type OwnedUrl = (String, String);

/// 指定した持ち主のURLだけを取り出す（取り出したものは一覧から消える）
///
/// 呼び出し側は、返ってきたURLを解放する。
/// 持ち主が1つも一致しなければ、一覧は変わらず空を返す。
pub fn take_urls_for(list: &mut Vec<OwnedUrl>, owners: &[String]) -> Vec<String> {
    let mut taken = Vec::new();
    list.retain(|(owner, url)| {
        if owners.iter().any(|o| o == owner) {
            taken.push(url.clone());
            false
        } else {
            true
        }
    });
    taken
}

/// すべてのURLを取り出す（一覧は空になる）
pub fn take_all_urls(list: &mut Vec<OwnedUrl>) -> Vec<String> {
    list.drain(..).map(|(_, url)| url).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<OwnedUrl> {
        vec![
            ("player".to_string(), "blob:a".to_string()),
            ("enemy".to_string(), "blob:b".to_string()),
            ("player".to_string(), "blob:c".to_string()),
        ]
    }

    #[test]
    fn takes_only_the_named_owner() {
        let mut list = sample();
        let taken = take_urls_for(&mut list, &["player".to_string()]);
        assert_eq!(taken, vec!["blob:a".to_string(), "blob:c".to_string()]);
        // 他の持ち主のぶんは残す（画面に残っているカードのURLを無効にしないため）
        assert_eq!(list, vec![("enemy".to_string(), "blob:b".to_string())]);
    }

    #[test]
    fn takes_several_owners_at_once() {
        let mut list = sample();
        let taken = take_urls_for(&mut list, &["player".to_string(), "enemy".to_string()]);
        assert_eq!(taken.len(), 3);
        assert!(list.is_empty());
    }

    #[test]
    fn unknown_owner_changes_nothing() {
        let mut list = sample();
        assert!(take_urls_for(&mut list, &["ghost".to_string()]).is_empty());
        assert_eq!(list, sample());
    }

    #[test]
    fn empty_owners_change_nothing() {
        let mut list = sample();
        assert!(take_urls_for(&mut list, &[]).is_empty());
        assert_eq!(list, sample());
    }

    #[test]
    fn takes_everything() {
        let mut list = sample();
        assert_eq!(take_all_urls(&mut list), vec!["blob:a", "blob:b", "blob:c"]);
        assert!(list.is_empty());
    }
}
