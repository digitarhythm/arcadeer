//! ゲーム実行中のオブジェクト管理（仕様書6.2節）。
//!
//! 全オブジェクトを**一次元配列**で保持し、毎フレーム先頭から順に走査する。
//! 実体（CoffeeScript側のインスタンス）は型引数で受け取るため、
//! ブラウザに依存せず単体テストできる。

/// オブジェクトの識別子（再利用しない通し番号）
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ObjectId(pub u32);

/// 一次元配列でオブジェクトを保持する
#[derive(Debug)]
pub struct ObjectList<T> {
    entries: Vec<(ObjectId, T)>,
    pending_removal: Vec<ObjectId>,
    next_id: u32,
}

impl<T> Default for ObjectList<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> ObjectList<T> {
    /// 空の一覧を作る
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            pending_removal: Vec::new(),
            next_id: 0,
        }
    }

    /// オブジェクトを末尾へ追加する（`addObject()` 相当）
    pub fn add(&mut self, object: T) -> ObjectId {
        let id = ObjectId(self.next_id);
        // 削除済みの番号は再利用しない（古い識別子が別の実体を指さないようにする）
        self.next_id += 1;
        self.entries.push((id, object));
        id
    }

    /// 削除を予約する（`removeObject()` 相当）
    ///
    /// 走査中に配列を変更すると呼び出し順が崩れるため、
    /// 実際の削除は [`ObjectList::apply_removals`] でフレーム末に行う。
    pub fn remove(&mut self, id: ObjectId) {
        if !self.pending_removal.contains(&id) {
            self.pending_removal.push(id);
        }
    }

    /// 予約された削除をまとめて反映し、**取り除いた実体を追加順で返す**
    ///
    /// 返すのは、呼び出し側が `destructor()` を呼べるようにするため（6.2節）。
    /// 受け取った側が捨てれば、あとは JavaScript の後始末に任せられる。
    pub fn apply_removals(&mut self) -> Vec<T> {
        if self.pending_removal.is_empty() {
            return Vec::new();
        }
        let pending = std::mem::take(&mut self.pending_removal);
        let mut removed = Vec::new();
        let mut kept = Vec::with_capacity(self.entries.len());
        for (id, object) in std::mem::take(&mut self.entries) {
            if pending.contains(&id) {
                removed.push(object);
            } else {
                kept.push((id, object));
            }
        }
        self.entries = kept;
        removed
    }

    /// 削除が予約されているか
    ///
    /// 削除予約中のオブジェクトを描画対象から外す用途で使う（WebGL描画の実装時）。
    #[allow(dead_code)]
    pub fn is_removing(&self, id: ObjectId) -> bool {
        self.pending_removal.contains(&id)
    }

    /// 保持している数
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// 空かどうか
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// 追加順に走査する
    ///
    /// 描画時に全オブジェクトを順に処理する用途で使う（WebGL描画の実装時）。
    #[allow(dead_code)]
    pub fn iter(&self) -> impl Iterator<Item = (ObjectId, &T)> {
        self.entries.iter().map(|(id, object)| (*id, object))
    }

    /// 追加順のIDだけを取り出す（走査中の追加・削除に影響されない）
    pub fn ids(&self) -> Vec<ObjectId> {
        self.entries.iter().map(|(id, _)| *id).collect()
    }

    /// IDから実体を取り出す
    pub fn get(&self, id: ObjectId) -> Option<&T> {
        self.entries
            .iter()
            .find(|(entry_id, _)| *entry_id == id)
            .map(|(_, object)| object)
    }

    /// すべて取り除く（ゲーム停止時に呼ぶ）
    pub fn clear(&mut self) {
        self.entries.clear();
        self.pending_removal.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list() -> ObjectList<&'static str> {
        ObjectList::new()
    }

    #[test]
    fn starts_empty() {
        let objects = list();
        assert!(objects.is_empty());
        assert_eq!(objects.len(), 0);
    }

    #[test]
    fn keeps_insertion_order() {
        let mut objects = list();
        objects.add("Player");
        objects.add("Enemy");
        objects.add("Bullet");
        let names: Vec<&str> = objects.iter().map(|(_, name)| *name).collect();
        assert_eq!(names, vec!["Player", "Enemy", "Bullet"]);
    }

    #[test]
    fn ids_are_unique() {
        let mut objects = list();
        let a = objects.add("Player");
        let b = objects.add("Enemy");
        assert_ne!(a, b);
    }

    #[test]
    fn gets_object_by_id() {
        let mut objects = list();
        let id = objects.add("Player");
        assert_eq!(objects.get(id), Some(&"Player"));
        assert_eq!(objects.get(ObjectId(9999)), None);
    }

    #[test]
    fn apply_returns_removed_in_insertion_order() {
        let mut objects = list();
        objects.add("Player");
        let a = objects.add("Enemy");
        let b = objects.add("Bullet");
        objects.remove(b);
        objects.remove(a);
        // 消した順ではなく、**追加順**で返す（destructor の呼び出し順をそろえるため）
        assert_eq!(objects.apply_removals(), vec!["Enemy", "Bullet"]);
        assert_eq!(objects.len(), 1);
    }

    #[test]
    fn apply_returns_empty_without_removals() {
        let mut objects = list();
        objects.add("Player");
        assert!(objects.apply_removals().is_empty());
        assert_eq!(objects.len(), 1);
    }

    #[test]
    fn removal_is_deferred() {
        let mut objects = list();
        let id = objects.add("Player");
        objects.add("Enemy");
        objects.remove(id);
        // 走査中に消えると呼び出し順が崩れるため、この時点ではまだ2件
        assert_eq!(objects.len(), 2);
        assert!(objects.is_removing(id));
    }

    #[test]
    fn applies_pending_removals() {
        let mut objects = list();
        let a = objects.add("Player");
        objects.add("Enemy");
        let c = objects.add("Bullet");
        objects.remove(a);
        objects.remove(c);

        assert_eq!(objects.apply_removals(), vec!["Player", "Bullet"]);
        let names: Vec<&str> = objects.iter().map(|(_, name)| *name).collect();
        assert_eq!(names, vec!["Enemy"]);
        assert!(!objects.is_removing(a));
    }

    #[test]
    fn ids_are_not_reused() {
        let mut objects = list();
        let a = objects.add("Player");
        objects.remove(a);
        objects.apply_removals();
        let b = objects.add("Enemy");
        assert_ne!(a, b);
        assert_eq!(objects.get(a), None);
    }

    #[test]
    fn double_removal_counts_once() {
        let mut objects = list();
        let id = objects.add("Player");
        objects.remove(id);
        objects.remove(id);
        assert_eq!(objects.apply_removals(), vec!["Player"]);
        assert!(objects.is_empty());
    }

    #[test]
    fn removing_unknown_id_does_nothing() {
        let mut objects = list();
        objects.add("Player");
        objects.remove(ObjectId(9999));
        assert!(objects.apply_removals().is_empty());
        assert_eq!(objects.len(), 1);
    }

    #[test]
    fn ids_are_listed_in_insertion_order() {
        let mut objects = list();
        let a = objects.add("Player");
        let b = objects.add("Enemy");
        assert_eq!(objects.ids(), vec![a, b]);
    }

    #[test]
    fn adding_during_pass_does_not_extend_it() {
        // ids() で先に固定しておけば、behavior 内で addObject しても
        // そのフレームでは呼ばれない（次フレームから対象になる）
        let mut objects = list();
        objects.add("Player");
        let snapshot = objects.ids();
        objects.add("Bullet");
        assert_eq!(snapshot.len(), 1);
        assert_eq!(objects.len(), 2);
    }

    #[test]
    fn clear_removes_everything() {
        let mut objects = list();
        let id = objects.add("Player");
        objects.add("Enemy");
        objects.remove(id);
        objects.clear();
        assert!(objects.is_empty());
        // 予約も消える
        assert!(!objects.is_removing(id));
    }
}
