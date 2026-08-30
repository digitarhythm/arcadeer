//! ゲームループのフレーム制御（仕様書6.1節）。
//!
//! 1フレームの流れは次のとおり。
//!
//! 1. オブジェクトリストの全 `behavior()` を実行し、**裏フレームバッファ**へ描画する
//! 2. 1フレームの表示時間が余っていれば待機する
//! 3. 表示時間が経過したところで、表示バッファと裏バッファを**入れ替える**
//!
//! 表示時間内に描画が終わらなかった場合は、**入れ替えを待たせる**。
//! 全 `behavior()` の実行が終わった次のタイミングで入れ替える。
//! 追いつくために更新を多重に回すことはしない（1フレームにつき1回だけ）。
//!
//! 時刻は呼び出し側（`requestAnimationFrame`）から渡すため、
//! ブラウザに依存せず単体テストできる。

use std::collections::VecDeque;

/// 既定のFPS
pub const DEFAULT_FPS: u32 = 60;
/// 設定できるFPSの下限・上限
///
/// ゲーム作成者が指定した値をそのまま使う。丸めは行わず、
/// ゼロ除算や非現実的な値を避けるための範囲制限だけを行う。
pub const MIN_FPS: u32 = 1;
pub const MAX_FPS: u32 = 240;
/// 実測FPSの平均を取るフレーム数
pub const FPS_SAMPLE_COUNT: usize = 30;

/// ゲームの実行状態
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunState {
    /// 停止中
    Stopped,
    /// 実行中
    Running,
    /// 一時停止（実行時エラーの捕捉などで止めた状態。仕様書5.8節）
    ///
    /// エラー捕捉の実装で使う。現時点では利用箇所が無い。
    #[allow(dead_code)]
    Paused,
}

impl RunState {
    /// ループを回すべき状態か
    pub fn is_running(self) -> bool {
        matches!(self, RunState::Running)
    }

    /// 実行を開始する
    pub fn start(self) -> RunState {
        RunState::Running
    }

    /// 停止する
    pub fn stop(self) -> RunState {
        RunState::Stopped
    }

    /// 一時停止する（停止中は何も起きない）
    ///
    /// ウィンドウが隠れた時の自動停止（6.1節）と、
    /// エラー捕捉（仕様書5.8節）で使う。
    pub fn pause(self) -> RunState {
        match self {
            RunState::Stopped => RunState::Stopped,
            _ => RunState::Paused,
        }
    }

    /// 一時停止から再開する（停止中は何も起きない）
    ///
    /// ウィンドウが表示へ戻った時の再開（6.1節）と、
    /// エラー捕捉（仕様書5.8節）で使う。
    pub fn resume(self) -> RunState {
        match self {
            RunState::Stopped => RunState::Stopped,
            _ => RunState::Running,
        }
    }
}

/// 目標FPSを扱える範囲に収める
///
/// **丸めは行わない**。ゲーム作成者が設定ファイルで指定した値をそのまま使う。
/// 下限・上限は、ゼロ除算や非現実的な値を避けるためだけのもの。
pub fn clamp_fps(fps: u32) -> u32 {
    fps.clamp(MIN_FPS, MAX_FPS)
}

/// ウィンドウの表示状態が変わった時に行うこと
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisibilityAction {
    /// 一時停止する
    Pause,
    /// 再開する
    Resume,
    /// 何もしない
    None,
}

/// 表示状態の変化から、行うことを決める
///
/// 隠れているタブでは `setTimeout` が1秒間隔まで制限され、1fps まで落ちてしまう。
/// 中途半端な速度で回し続けるより、**止めて戻ったら再開する**ほうが分かりやすい。
///
/// * `hidden` — ウィンドウが隠れているか
/// * `state` — 今の実行状態
/// * `paused_by_hide` — 今の一時停止が「隠れたこと」によるものか
///
/// 再開するのは**自分が止めた場合だけ**にする。
/// エラー捕捉など別の理由で止まっている場合に、勝手に動き出さないようにするため。
pub fn on_visibility_change(
    hidden: bool,
    state: RunState,
    paused_by_hide: bool,
) -> VisibilityAction {
    if hidden {
        if state == RunState::Running {
            return VisibilityAction::Pause;
        }
        return VisibilityAction::None;
    }
    if state == RunState::Paused && paused_by_hide {
        return VisibilityAction::Resume;
    }
    VisibilityAction::None
}

/// フレームの進行管理/// フレームの進行管理
///
/// 1フレームは「更新（全 `behavior()` ＋ 裏バッファ描画）」→「表示時間の待ち合わせ」→
/// 「バッファ入れ替え」の順に進む。
#[derive(Debug)]
pub struct FramePacer {
    target_fps: u32,
    /// 現フレームの開始時刻（表示時間の起点）
    frame_start_ms: Option<f64>,
    /// 裏バッファへの描画が終わったか
    drawn: bool,
    /// 直前に入れ替えた**実際の**時刻（実測FPSに使う）
    last_present_ms: Option<f64>,
    /// 実行開始からのフレーム数（`behavior` を回した回数）
    frame_index: u64,
    /// 入れ替え間隔の記録（実測FPSに使う）
    samples: VecDeque<f64>,
}

impl FramePacer {
    /// 目標FPSを指定して作る
    pub fn new(target_fps: u32) -> Self {
        Self {
            target_fps: clamp_fps(target_fps),
            frame_start_ms: None,
            drawn: false,
            last_present_ms: None,
            frame_index: 0,
            samples: VecDeque::with_capacity(FPS_SAMPLE_COUNT),
        }
    }

    /// 目標FPSを変更する
    pub fn set_target_fps(&mut self, fps: u32) {
        self.target_fps = clamp_fps(fps);
    }

    /// 現在の目標FPS
    pub fn target_fps(&self) -> u32 {
        self.target_fps
    }

    /// 1フレームの表示時間（ミリ秒）
    pub fn frame_interval_ms(&self) -> f64 {
        1000.0 / f64::from(self.target_fps)
    }

    /// このタイミングで更新（全 `behavior()` ＋ 裏バッファ描画）を行うべきか
    ///
    /// 現フレームの更新がまだなら `true`。初回はここでフレームを開始する。
    pub fn should_update(&mut self, now_ms: f64) -> bool {
        if self.frame_start_ms.is_none() {
            self.frame_start_ms = Some(now_ms);
            self.drawn = false;
        }
        !self.drawn
    }

    /// 裏バッファへの描画が終わったことを記録する
    pub fn mark_drawn(&mut self) {
        self.drawn = true;
        self.frame_index += 1;
    }

    /// 実行開始からのフレーム数（最初のフレームは 0）
    pub fn frame_index(&self) -> u64 {
        self.frame_index
    }

    /// 実行開始からの経過秒数
    ///
    /// 実時間ではなく**フレーム数から求める**。実時間だと、一時停止や処理落ちの
    /// ぶんだけ先へ飛んでしまい、ゲーム内の時間としては扱いにくいため。
    /// アニメーションの進め方（6.1節）と同じ考え方でそろえる。
    pub fn elapsed_sec(&self) -> f64 {
        self.frame_index as f64 * self.frame_interval_ms() / 1000.0
    }

    /// このタイミングでバッファを入れ替えるべきか
    ///
    /// 描画が済んでおり、かつ1フレームの表示時間が経過していれば `true`。
    /// 描画が表示時間を超えて終わった場合は、待たずに `true` になる。
    pub fn should_present(&self, now_ms: f64) -> bool {
        match self.frame_start_ms {
            // 描画が済んでいなければ、表示時間が過ぎていても入れ替えない
            Some(start) => self.drawn && now_ms >= start + self.frame_interval_ms(),
            None => false,
        }
    }

    /// バッファを入れ替えたことを記録し、次のフレームを開始する
    pub fn present(&mut self, now_ms: f64) {
        // 実測FPSは「入れ替えから入れ替えまで」で測る。
        // 理想の起点と比べると、発火の遅れが毎回の測定に乗ってしまうため。
        if let Some(previous) = self.last_present_ms {
            let interval = now_ms - previous;
            if interval > 0.0 {
                if self.samples.len() >= FPS_SAMPLE_COUNT {
                    self.samples.pop_front();
                }
                self.samples.push_back(interval);
            }
        }
        self.last_present_ms = Some(now_ms);
        // 次フレームの起点は**理想の時刻**にする。
        // 実際の入れ替え時刻を起点にすると、毎回わずかな遅れが積み上がり、
        // 締切が表示のタイミングから少しずつ後ろへずれてしまうため。
        let interval = self.frame_interval_ms();
        self.frame_start_ms = Some(match self.frame_start_ms {
            // 1フレーム以上遅れている場合は、遅れを持ち越さず今を起点に置き直す
            // （取り戻すために更新を多重に回すことはしない）
            Some(start) if now_ms <= start + interval * 2.0 => start + interval,
            _ => now_ms,
        });
        self.drawn = false;
    }

    /// 次の呼び出しまで待つ時間（ミリ秒）
    ///
    /// `setTimeout` へ渡す値。まだ描き終えていない場合は待たずに `0.0` を返す。
    /// 描き終えていれば、入れ替えの締切までの残り時間を返す（過ぎていれば `0.0`）。
    pub fn delay_until_present_ms(&self, now_ms: f64) -> f64 {
        if !self.drawn {
            return 0.0;
        }
        match self.frame_start_ms {
            Some(start) => (start + self.frame_interval_ms() - now_ms).max(0.0),
            None => 0.0,
        }
    }

    /// 直近の入れ替え間隔から求めた実測FPS（計測前は 0.0）    /// 直近の入れ替え間隔から求めた実測FPS（計測前は 0.0）
    pub fn measured_fps(&self) -> f64 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let average = self.samples.iter().sum::<f64>() / self.samples.len() as f64;
        if average <= 0.0 {
            return 0.0;
        }
        1000.0 / average
    }

    /// フレームの区切りだけを取り直す（一時停止から戻った時に呼ぶ）
    ///
    /// 実測FPSの記録は残す。止まっていた間の長い空白を
    /// 1フレームの長さとして数えないよう、直前の入れ替え時刻は忘れる。
    pub fn resync(&mut self) {
        self.frame_start_ms = None;
        self.drawn = false;
        self.last_present_ms = None;
    }

    /// 計測とフレーム状態をやり直す（実行開始・再開時に呼ぶ）    /// 計測とフレーム状態をやり直す（実行開始・再開時に呼ぶ）
    pub fn reset(&mut self) {
        self.frame_start_ms = None;
        self.drawn = false;
        self.last_present_ms = None;
        self.frame_index = 0;
        self.samples.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 60fps の1フレーム表示時間（約16.667ms）
    const FRAME60: f64 = 1000.0 / 60.0;

    /// 更新から入れ替えまでを1フレーム分進める
    ///
    /// `work_ms` は全 `behavior()` と裏バッファ描画にかかった時間。
    /// 入れ替えが起きた時刻を返す。
    fn run_frame(pacer: &mut FramePacer, start_ms: f64, work_ms: f64) -> f64 {
        assert!(pacer.should_update(start_ms), "更新が必要なはず");
        let drawn_at = start_ms + work_ms;
        pacer.mark_drawn();

        // 表示時間が経つまでは入れ替えない
        let mut now = drawn_at;
        while !pacer.should_present(now) {
            now += 1.0;
            assert!(now < start_ms + 10_000.0, "入れ替えが起きない");
        }
        pacer.present(now);
        now
    }

    // --- RunState ---

    #[test]
    fn runs_loop_only_while_running() {
        assert!(!RunState::Stopped.is_running());
        assert!(RunState::Running.is_running());
        assert!(!RunState::Paused.is_running());
    }

    #[test]
    fn start_and_stop_change_state() {
        assert_eq!(RunState::Stopped.start(), RunState::Running);
        assert_eq!(RunState::Running.stop(), RunState::Stopped);
        assert_eq!(RunState::Paused.stop(), RunState::Stopped);
    }

    #[test]
    fn can_pause_and_resume() {
        assert_eq!(RunState::Running.pause(), RunState::Paused);
        assert_eq!(RunState::Paused.resume(), RunState::Running);
    }

    #[test]
    fn stopped_ignores_pause_and_resume() {
        assert_eq!(RunState::Stopped.pause(), RunState::Stopped);
        assert_eq!(RunState::Stopped.resume(), RunState::Stopped);
    }

    // --- clamp_fps ---

    #[test]
    fn keeps_given_fps() {
        // 作成者が設定した値を勝手に丸めない
        assert_eq!(clamp_fps(60), 60);
        assert_eq!(clamp_fps(57), 57);
        assert_eq!(clamp_fps(50), 50);
        assert_eq!(clamp_fps(24), 24);
        assert_eq!(clamp_fps(144), 144);
    }

    #[test]
    fn clamps_only_invalid_values() {
        // 0 はゼロ除算になるため下限へ寄せる
        assert_eq!(clamp_fps(0), MIN_FPS);
        assert_eq!(clamp_fps(MIN_FPS), MIN_FPS);
        assert_eq!(clamp_fps(MAX_FPS), MAX_FPS);
        assert_eq!(clamp_fps(9999), MAX_FPS);
    }

    // --- 目標FPSと表示時間 ---

    #[test]
    fn frame_interval_from_target_fps() {
        assert!((FramePacer::new(60).frame_interval_ms() - FRAME60).abs() < 1e-9);
        assert!((FramePacer::new(30).frame_interval_ms() - 1000.0 / 30.0).abs() < 1e-9);
    }

    #[test]
    fn target_fps_is_kept() {
        assert_eq!(FramePacer::new(57).target_fps(), 57);
        assert_eq!(FramePacer::new(24).target_fps(), 24);
        // 扱えない値のときだけ範囲へ収める
        assert_eq!(FramePacer::new(0).target_fps(), MIN_FPS);
    }

    #[test]
    fn changing_fps_changes_interval() {
        let mut pacer = FramePacer::new(60);
        pacer.set_target_fps(30);
        assert_eq!(pacer.target_fps(), 30);
        assert!((pacer.frame_interval_ms() - 1000.0 / 30.0).abs() < 1e-9);
    }

    // --- 1フレームの流れ ---

    #[test]
    fn update_needed_right_after_start() {
        let mut pacer = FramePacer::new(60);
        assert!(pacer.should_update(0.0));
    }

    #[test]
    fn no_present_before_update() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        // 描画が済んでいなければ、表示時間が過ぎても入れ替えない
        assert!(!pacer.should_present(FRAME60 * 2.0));
    }

    #[test]
    fn waits_interval_before_present() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        // 5ms で描き終わっても、表示時間（約16.7ms）までは待つ
        assert!(!pacer.should_present(5.0));
        assert!(!pacer.should_present(FRAME60 - 0.1));
    }

    #[test]
    fn presents_after_interval() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        assert!(pacer.should_present(FRAME60));
    }

    #[test]
    fn update_needed_after_present() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        pacer.present(FRAME60);
        assert!(pacer.should_update(FRAME60));
    }

    #[test]
    fn no_double_update_in_one_frame() {
        let mut pacer = FramePacer::new(60);
        assert!(pacer.should_update(0.0));
        pacer.mark_drawn();
        // 入れ替えるまでは、何度呼ばれても更新しない
        assert!(!pacer.should_update(1.0));
        assert!(!pacer.should_update(5.0));
    }

    // --- 表示時間を超えた場合 ---

    #[test]
    fn presents_without_wait_when_late() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        // 表示時間（約16.7ms）を超える 40ms かかった
        pacer.mark_drawn();
        assert!(pacer.should_present(40.0));
    }

    #[test]
    fn no_catch_up_updates_when_slow() {
        // 追いつくための巻き戻し・多重更新は行わない（1フレーム1回だけ）
        let mut pacer = FramePacer::new(60);
        let end = run_frame(&mut pacer, 0.0, 100.0);
        // 100ms かかった次のフレームでも、更新は1回だけ
        assert!(pacer.should_update(end));
        pacer.mark_drawn();
        assert!(!pacer.should_update(end + 1.0));
    }

    #[test]
    fn no_catch_up_after_long_pause() {
        // タブ非表示から復帰した想定
        let mut pacer = FramePacer::new(60);
        run_frame(&mut pacer, 0.0, 1.0);
        // 10秒後に再開しても、更新は1回だけ
        assert!(pacer.should_update(10_000.0));
        pacer.mark_drawn();
        assert!(!pacer.should_update(10_001.0));
    }

    // --- 実測FPS ---

    #[test]
    fn measured_fps_is_zero_before_sampling() {
        assert_eq!(FramePacer::new(60).measured_fps(), 0.0);
    }

    #[test]
    fn measured_fps_matches_target_when_idle() {
        let mut pacer = FramePacer::new(60);
        let mut now = 0.0;
        for _ in 0..20 {
            // 1フレームの処理は 5ms で終わる（表示時間まで待つ）
            now = run_frame(&mut pacer, now, 5.0);
        }
        assert!(
            (pacer.measured_fps() - 60.0).abs() < 1.5,
            "実測 {}",
            pacer.measured_fps()
        );
    }

    #[test]
    fn measured_fps_drops_when_slow() {
        let mut pacer = FramePacer::new(60);
        let mut now = 0.0;
        for _ in 0..20 {
            // 1フレームの処理に 50ms かかる（表示時間を超える）
            now = run_frame(&mut pacer, now, 50.0);
        }
        // 約20fps まで落ちる（追いつこうとしないぶん、素直に遅くなる）
        assert!(
            (pacer.measured_fps() - 20.0).abs() < 1.5,
            "実測 {}",
            pacer.measured_fps()
        );
    }

    #[test]
    fn reset_clears_measurement_and_state() {
        let mut pacer = FramePacer::new(60);
        let mut now = 0.0;
        for _ in 0..5 {
            now = run_frame(&mut pacer, now, 5.0);
        }
        pacer.reset();
        assert_eq!(pacer.measured_fps(), 0.0);
        // フレームの起点も未設定に戻る
        assert!(pacer.should_update(now));
    }
}

/// 表示領域に収まる大きさを求める（縦横比を保つ）
///
/// 長い方を表示領域へ合わせ、短い方は余白ができる（中央に置く前提）。
/// 表示領域や解像度が0以下の場合は 0 を返す。
pub fn fit_size(area_width: f64, area_height: f64, width: u32, height: u32) -> (f64, f64) {
    if area_width <= 0.0 || area_height <= 0.0 || width == 0 || height == 0 {
        return (0.0, 0.0);
    }
    let scale = (area_width / f64::from(width)).min(area_height / f64::from(height));
    (f64::from(width) * scale, f64::from(height) * scale)
}

#[cfg(test)]
mod fit_tests {
    use super::*;

    /// 誤差を許して比べる
    fn close(actual: (f64, f64), expected: (f64, f64)) {
        assert!(
            (actual.0 - expected.0).abs() < 0.01 && (actual.1 - expected.1).abs() < 0.01,
            "期待 {expected:?} に対し {actual:?}"
        );
    }

    #[test]
    fn fits_height_when_area_is_wide() {
        // 800x400 の領域に 640x480（縦長寄り）を入れる → 高さいっぱい
        close(fit_size(800.0, 400.0, 640, 480), (533.33, 400.0));
    }

    #[test]
    fn fits_width_when_area_is_tall() {
        // 400x800 の領域に 640x480 を入れる → 幅いっぱい
        close(fit_size(400.0, 800.0, 640, 480), (400.0, 300.0));
    }

    #[test]
    fn fits_exactly_with_same_ratio() {
        close(fit_size(1280.0, 960.0, 640, 480), (1280.0, 960.0));
    }

    #[test]
    fn shrinks_for_small_area() {
        close(fit_size(320.0, 240.0, 640, 480), (320.0, 240.0));
    }

    #[test]
    fn grows_for_large_area() {
        close(fit_size(1920.0, 1440.0, 640, 480), (1920.0, 1440.0));
    }

    #[test]
    fn keeps_aspect_ratio() {
        let (w, h) = fit_size(1000.0, 333.0, 640, 480);
        assert!(((w / h) - (640.0 / 480.0)).abs() < 0.001);
    }

    #[test]
    fn returns_zero_for_invalid_size() {
        assert_eq!(fit_size(0.0, 400.0, 640, 480), (0.0, 0.0));
        assert_eq!(fit_size(800.0, 0.0, 640, 480), (0.0, 0.0));
        assert_eq!(fit_size(800.0, 400.0, 0, 480), (0.0, 0.0));
        assert_eq!(fit_size(800.0, 400.0, 640, 0), (0.0, 0.0));
    }
}

#[cfg(test)]
mod pacing_tests {
    use super::*;

    /// 60fps の1フレーム表示時間（約16.667ms）
    const FRAME60: f64 = 1000.0 / 60.0;

    /// 1フレームを進める（描画にかかる時間と、入れ替えの遅れを指定する）
    fn advance(pacer: &mut FramePacer, start: f64, work_ms: f64, late_ms: f64) -> f64 {
        assert!(pacer.should_update(start));
        pacer.mark_drawn();
        let drawn_at = start + work_ms;
        let wait = pacer.delay_until_present_ms(drawn_at);
        // setTimeout は要求より少し遅れて発火する
        let at = drawn_at + wait + late_ms;
        assert!(pacer.should_present(at));
        pacer.present(at);
        at
    }

    #[test]
    fn returns_time_left_until_deadline() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        // 2ms 使ったので、残りは 1フレーム − 2ms
        let delay = pacer.delay_until_present_ms(2.0);
        assert!((delay - (FRAME60 - 2.0)).abs() < 1e-9);
    }

    #[test]
    fn no_wait_before_drawing() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        // 描画がまだなら、すぐ次の処理へ進む
        assert_eq!(pacer.delay_until_present_ms(2.0), 0.0);
    }

    #[test]
    fn no_wait_past_deadline() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        assert_eq!(pacer.delay_until_present_ms(FRAME60 + 5.0), 0.0);
    }

    #[test]
    fn deadline_keeps_ideal_time_when_late() {
        let mut pacer = FramePacer::new(60);
        // 毎回 0.5ms ずつ遅れて発火しても、締切はずれていかない
        let mut at = advance(&mut pacer, 0.0, 2.0, 0.5);
        for _ in 0..50 {
            at = advance(&mut pacer, at, 2.0, 0.5);
        }
        // 51フレームぶん進んでいるはず（遅れは毎回 0.5ms のみ）
        let ideal = FRAME60 * 51.0;
        assert!((at - ideal).abs() < 1.0, "実際 {} 理想 {}", at, ideal);
    }

    #[test]
    fn measured_fps_stays_on_target() {
        let mut pacer = FramePacer::new(60);
        let mut at = 0.0;
        for _ in 0..60 {
            at = advance(&mut pacer, at, 2.0, 0.5);
        }
        assert!(
            (pacer.measured_fps() - 60.0).abs() < 1.0,
            "実測 {}",
            pacer.measured_fps()
        );
    }

    #[test]
    fn resets_deadline_when_far_behind() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        // 描画が長引き、3フレームぶん過ぎてから入れ替えた
        let late = FRAME60 * 3.0;
        pacer.present(late);
        // 次の締切は「今」から1フレーム後。取り戻すために詰めたりはしない
        pacer.should_update(late);
        pacer.mark_drawn();
        let delay = pacer.delay_until_present_ms(late);
        assert!((delay - FRAME60).abs() < 1e-9, "待ち時間 {}", delay);
    }

    #[test]
    fn changing_fps_changes_wait() {
        let mut pacer = FramePacer::new(30);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        let delay = pacer.delay_until_present_ms(0.0);
        assert!((delay - 1000.0 / 30.0).abs() < 1e-9);
    }
}

#[cfg(test)]
mod visibility_tests {
    use super::*;

    const FRAME60: f64 = 1000.0 / 60.0;

    #[test]
    fn pauses_when_hidden_while_running() {
        assert_eq!(
            on_visibility_change(true, RunState::Running, false),
            VisibilityAction::Pause
        );
    }

    #[test]
    fn hiding_does_nothing_when_stopped() {
        assert_eq!(
            on_visibility_change(true, RunState::Stopped, false),
            VisibilityAction::None
        );
    }

    #[test]
    fn no_double_pause() {
        assert_eq!(
            on_visibility_change(true, RunState::Paused, true),
            VisibilityAction::None
        );
    }

    #[test]
    fn resumes_when_shown_again() {
        assert_eq!(
            on_visibility_change(false, RunState::Paused, true),
            VisibilityAction::Resume
        );
    }

    #[test]
    fn no_resume_when_paused_for_other_reason() {
        // エラー捕捉などで止めた一時停止を、表示へ戻っただけで動かさない
        assert_eq!(
            on_visibility_change(false, RunState::Paused, false),
            VisibilityAction::None
        );
    }

    #[test]
    fn showing_does_nothing_while_running() {
        assert_eq!(
            on_visibility_change(false, RunState::Running, false),
            VisibilityAction::None
        );
    }

    #[test]
    fn showing_does_nothing_when_stopped() {
        assert_eq!(
            on_visibility_change(false, RunState::Stopped, true),
            VisibilityAction::None
        );
    }

    #[test]
    fn resume_resyncs_frame() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        pacer.present(FRAME60);

        pacer.resync();
        // 次のフレームは「今」から始まる
        assert!(pacer.should_update(9999.0));
        assert!(!pacer.should_present(9999.0), "描画前は入れ替えない");
    }

    #[test]
    fn resume_keeps_fps_samples() {
        let mut pacer = FramePacer::new(60);
        let mut at = 0.0;
        for _ in 0..5 {
            pacer.should_update(at);
            pacer.mark_drawn();
            at += FRAME60;
            pacer.present(at);
        }
        let before = pacer.measured_fps();
        pacer.resync();
        assert!((pacer.measured_fps() - before).abs() < 1e-9);
    }

    #[test]
    fn paused_gap_is_not_counted() {
        let mut pacer = FramePacer::new(60);
        pacer.should_update(0.0);
        pacer.mark_drawn();
        pacer.present(FRAME60);

        // 10秒間隠れていた
        pacer.resync();

        // 再開後は、最初の入れ替えを起点に測り直す
        let mut at = 10_000.0;
        for _ in 0..3 {
            pacer.should_update(at);
            pacer.mark_drawn();
            at += FRAME60;
            pacer.present(at);
        }

        // 10秒ぶんの間隔が記録に混じっていないこと
        assert!(pacer.measured_fps() > 30.0, "実測 {}", pacer.measured_fps());
    }
}

#[cfg(test)]
mod event_tests {
    use super::*;

    const FRAME60: f64 = 1000.0 / 60.0;

    /// 1フレーム進める
    fn step(pacer: &mut FramePacer, at: f64) -> f64 {
        pacer.should_update(at);
        pacer.mark_drawn();
        let next = at + pacer.frame_interval_ms();
        pacer.present(next);
        next
    }

    #[test]
    fn first_frame_is_zero() {
        let pacer = FramePacer::new(60);
        assert_eq!(pacer.frame_index(), 0);
        assert!(pacer.elapsed_sec().abs() < 1e-9);
    }

    #[test]
    fn frame_index_advances_per_pass() {
        let mut pacer = FramePacer::new(60);
        let mut at = 0.0;
        for expected in 1..=5 {
            at = step(&mut pacer, at);
            assert_eq!(pacer.frame_index(), expected);
        }
    }

    #[test]
    fn elapsed_from_frame_count() {
        let mut pacer = FramePacer::new(60);
        let mut at = 0.0;
        for _ in 0..60 {
            at = step(&mut pacer, at);
        }
        // 60fps で60フレーム ＝ 1秒
        assert!((pacer.elapsed_sec() - 1.0).abs() < 1e-9, "経過 {}", pacer.elapsed_sec());
    }

    #[test]
    fn elapsed_depends_on_target_fps() {
        let mut pacer = FramePacer::new(30);
        let mut at = 0.0;
        for _ in 0..30 {
            at = step(&mut pacer, at);
        }
        assert!((pacer.elapsed_sec() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn pause_does_not_skip_time() {
        let mut pacer = FramePacer::new(60);
        let mut at = 0.0;
        for _ in 0..30 {
            at = step(&mut pacer, at);
        }
        let before = pacer.elapsed_sec();

        // 10秒間隠れていた
        pacer.resync();
        step(&mut pacer, at + 10_000.0);

        // 進むのは1フレームぶんだけ
        assert!(
            (pacer.elapsed_sec() - before - FRAME60 / 1000.0).abs() < 1e-9,
            "経過 {}",
            pacer.elapsed_sec()
        );
    }

    #[test]
    fn restart_resets_frame_index() {
        let mut pacer = FramePacer::new(60);
        step(&mut pacer, 0.0);
        pacer.reset();
        assert_eq!(pacer.frame_index(), 0);
        assert!(pacer.elapsed_sec().abs() < 1e-9);
    }
}
