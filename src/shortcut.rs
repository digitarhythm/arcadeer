//! ゲーム実行のキーボードショートカットの判定（仕様書6.5節）。
//!
//! - **ESC** は必ず「停止」（トグルではない）
//! - **⌘/Ctrl + Enter** は必ず「実行」（トグルではない）
//!
//! ただしエディタにフォーカスがある間は ESC を横取りしない。
//! vimキーバインドでは ESC で入力モードを抜けるため、そのたびに
//! ゲームが止まってしまうのを避ける。
//!
//! DOMに依存しないため単体テストできる。

/// ショートカットの判定結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shortcut {
    /// ゲームを停止する
    Stop,
    /// ゲームを実行する
    Start,
    /// リファレンスを閉じる
    CloseReference,
    /// フッターのログの開閉を切り替える
    ToggleLog,
    /// 何もしない（既定の動作をそのまま通す）
    None,
}

/// 操作のあとにフォーカスを移す先
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusTarget {
    /// エディタ（続けてコードを直せるように）
    Editor,
    /// ゲーム表示エリア（そのまま操作できるように）
    Game,
    /// 移さない
    None,
}

/// 操作に応じて、フォーカスを移す先を決める
///
/// キーボードだけで「直す → 動かす → 止める → 直す」と往復できるようにする。
pub fn focus_after(action: Shortcut) -> FocusTarget {
    match action {
        // 止めたら、すぐ続きを書けるようにする
        Shortcut::Stop => FocusTarget::Editor,
        // 実行したら、そのままキー操作をゲームへ送れるようにする
        Shortcut::Start => FocusTarget::Game,
        // 読むのをやめただけなので、フォーカスは動かさない
        Shortcut::CloseReference => FocusTarget::None,
        // 編集を続けられるよう、フォーカスは動かさない
        Shortcut::ToggleLog => FocusTarget::None,
        Shortcut::None => FocusTarget::None,
    }
}

/// 押されたキーの内容
///
/// `key` と `code` を分けて持つのは、**macOSでは Alt を押すと `key` が
/// 別の文字になる**ため。修飾キーを伴う判定には `code` を使う。
#[derive(Debug, Clone, Copy)]
pub struct KeyPress<'a> {
    /// `KeyboardEvent.key`（`"Escape"` `"Enter"` など）
    pub key: &'a str,
    /// `KeyboardEvent.code`（`"KeyN"` など。配列や修飾キーに影響されない）
    pub code: &'a str,
    /// ⌘（Mac）または Ctrl
    pub command: bool,
    /// Alt（Option）
    pub alt: bool,
    /// Shift
    pub shift: bool,
}

/// そのときのIDEの状態
#[derive(Debug, Clone, Copy)]
pub struct KeyContext {
    /// ゲームを実行中か
    pub running: bool,
    /// エディタにフォーカスがあるか
    pub editor_focused: bool,
    /// プロジェクトを開いているか
    pub project_open: bool,
    /// リファレンスを開いているか
    pub reference_open: bool,
    /// ダイアログ（キーコンフィグなど）を開いているか
    pub dialog_open: bool,
}

/// 押されたキーから、行う操作を決める
///
/// * `key` — `KeyboardEvent.key`
/// * `command` — ⌘（Mac）または Ctrl が押されているか
/// * `running` — ゲームを実行中か
/// * `editor_focused` — エディタにフォーカスがあるか
pub fn resolve(press: &KeyPress, ctx: &KeyContext) -> Shortcut {
    // Alt+Shift+N はフッターのログの開閉。編集中でも効かせる
    if press.code == "KeyN" && press.alt && press.shift && !press.command {
        return Shortcut::ToggleLog;
    }

    if press.key == "Escape" {
        // ダイアログを開いている間は横取りしない。
        // ESCで閉じるのはダイアログの役目で、**ゲームを止めるより先**に来る。
        // 横取りするとゲームだけが止まり、閉じるのに2回押すことになる。
        if ctx.dialog_open {
            return Shortcut::None;
        }
        // エディタの編集中は横取りしない（vimが入力モードを抜けるのに使うため）
        if ctx.editor_focused {
            return Shortcut::None;
        }
        // 読んでいるものを閉じるほうが先。ゲームは止めない
        if ctx.reference_open {
            return Shortcut::CloseReference;
        }
        if ctx.running {
            return Shortcut::Stop;
        }
        return Shortcut::None;
    }

    // ⌘/Ctrl+Enter は必ず実行。エディタの編集中でも効かせる
    if press.key == "Enter" && press.command && !ctx.running && ctx.project_open {
        return Shortcut::Start;
    }

    Shortcut::None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// テスト用に、押されたキーを組み立てる（`code` は `key` から推測する）
    fn press(key: &str, command: bool) -> KeyPress<'_> {
        KeyPress { key, code: key, command, alt: false, shift: false }
    }

    /// テスト用に、そのときの状態を組み立てる
    fn ctx(running: bool, editor_focused: bool, project_open: bool, reference_open: bool) -> KeyContext {
        KeyContext { running, editor_focused, project_open, reference_open, dialog_open: false }
    }

    /// ダイアログを開いている状態
    fn ctx_dialog(running: bool, reference_open: bool) -> KeyContext {
        KeyContext {
            running,
            editor_focused: false,
            project_open: true,
            reference_open,
            dialog_open: true,
        }
    }

    #[test]
    fn ダイアログを開いている間のescはゲームを止めない() {
        // 先にゲームが止まると、ダイアログを閉じるのに2回押すことになる
        assert_eq!(resolve(&press("Escape", false), &ctx_dialog(true, false)), Shortcut::None);
    }

    #[test]
    fn ダイアログはリファレンスよりも先に閉じる() {
        assert_eq!(resolve(&press("Escape", false), &ctx_dialog(true, true)), Shortcut::None);
    }

    #[test]
    fn ダイアログを閉じたあとのescはゲームを止める() {
        assert_eq!(
            resolve(&press("Escape", false), &ctx(true, false, true, false)),
            Shortcut::Stop,
        );
    }

    #[test]
    fn escキーは実行中なら停止する() {
        assert_eq!(resolve(
            &press("Escape", false),
            &ctx(true, false, true, false),
        ), Shortcut::Stop);
    }

    #[test]
    fn escキーは停止中ならなにもしない() {
        assert_eq!(resolve(
            &press("Escape", false),
            &ctx(false, false, true, false),
        ), Shortcut::None);
    }

    #[test]
    fn escキーはエディタにフォーカスがあれば停止しない() {
        // vimキーバインドで入力モードを抜けるたびに止まらないようにする
        assert_eq!(resolve(
            &press("Escape", false),
            &ctx(true, true, true, false),
        ), Shortcut::None);
    }

    #[test]
    fn コマンドとenterで実行する() {
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(false, false, true, false),
        ), Shortcut::Start);
    }

    #[test]
    fn コマンドとenterはエディタにフォーカスがあっても実行する() {
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(false, true, true, false),
        ), Shortcut::Start);
    }

    #[test]
    fn コマンドとenterは実行中ならなにもしない() {
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(true, false, true, false),
        ), Shortcut::None);
    }

    #[test]
    fn コマンドなしのenterはなにもしない() {
        assert_eq!(resolve(
            &press("Enter", false),
            &ctx(false, false, true, false),
        ), Shortcut::None);
    }

    #[test]
    fn プロジェクトを開いていなければ実行しない() {
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(false, false, false, false),
        ), Shortcut::None);
    }

    #[test]
    fn 停止したらエディタへフォーカスを移す() {
        assert_eq!(focus_after(Shortcut::Stop), FocusTarget::Editor);
    }

    #[test]
    fn 実行したらゲーム表示エリアへフォーカスを移す() {
        assert_eq!(focus_after(Shortcut::Start), FocusTarget::Game);
    }

    #[test]
    fn なにもしない場合はフォーカスを移さない() {
        assert_eq!(focus_after(Shortcut::None), FocusTarget::None);
    }

    #[test]
    fn escでの停止はエディタへ戻る() {
        // vimで編集中は止まらないので、止まった時点でエディタ以外にフォーカスがある
        let action = resolve(
            &press("Escape", false),
            &ctx(true, false, true, false),
        );
        assert_eq!(focus_after(action), FocusTarget::Editor);
    }

    #[test]
    fn コマンドとenterでの実行はゲームへ移る() {
        let action = resolve(
            &press("Enter", true),
            &ctx(false, true, true, false),
        );
        assert_eq!(focus_after(action), FocusTarget::Game);
    }

    #[test]
    fn escキーはリファレンスが開いていれば閉じる() {
        // 読んでいるものを閉じるほうが先。ゲームは止めない
        assert_eq!(
            resolve(
            &press("Escape", false),
            &ctx(true, false, true, true),
        ),
            Shortcut::CloseReference
        );
    }

    #[test]
    fn 停止中でもリファレンスは閉じる() {
        assert_eq!(
            resolve(
            &press("Escape", false),
            &ctx(false, false, true, true),
        ),
            Shortcut::CloseReference
        );
    }

    #[test]
    fn リファレンスが開いていてもエディタ編集中はなにもしない() {
        assert_eq!(
            resolve(
            &press("Escape", false),
            &ctx(true, true, true, true),
        ),
            Shortcut::None
        );
    }

    #[test]
    fn リファレンスを閉じてもフォーカスは動かさない() {
        assert_eq!(focus_after(Shortcut::CloseReference), FocusTarget::None);
    }

    #[test]
    fn リファレンスが開いていても実行のショートカットは効く() {
        assert_eq!(
            resolve(
            &press("Enter", true),
            &ctx(false, false, true, true),
        ),
            Shortcut::Start
        );
    }

    #[test]
    fn altとshiftとnでログの開閉を切り替える() {
        let p = KeyPress { key: "n", code: "KeyN", command: false, alt: true, shift: true };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::ToggleLog);
    }

    #[test]
    fn ログの開閉はエディタ編集中でも効く() {
        let p = KeyPress { key: "n", code: "KeyN", command: false, alt: true, shift: true };
        assert_eq!(resolve(&p, &ctx(true, true, true, true)), Shortcut::ToggleLog);
    }

    #[test]
    fn altを押していない場合は切り替えない() {
        let p = KeyPress { key: "n", code: "KeyN", command: false, alt: false, shift: true };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::None);
    }

    #[test]
    fn shiftを押していない場合は切り替えない() {
        let p = KeyPress { key: "n", code: "KeyN", command: false, alt: true, shift: false };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::None);
    }

    #[test]
    fn コマンドを伴う場合は切り替えない() {
        // ⌘やCtrlとの組み合わせは別の操作に使われうるため、横取りしない
        let p = KeyPress { key: "n", code: "KeyN", command: true, alt: true, shift: true };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::None);
    }

    #[test]
    fn 文字が変わってもcodeで見分ける() {
        // macOSでは Alt+N が「˜」になるため、key ではなく code で判定する
        let p = KeyPress { key: "˜", code: "KeyN", command: false, alt: true, shift: true };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::ToggleLog);
    }

    #[test]
    fn ログの開閉ではフォーカスを動かさない() {
        assert_eq!(focus_after(Shortcut::ToggleLog), FocusTarget::None);
    }

    #[test]
    fn 関係のないキーはなにもしない() {
        assert_eq!(resolve(
            &press("a", false),
            &ctx(true, false, true, false),
        ), Shortcut::None);
        assert_eq!(resolve(
            &press("Space", true),
            &ctx(false, false, true, false),
        ), Shortcut::None);
    }
}
