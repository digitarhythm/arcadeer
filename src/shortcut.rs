//! ゲーム実行のキーボードショートカットの判定（仕様書6.5節）。
//!
//! - **ESC** は必ず「停止」（トグルではない）
//! - **⌘（Mac）/ Windowsキー + Enter** は「実行」と「停止」のトグル
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
    /// ⌘（Mac）または Windowsキー（GUIキー）
    ///
    /// **Ctrl は含めない。**Windows では Ctrl+Enter がブラウザまで届かないことがあり、
    /// 押しても効かないキーを案内することになるため。
    pub meta: bool,
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
/// * `meta` — ⌘（Mac）または Windowsキーが押されているか
/// * `running` — ゲームを実行中か
/// * `editor_focused` — エディタにフォーカスがあるか
pub fn resolve(press: &KeyPress, ctx: &KeyContext) -> Shortcut {
    // Alt+Shift+N はフッターのログの開閉。編集中でも効かせる
    if press.code == "KeyN" && press.alt && press.shift && !press.meta {
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

    // ⌘/Windowsキー+Enter は実行と停止のトグル。エディタの編集中でも効かせる。
    // ESCと違って横取りしてよい。vimの入力モードには関わらないため
    if press.key == "Enter" && press.meta && ctx.project_open {
        return if ctx.running { Shortcut::Stop } else { Shortcut::Start };
    }

    Shortcut::None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// テスト用に、押されたキーを組み立てる（`code` は `key` から推測する）
    fn press(key: &str, meta: bool) -> KeyPress<'_> {
        KeyPress { key, code: key, meta, alt: false, shift: false }
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
    fn esc_does_not_stop_game_while_dialog_is_open() {
        // 先にゲームが止まると、ダイアログを閉じるのに2回押すことになる
        assert_eq!(resolve(&press("Escape", false), &ctx_dialog(true, false)), Shortcut::None);
    }

    #[test]
    fn dialog_closes_before_reference() {
        assert_eq!(resolve(&press("Escape", false), &ctx_dialog(true, true)), Shortcut::None);
    }

    #[test]
    fn esc_stops_game_after_dialog_closed() {
        assert_eq!(
            resolve(&press("Escape", false), &ctx(true, false, true, false)),
            Shortcut::Stop,
        );
    }

    #[test]
    fn esc_stops_while_running() {
        assert_eq!(resolve(
            &press("Escape", false),
            &ctx(true, false, true, false),
        ), Shortcut::Stop);
    }

    #[test]
    fn esc_does_nothing_when_stopped() {
        assert_eq!(resolve(
            &press("Escape", false),
            &ctx(false, false, true, false),
        ), Shortcut::None);
    }

    #[test]
    fn esc_is_ignored_while_editing() {
        // vimキーバインドで入力モードを抜けるたびに止まらないようにする
        assert_eq!(resolve(
            &press("Escape", false),
            &ctx(true, true, true, false),
        ), Shortcut::None);
    }

    #[test]
    fn meta_enter_starts_game() {
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(false, false, true, false),
        ), Shortcut::Start);
    }

    #[test]
    fn meta_enter_works_while_editing() {
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(false, true, true, false),
        ), Shortcut::Start);
    }

    #[test]
    fn meta_enter_stops_while_running() {
        // トグル。実行中に押したら止める
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(true, false, true, false),
        ), Shortcut::Stop);
    }

    #[test]
    fn meta_enter_stops_even_while_editing() {
        // ESCと違い、編集中でも横取りする（vimの入力モードには関わらないため）
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(true, true, true, false),
        ), Shortcut::Stop);
    }

    #[test]
    fn meta_enter_stop_moves_focus_to_editor() {
        let action = resolve(
            &press("Enter", true),
            &ctx(true, false, true, false),
        );
        assert_eq!(focus_after(action), FocusTarget::Editor);
    }

    #[test]
    fn meta_enter_does_nothing_without_project() {
        // プロジェクトが無ければ、実行も停止もしない
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(false, false, false, false),
        ), Shortcut::None);
    }

    #[test]
    fn plain_enter_does_nothing() {
        // Ctrl+Enter もここに入る。Ctrl は `KeyPress` に持たせていないため、
        // 修飾なしと同じ扱いになる（Windows で届かないことがあるため対象外）
        assert_eq!(resolve(
            &press("Enter", false),
            &ctx(false, false, true, false),
        ), Shortcut::None);
    }

    #[test]
    fn does_not_start_without_project() {
        assert_eq!(resolve(
            &press("Enter", true),
            &ctx(false, false, false, false),
        ), Shortcut::None);
    }

    #[test]
    fn stop_moves_focus_to_editor() {
        assert_eq!(focus_after(Shortcut::Stop), FocusTarget::Editor);
    }

    #[test]
    fn start_moves_focus_to_game() {
        assert_eq!(focus_after(Shortcut::Start), FocusTarget::Game);
    }

    #[test]
    fn no_focus_change_when_idle() {
        assert_eq!(focus_after(Shortcut::None), FocusTarget::None);
    }

    #[test]
    fn esc_stop_returns_to_editor() {
        // vimで編集中は止まらないので、止まった時点でエディタ以外にフォーカスがある
        let action = resolve(
            &press("Escape", false),
            &ctx(true, false, true, false),
        );
        assert_eq!(focus_after(action), FocusTarget::Editor);
    }

    #[test]
    fn meta_enter_moves_to_game() {
        let action = resolve(
            &press("Enter", true),
            &ctx(false, true, true, false),
        );
        assert_eq!(focus_after(action), FocusTarget::Game);
    }

    #[test]
    fn esc_closes_reference() {
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
    fn reference_closes_even_when_stopped() {
        assert_eq!(
            resolve(
            &press("Escape", false),
            &ctx(false, false, true, true),
        ),
            Shortcut::CloseReference
        );
    }

    #[test]
    fn editing_wins_over_reference() {
        assert_eq!(
            resolve(
            &press("Escape", false),
            &ctx(true, true, true, true),
        ),
            Shortcut::None
        );
    }

    #[test]
    fn closing_reference_keeps_focus() {
        assert_eq!(focus_after(Shortcut::CloseReference), FocusTarget::None);
    }

    #[test]
    fn start_shortcut_works_with_reference_open() {
        assert_eq!(
            resolve(
            &press("Enter", true),
            &ctx(false, false, true, true),
        ),
            Shortcut::Start
        );
    }

    #[test]
    fn alt_shift_n_toggles_log() {
        let p = KeyPress { key: "n", code: "KeyN", meta: false, alt: true, shift: true };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::ToggleLog);
    }

    #[test]
    fn log_toggle_works_while_editing() {
        let p = KeyPress { key: "n", code: "KeyN", meta: false, alt: true, shift: true };
        assert_eq!(resolve(&p, &ctx(true, true, true, true)), Shortcut::ToggleLog);
    }

    #[test]
    fn no_toggle_without_alt() {
        let p = KeyPress { key: "n", code: "KeyN", meta: false, alt: false, shift: true };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::None);
    }

    #[test]
    fn no_toggle_without_shift() {
        let p = KeyPress { key: "n", code: "KeyN", meta: false, alt: true, shift: false };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::None);
    }

    #[test]
    fn no_toggle_with_meta() {
        // ⌘やCtrlとの組み合わせは別の操作に使われうるため、横取りしない
        let p = KeyPress { key: "n", code: "KeyN", meta: true, alt: true, shift: true };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::None);
    }

    #[test]
    fn detects_by_code_when_key_changes() {
        // macOSでは Alt+N が「˜」になるため、key ではなく code で判定する
        let p = KeyPress { key: "˜", code: "KeyN", meta: false, alt: true, shift: true };
        assert_eq!(resolve(&p, &ctx(false, false, true, false)), Shortcut::ToggleLog);
    }

    #[test]
    fn log_toggle_keeps_focus() {
        assert_eq!(focus_after(Shortcut::ToggleLog), FocusTarget::None);
    }

    #[test]
    fn unrelated_keys_do_nothing() {
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
