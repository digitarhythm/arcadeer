mod class_name;
mod class_source;
mod frame;
mod i18n;
mod listing;
mod objects;
mod ordering;
mod shortcut;

use class_name::{validate_class_name, MAX_CLASS_NAME_LEN};
use class_source::parse_model_ref;
use frame::{
    fit_size, on_visibility_change, FramePacer, RunState, VisibilityAction, DEFAULT_FPS,
};
use i18n::{t, t_with};
use objects::ObjectList;
use ordering::{apply_order, format_order, order_key_for_tab, parse_order};
use shortcut::{
    focus_after, resolve as resolve_shortcut, FocusTarget, KeyContext, KeyPress, Shortcut,
};
use listing::{
    active_tab_index, build_pane_tabs, class_file_name, classify_resource, compare_display_names,
    is_primitive_name,
    is_entry_object,
    kind_from_tab_key, PaneTab, ENTRY_OBJECT_NAME,
    ResourceKind, ASSETS_DIR, CODE_DIR, PROJECT_DIRS, RESOURCE_ORDER,
};

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::{
    window, Document, Element, File, FileSystemDirectoryHandle, FileSystemFileHandle,
    FileSystemGetDirectoryOptions, FileSystemGetFileOptions, FileSystemWritableFileStream,
    HtmlButtonElement, HtmlDialogElement, HtmlInputElement, Response, Url,
};

/// 左ペインのオブジェクトタブを表す翻訳キー
const OBJECT_TAB_KEY: &str = "pane.tab.object";
/// 左ペインの画像タブを表す翻訳キー
const IMAGE_TAB_KEY: &str = "pane.tab.image";
/// 左ペインの音声タブを表す翻訳キー
const SOUND_TAB_KEY: &str = "pane.tab.sound";
/// 左ペインの3Dモデルタブを表す翻訳キー
const MODEL_TAB_KEY: &str = "pane.tab.model";
/// プロジェクトアイコンのファイル名（プロジェクトディレクトリ直下に配置）
const ICON_FILE_NAME: &str = "icon.png";
/// 新規プロジェクトへコピーするデフォルトアイコン（512x512 PNG）
/// アセットの対応表（キー名 ↔ ファイル名）を置くファイル（仕様書5.7節）
const ASSET_MAP_FILE: &str = "assets.toml";

const DEFAULT_ICON_URL: &str = "./templates/assets/default-icon.png";
/// 新規プロジェクトへコピーするデフォルト3Dモデル（glTF 2.0 バイナリ）
const DEFAULT_MODEL_URL: &str = "./templates/assets/default-cat.glb";
/// コピー後のデフォルト3Dモデルのファイル名
const DEFAULT_MODEL_FILE: &str = "default-cat.glb";
/// 直前に開いていたプロジェクト（GUIDディレクトリ名）の保存先
const LAST_PROJECT_KEY: &str = "arcadeer.lastProject";

thread_local! {
    /// 開いているプロジェクトのディレクトリハンドル（今後の編集機能で使用）
    static CURRENT_PROJECT: RefCell<Option<FileSystemDirectoryHandle>> = const { RefCell::new(None) };
    /// プロジェクト一覧のアイコン表示に発行した object URL（再スキャン時に解放する）
    static ICON_URLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    /// 左ペインで選択中のタブの翻訳キー（新規オブジェクト作成の可否判定に使う）
    static SELECTED_TAB: RefCell<String> = const { RefCell::new(String::new()) };
    /// 左ペインに表示中のオブジェクト名（クラス名の重複判定に使う）
    static CURRENT_OBJECTS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    /// 左ペインに表示中のタブ一式
    ///
    /// タブ切り替え時はここから読み直す。描画時点の内容を抱え込むと、
    /// 並べ替えの結果がタブを切り替えたときに失われるため。
    static PANE_TABS: RefCell<Vec<PaneTab>> = const { RefCell::new(Vec::new()) };
    /// エディタで開いているクラスファイル名
    static CURRENT_FILE: RefCell<Option<String>> = const { RefCell::new(None) };
    /// 開いているプロジェクトの表示名（左ペイン最上部に表示する）
    static CURRENT_PROJECT_NAME: RefCell<String> = const { RefCell::new(String::new()) };
    /// 画像サムネイル表示に発行した object URL（再描画時に解放する）
    static ASSET_URLS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    /// ゲームの実行状態
    static RUN_STATE: RefCell<RunState> = const { RefCell::new(RunState::Stopped) };
    /// フレームの進行管理
    static PACER: RefCell<Option<FramePacer>> = const { RefCell::new(None) };
    /// 今の一時停止が「ウィンドウが隠れたこと」によるものか
    ///
    /// エラー捕捉など別の理由で止まっている場合に、表示へ戻っただけで
    /// 勝手に動き出さないようにするための目印（6.1節）。
    static PAUSED_BY_HIDE: RefCell<bool> = const { RefCell::new(false) };
    /// 実行中のオブジェクトリスト（一次元配列。実体はCoffeeScript側のインスタンス）
    static GAME_OBJECTS: RefCell<ObjectList<JsValue>> = RefCell::new(ObjectList::new());
    /// FPS表示を最後に書き換えた時刻（毎フレーム書き換えないための間引きに使う）
    static FPS_SHOWN_AT: RefCell<f64> = const { RefCell::new(0.0) };
}

#[wasm_bindgen(start)]
pub fn start() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    let document = window()
        .ok_or_else(|| JsValue::from_str("no window"))?
        .document()
        .ok_or_else(|| JsValue::from_str("no document"))?;

    wire_sidebar(&document)?;
    wire_language_change()?;
    wire_new_object_dialog(&document)?;
    wire_editor_save()?;
    wire_game_buttons(&document)?;
    wire_game_api()?;
    wire_asset_map_save()?;
    wire_canvas_resize()?;
    wire_game_input()?;
    wire_visibility()?;

    // 直前に開いていたプロジェクトがあれば自動的に開き直す
    spawn_local(async {
        restore_last_project().await;
    });
    wire_dialog(&document)?;
    log(&t("app.started"));
    Ok(())
}

/// 表示言語が切り替わったとき、動的に描画した部分を作り直す
///
/// 静的なHTMLは i18n.js の applyDom が更新するため、ここではWASM側が描いた左ペインを対象にする
fn wire_language_change() -> Result<(), JsValue> {
    let on_change = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        let project = CURRENT_PROJECT.with(|c| c.borrow().clone());
        if let Some(dir) = project {
            spawn_local(async move {
                if let Err(err) = render_project_pane(&dir).await {
                    log_err(&t("msg.paneRenderFailed"), &err);
                }
            });
        }
    });
    window()
        .ok_or_else(|| JsValue::from_str("no window"))?
        .add_event_listener_with_callback(
            "arcadeer:languagechange",
            on_change.as_ref().unchecked_ref(),
        )?;
    on_change.forget();
    Ok(())
}

fn wire_sidebar(document: &Document) -> Result<(), JsValue> {
    let button = document
        .get_element_by_id("btn-new-project")
        .ok_or_else(|| JsValue::from_str("#btn-new-project not found"))?
        .dyn_into::<HtmlButtonElement>()?;

    let on_click = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        if let Err(err) = open_new_project_dialog() {
            log_err(&t("msg.dialogFailed"), &err);
        }
    });
    button.add_event_listener_with_callback("click", on_click.as_ref().unchecked_ref())?;
    on_click.forget();

    let open_button = document
        .get_element_by_id("btn-open-project")
        .ok_or_else(|| JsValue::from_str("#btn-open-project not found"))?
        .dyn_into::<HtmlButtonElement>()?;

    let on_open_click = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        spawn_open_task(false);
    });
    open_button.add_event_listener_with_callback("click", on_open_click.as_ref().unchecked_ref())?;
    on_open_click.forget();
    Ok(())
}

/// 「プロジェクトを開く」タスクを起動する共通ヘルパー
///   force_picker: true なら保存済みハンドルを使わずピッカーで選び直す
fn spawn_open_task(force_picker: bool) {
    spawn_local(async move {
        let result = if force_picker {
            open_project_via_picker().await
        } else {
            open_project_flow().await
        };
        match result {
            Ok(()) => {}
            Err(err) if is_user_cancel(&err) => {
                let msg = t("msg.permissionDeniedOpen");
                log(&msg);
                show_message(&msg, "warning", None);
            }
            Err(err) => {
                log_err(&t("msg.projectOpenFailedTitle"), &err);
                show_message(
                    &t_with("msg.projectOpenFailed", &[("detail", &format_err(&err))]),
                    "error",
                    None,
                );
            }
        }
    });
}

fn wire_dialog(document: &Document) -> Result<(), JsValue> {
    let ok = document
        .get_element_by_id("dialog-new-project-ok")
        .ok_or_else(|| JsValue::from_str("#dialog-new-project-ok not found"))?
        .dyn_into::<HtmlButtonElement>()?;
    let cancel = document
        .get_element_by_id("dialog-new-project-cancel")
        .ok_or_else(|| JsValue::from_str("#dialog-new-project-cancel not found"))?
        .dyn_into::<HtmlButtonElement>()?;

    let on_ok = Closure::<dyn FnMut(_)>::new(move |e: web_sys::Event| {
        e.prevent_default();
        let name = match read_project_name() {
            Ok(n) => n,
            Err(err) => {
                log_err(&t("msg.projectNameFailed"), &err);
                return;
            }
        };
        if name.trim().is_empty() {
            log(&t("msg.nameEmpty"));
            show_message(&t("msg.nameRequired"), "warning", None);
            return;
        }
        close_dialog();
        spawn_local(async move {
            match create_project(name.clone()).await {
                Ok(()) => {
                    // 完了ダイアログは出さず、作成したプロジェクトをそのまま開く
                    log(&t_with("msg.projectCreated", &[("name", &name)]));
                    let created = CURRENT_PROJECT.with(|c| c.borrow().clone());
                    if let Some(project) = created {
                        open_project(project, name.clone()).await;
                    }
                }
                Err(err) if is_user_cancel(&err) => {
                    let msg = t("msg.permissionDeniedCreate");
                    log(&msg);
                    show_message(&msg, "warning", None);
                }
                Err(err) => {
                    log_err(&t("msg.projectCreateFailedTitle"), &err);
                    show_message(
                        &t_with("msg.projectCreateFailed", &[("detail", &format_err(&err))]),
                        "error",
                        None,
                    );
                }
            }
        });
    });
    ok.add_event_listener_with_callback("click", on_ok.as_ref().unchecked_ref())?;
    on_ok.forget();

    let on_cancel = Closure::<dyn FnMut(_)>::new(move |e: web_sys::Event| {
        e.prevent_default();
        close_dialog();
    });
    cancel.add_event_listener_with_callback("click", on_cancel.as_ref().unchecked_ref())?;
    on_cancel.forget();

    Ok(())
}

/// fade.js のフェードヘルパーを呼び出す（未ロード時は None）
fn call_fade(name: &str, target: &JsValue) -> Option<JsValue> {
    let window = window()?;
    let func: js_sys::Function = js_sys::Reflect::get(&window, &JsValue::from_str(name))
        .ok()?
        .dyn_into()
        .ok()?;
    func.call1(&window, target).ok()
}

fn open_new_project_dialog() -> Result<(), JsValue> {
    let document = window().unwrap().document().unwrap();
    let dialog = document
        .get_element_by_id("dialog-new-project")
        .ok_or_else(|| JsValue::from_str("#dialog-new-project not found"))?
        .dyn_into::<HtmlDialogElement>()?;
    let input = document
        .get_element_by_id("input-project-name")
        .ok_or_else(|| JsValue::from_str("#input-project-name not found"))?
        .dyn_into::<HtmlInputElement>()?;
    input.set_value("");
    // 0.3秒フェードイン（fade.js 未ロード時は即時表示にフォールバック）
    if call_fade("arcadeerFadeInDialog", dialog.as_ref()).is_none() {
        dialog.show_modal()?;
    }
    let _ = input.focus();
    Ok(())
}

fn close_dialog() {
    let document = window().unwrap().document().unwrap();
    if let Some(el) = document.get_element_by_id("dialog-new-project") {
        if let Ok(dialog) = el.dyn_into::<HtmlDialogElement>() {
            // 0.3秒フェードアウト（fade.js 未ロード時は即時クローズにフォールバック）
            if call_fade("arcadeerFadeOutDialog", dialog.as_ref()).is_none() {
                dialog.close();
            }
        }
    }
}

fn read_project_name() -> Result<String, JsValue> {
    let document = window().unwrap().document().unwrap();
    let input = document
        .get_element_by_id("input-project-name")
        .ok_or_else(|| JsValue::from_str("#input-project-name not found"))?
        .dyn_into::<HtmlInputElement>()?;
    Ok(input.value())
}

/// requestPermission が "granted" 以外を返した時に使う中止用エラー
const ERR_PERMISSION_DENIED: &str = "permission-denied";
/// ディレクトリピッカー未対応時に投げるエラー（表示時に翻訳する）
const ERR_PICKER_UNAVAILABLE: &str = "msg.pickerUnavailable";

/// 選択したホームディレクトリを IndexedDB(handle-store.js) に保存する
/// 保存失敗は致命的ではないため、エラーはログのみで処理を継続する
async fn store_home_handle(handle: &FileSystemDirectoryHandle) {
    let Some(window) = window() else { return };
    let Ok(func_val) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerStoreHandle"))
    else {
        return;
    };
    let Ok(func) = func_val.dyn_into::<js_sys::Function>() else { return };
    let Ok(promise_val) = func.call2(&window, &JsValue::from_str("home"), handle.as_ref())
    else {
        return;
    };
    let Ok(promise) = promise_val.dyn_into::<js_sys::Promise>() else { return };
    if JsFuture::from(promise).await.is_err() {
        log(&t("msg.homeHandleSaveFailed"));
    }
}

/// IndexedDB からホームディレクトリを読み出し、readwrite 許可まで確認する
/// 未保存・許可拒否・読込失敗の場合は None（呼び出し側でピッカーへフォールバック）
async fn load_home_handle() -> Option<FileSystemDirectoryHandle> {
    let window = window()?;
    let func: js_sys::Function =
        js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerLoadHandle"))
            .ok()?
            .dyn_into()
            .ok()?;
    let promise: js_sys::Promise = func
        .call1(&window, &JsValue::from_str("home"))
        .ok()?
        .dyn_into()
        .ok()?;
    let value = JsFuture::from(promise).await.ok()?;
    if value.is_null() || value.is_undefined() {
        return None;
    }
    let handle: FileSystemDirectoryHandle = value.dyn_into().ok()?;
    // 権限が失効している場合はここで小さな確認バブルが表示される（拒否なら None）
    ensure_readwrite_permission(&handle).await.ok()?;
    Some(handle)
}

/// Arcadeerホームディレクトリ（GUIDプロジェクトディレクトリの親）をピッカーで選択する
/// 選択時点で読み書き許可をまとめて要求し、granted でなければ中止する
async fn pick_home_directory() -> Result<FileSystemDirectoryHandle, JsValue> {
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    let show_picker =
        js_sys::Reflect::get(&window, &JsValue::from_str("showDirectoryPicker"))?;
    if show_picker.is_undefined() {
        return Err(JsValue::from_str(
            ERR_PICKER_UNAVAILABLE,
        ));
    }
    let func: js_sys::Function = show_picker.dyn_into()?;

    // 選択時点で読み書き許可をまとめて要求する（却下されると AbortError で中止）
    let picker_options = js_sys::Object::new();
    js_sys::Reflect::set(
        &picker_options,
        &JsValue::from_str("mode"),
        &JsValue::from_str("readwrite"),
    )?;
    let picker_result = func.call1(&window, &picker_options)?;
    let promise: js_sys::Promise = picker_result.dyn_into()?;
    let handle_val = JsFuture::from(promise).await?;
    let root: FileSystemDirectoryHandle = handle_val.dyn_into()?;

    // 書き込み許可が granted であることを明示的に確認する
    ensure_readwrite_permission(&root).await?;
    Ok(root)
}

async fn create_project(name: String) -> Result<(), JsValue> {
    // ディレクトリ名にはユニークなGUIDを用いる（プロジェクト名は info.toml に保存する）
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    let project_id = window.crypto()?.random_uuid();

    let options = FileSystemGetDirectoryOptions::new();
    options.set_create(true);

    // 保存済みホームディレクトリでのサブディレクトリ作成を試み、
    // 使えない（未保存・許可拒否・ディレクトリ消失）場合はピッカーで選び直して保存する
    let mut subdir: Option<FileSystemDirectoryHandle> = None;
    if let Some(root) = load_home_handle().await {
        match JsFuture::from(root.get_directory_handle_with_options(&project_id, &options)).await
        {
            Ok(value) => subdir = Some(value.dyn_into()?),
            Err(err) => log_err(
                &t("msg.homeHandleUnusable"),
                &err,
            ),
        }
    }
    let subdir: FileSystemDirectoryHandle = match subdir {
        Some(s) => s,
        None => {
            let root = pick_home_directory().await?;
            store_home_handle(&root).await;
            JsFuture::from(root.get_directory_handle_with_options(&project_id, &options))
                .await?
                .dyn_into()?
        }
    };

    // プロジェクト情報ファイル info.toml を生成する
    let info_toml = build_info_toml(&name, &project_id, ICON_FILE_NAME);
    write_text_file(&subdir, "info.toml", &info_toml).await?;

    // デフォルトアイコン（512x512 PNG）をプロジェクトへコピーする
    copy_url_to_file(DEFAULT_ICON_URL, &subdir, ICON_FILE_NAME).await?;

    // 作業者が手で用意しなくて済むよう、標準ディレクトリを作成しておく
    for dir_name in PROJECT_DIRS {
        if ensure_subdirectory(&subdir, dir_name).await.is_none() {
            log(&t_with("msg.dirCreateFailed", &[("name", dir_name)]));
        }
    }
    let mut models_dir = None;
    for kind in RESOURCE_ORDER {
        match ensure_asset_subdir(&subdir, kind).await {
            Some(dir) => {
                if kind == ResourceKind::Model {
                    models_dir = Some(dir);
                }
            }
            None => log(&t_with("msg.dirCreateFailed", &[("name", kind.dir_name())])),
        }
    }

    // ゲームの起点となるクラスファイルを配置する（仕様書6.2.2節）
    match ensure_subdirectory(&subdir, CODE_DIR).await {
        Some(code_dir) => {
            let file_name = class_file_name(ENTRY_OBJECT_NAME);
            let content = build_class_template(ENTRY_OBJECT_NAME);
            if let Err(err) = write_text_file(&code_dir, &file_name, &content).await {
                log_err(
                    &t_with("msg.defaultAssetCopyFailed", &[("name", &file_name)]),
                    &err,
                );
            }
        }
        None => log(&t_with("msg.dirCreateFailed", &[("name", CODE_DIR)])),
    }

    // デフォルトの3Dモデル（デフォルメ猫）を assets/models/ へ配置する
    if let Some(dir) = models_dir {
        if let Err(err) = copy_url_to_file(DEFAULT_MODEL_URL, &dir, DEFAULT_MODEL_FILE).await {
            // モデルが無くてもプロジェクト自体は使えるため、処理は続行する
            log_err(
                &t_with("msg.defaultAssetCopyFailed", &[("name", DEFAULT_MODEL_FILE)]),
                &err,
            );
        }
    }

    CURRENT_PROJECT.with(|c| *c.borrow_mut() = Some(subdir));
    log(&t_with(
        "msg.dirCreated",
        &[("name", &project_id), ("icon", ICON_FILE_NAME)],
    ));
    Ok(())
}

/// info.toml の内容を組み立てる
fn build_info_toml(project_name: &str, project_id: &str, icon: &str) -> String {
    format!(
        "project_name = \"{}\"\nproject_id = \"{}\"\nicon = \"{}\"\n",
        escape_toml_basic_string(project_name),
        escape_toml_basic_string(project_id),
        escape_toml_basic_string(icon),
    )
}

/// TOML基本文字列向けに最低限のエスケープを行う
fn escape_toml_basic_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(ch),
        }
    }
    out
}

/// ディレクトリ配下にテキストファイルを作成・書き込みする
async fn write_text_file(
    dir: &FileSystemDirectoryHandle,
    file_name: &str,
    contents: &str,
) -> Result<(), JsValue> {
    let options = FileSystemGetFileOptions::new();
    options.set_create(true);
    let file_handle: FileSystemFileHandle =
        JsFuture::from(dir.get_file_handle_with_options(file_name, &options))
            .await?
            .dyn_into()?;

    let writable: FileSystemWritableFileStream =
        JsFuture::from(file_handle.create_writable()).await?.dyn_into()?;
    JsFuture::from(writable.write_with_str(contents)?).await?;
    JsFuture::from(writable.close()).await?;
    Ok(())
}

/// ディレクトリ配下のテキストファイルを読み込む（存在しない場合は Err）
async fn read_text_file(
    dir: &FileSystemDirectoryHandle,
    file_name: &str,
) -> Result<String, JsValue> {
    let file_handle: FileSystemFileHandle = JsFuture::from(dir.get_file_handle(file_name))
        .await?
        .dyn_into()?;
    let file: File = JsFuture::from(file_handle.get_file()).await?.dyn_into()?;
    let text = JsFuture::from(file.text()).await?;
    text.as_string()
        .ok_or_else(|| JsValue::from_str("failed to read text file"))
}

/// テキストファイルを、**最終更新時刻**と一緒に読む（仕様書4.11節）
///
/// 下書きとファイルのどちらが新しいかを判断するために使う。
async fn read_text_file_with_modified(
    dir: &FileSystemDirectoryHandle,
    file_name: &str,
) -> Result<(String, f64), JsValue> {
    let file_handle: FileSystemFileHandle = JsFuture::from(dir.get_file_handle(file_name))
        .await?
        .dyn_into()?;
    let file: File = JsFuture::from(file_handle.get_file()).await?.dyn_into()?;
    let modified = file.last_modified();
    let text = JsFuture::from(file.text()).await?;
    let text = text
        .as_string()
        .ok_or_else(|| JsValue::from_str("failed to read text file"))?;
    Ok((text, modified))
}

/// 配布アセット（URL）を取得し、ディレクトリ配下へバイナリのまま書き込む
async fn copy_url_to_file(
    url: &str,
    dir: &FileSystemDirectoryHandle,
    file_name: &str,
) -> Result<(), JsValue> {
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    let response: Response = JsFuture::from(window.fetch_with_str(url)).await?.dyn_into()?;
    if !response.ok() {
        return Err(JsValue::from_str(&format!(
            "failed to fetch {} (HTTP {})",
            url,
            response.status()
        )));
    }
    let buffer = JsFuture::from(response.array_buffer()?).await?;

    let options = FileSystemGetFileOptions::new();
    options.set_create(true);
    let file_handle: FileSystemFileHandle =
        JsFuture::from(dir.get_file_handle_with_options(file_name, &options))
            .await?
            .dyn_into()?;
    let writable: FileSystemWritableFileStream =
        JsFuture::from(file_handle.create_writable()).await?.dyn_into()?;
    JsFuture::from(writable.write_with_buffer_source(&buffer.dyn_into()?)?).await?;
    JsFuture::from(writable.close()).await?;
    Ok(())
}

/// info.toml の `key = "value"` 行を読み取る簡易パーサ
fn parse_info_toml(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
            map.insert(
                key.to_string(),
                unescape_toml_basic_string(&value[1..value.len() - 1]),
            );
        }
    }
    map
}

/// escape_toml_basic_string の逆変換
fn unescape_toml_basic_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// プロジェクト一覧の1件分
struct ProjectEntry {
    name: String,
    icon_url: Option<String>,
    handle: FileSystemDirectoryHandle,
}

/// 「プロジェクトを開く」の一連の流れ:
/// 保存済みホームディレクトリがあればピッカーを省略して直接スキャン、
/// 使えない場合はピッカー選択（選択結果は保存）→ スキャン → アイコン一覧ダイアログ表示
async fn open_project_flow() -> Result<(), JsValue> {
    if let Some(root) = load_home_handle().await {
        match scan_projects(&root).await {
            Ok(projects) => return present_projects(projects).await,
            // ディレクトリ消失等: ピッカーからやり直す
            Err(err) => log_err(
                &t("msg.homeHandleUnreadable"),
                &err,
            ),
        }
    }
    open_project_via_picker().await
}

/// ピッカーでホームディレクトリを選択し直して一覧表示する（選択結果は IndexedDB に保存）
async fn open_project_via_picker() -> Result<(), JsValue> {
    let root = pick_home_directory().await?;
    store_home_handle(&root).await;
    let projects = scan_projects(&root).await?;
    present_projects(projects).await
}

/// スキャン結果をメイン部のプロジェクト選択画面として表示する
async fn present_projects(projects: Vec<ProjectEntry>) -> Result<(), JsValue> {
    if projects.is_empty() {
        log(&t("msg.projectsNotFound"));
    } else {
        log(&t_with("msg.projectsFound", &[("count", &projects.len().to_string())]));
    }
    render_project_selection(projects).await
}

/// ホームディレクトリ直下を走査し、info.toml を持つサブディレクトリをプロジェクトとして集める
async fn scan_projects(
    root: &FileSystemDirectoryHandle,
) -> Result<Vec<ProjectEntry>, JsValue> {
    // 前回の一覧表示で発行した object URL を解放する
    ICON_URLS.with(|urls| {
        for url in urls.borrow_mut().drain(..) {
            Url::revoke_object_url(&url).ok();
        }
    });

    let mut projects = Vec::new();

    // FileSystemDirectoryHandle.values() の非同期イテレータを手動で回す
    let values_fn: js_sys::Function =
        js_sys::Reflect::get(root.as_ref(), &JsValue::from_str("values"))?.dyn_into()?;
    let iterator = values_fn.call0(root.as_ref())?;
    loop {
        let next_fn: js_sys::Function =
            js_sys::Reflect::get(&iterator, &JsValue::from_str("next"))?.dyn_into()?;
        let promise: js_sys::Promise = next_fn.call0(&iterator)?.dyn_into()?;
        let result = JsFuture::from(promise).await?;
        let done = js_sys::Reflect::get(&result, &JsValue::from_str("done"))?
            .as_bool()
            .unwrap_or(true);
        if done {
            break;
        }
        let value = js_sys::Reflect::get(&result, &JsValue::from_str("value"))?;
        let kind = js_sys::Reflect::get(&value, &JsValue::from_str("kind"))?
            .as_string()
            .unwrap_or_default();
        if kind != "directory" {
            continue;
        }
        let dir: FileSystemDirectoryHandle = value.dyn_into()?;

        // info.toml が読めないディレクトリはプロジェクトとみなさずスキップする
        let Ok(info_text) = read_text_file(&dir, "info.toml").await else {
            continue;
        };
        let fields = parse_info_toml(&info_text);
        let name = fields
            .get("project_name")
            .cloned()
            .unwrap_or_else(|| dir.name());
        let icon_url = match fields.get("icon") {
            Some(icon_file) => load_icon_url(&dir, icon_file).await,
            None => None,
        };
        projects.push(ProjectEntry {
            name,
            icon_url,
            handle: dir,
        });
    }

    projects.sort_by(|a, b| compare_display_names(&a.name, &b.name));
    Ok(projects)
}

/// プロジェクト内のアイコン画像を読み込み、<img> 表示用の object URL を発行する
async fn load_icon_url(dir: &FileSystemDirectoryHandle, file_name: &str) -> Option<String> {
    let file_handle: FileSystemFileHandle = JsFuture::from(dir.get_file_handle(file_name))
        .await
        .ok()?
        .dyn_into()
        .ok()?;
    let file: File = JsFuture::from(file_handle.get_file()).await.ok()?.dyn_into().ok()?;
    let url = Url::create_object_url_with_blob(&file).ok()?;
    ICON_URLS.with(|urls| urls.borrow_mut().push(url.clone()));
    Some(url)
}

/// メイン部（作業エリア）全体にプロジェクト選択画面を描画する
/// 最上段: 左端に「プロジェクト選択」見出し、その右側にワークスペース選び直しボタン
/// その下: アイコン＋プロジェクト名のカードグリッド（0件時は案内メッセージ）
/// 表示中の内容がある場合は 0.3 秒フェードアウトしてから差し替え、新内容をフェードインする
async fn render_project_selection(projects: Vec<ProjectEntry>) -> Result<(), JsValue> {
    let document = window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("no document"))?;
    let dialog: HtmlDialogElement = document
        .get_element_by_id("dialog-project-select")
        .ok_or_else(|| JsValue::from_str("#dialog-project-select not found"))?
        .dyn_into()?;
    let body = document
        .get_element_by_id("project-select-body")
        .ok_or_else(|| JsValue::from_str("#project-select-body not found"))?;
    body.set_inner_html("");

    // ヘッダー行: 見出し ／ ワークスペース選び直し ／ 閉じる
    let header = document.create_element("div")?;
    header.set_class_name("project-select-header");

    let title = document.create_element("h2")?;
    title.set_class_name("project-select-title");
    title.set_text_content(Some(&t("projectSelect.title")));
    header.append_child(&title)?;

    let repick = document.create_element("button")?;
    repick.set_attribute("type", "button")?;
    repick.set_class_name("dialog-btn");
    repick.set_text_content(Some(&t("projectSelect.repick")));
    // 保存済みハンドルを使わず、ピッカーで選び直す
    let on_repick = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        spawn_open_task(true);
    });
    repick.add_event_listener_with_callback("click", on_repick.as_ref().unchecked_ref())?;
    on_repick.forget();
    header.append_child(&repick)?;

    let spacer = document.create_element("div")?;
    spacer.set_class_name("project-select-spacer");
    header.append_child(&spacer)?;

    // 開くのをやめられるよう、明示的な閉じるボタンを置く
    let close = document.create_element("button")?;
    close.set_attribute("type", "button")?;
    close.set_class_name("dialog-btn");
    close.set_text_content(Some(&t("dialog.newProject.cancel")));
    let on_close = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        close_project_select_dialog();
    });
    close.add_event_listener_with_callback("click", on_close.as_ref().unchecked_ref())?;
    on_close.forget();
    header.append_child(&close)?;

    body.append_child(&header)?;

    if projects.is_empty() {
        let empty = document.create_element("p")?;
        empty.set_class_name("project-select-empty");
        empty.set_text_content(Some(&t("projectSelect.empty")));
        body.append_child(&empty)?;
    } else {
        let grid = document.create_element("div")?;
        grid.set_class_name("project-grid");
        for entry in projects {
            let card = document.create_element("button")?;
            card.set_attribute("type", "button")?;
            card.set_class_name("project-card");
            card.set_attribute("title", &entry.name)?;

            let icon_holder = document.create_element("div")?;
            icon_holder.set_class_name("project-card-icon");
            match &entry.icon_url {
                Some(url) => {
                    let img = document.create_element("img")?;
                    img.set_attribute("src", url)?;
                    img.set_attribute("alt", "")?;
                    icon_holder.append_child(&img)?;
                }
                // アイコンが読めない場合は絵文字プレースホルダーを表示する
                None => icon_holder.set_text_content(Some("📦")),
            }
            card.append_child(&icon_holder)?;

            let label = document.create_element("div")?;
            label.set_class_name("project-card-name");
            label.set_text_content(Some(&entry.name));
            card.append_child(&label)?;

            let name = entry.name.clone();
            let handle = entry.handle.clone();
            // 一覧は開くたびに作り直すため、forget によるリークは1カードあたり1回分に留まる
            let on_select = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
                close_project_select_dialog();
                log(&t_with("msg.projectOpened", &[("name", &name)]));
                let dir = handle.clone();
                let label = name.clone();
                spawn_local(async move {
                    open_project(dir, label).await;
                });
            });
            card.add_event_listener_with_callback("click", on_select.as_ref().unchecked_ref())?;
            on_select.forget();

            grid.append_child(&card)?;
        }
        body.append_child(&grid)?;
    }

    if call_fade("arcadeerFadeInDialog", dialog.as_ref()).is_none() {
        dialog.show_modal()?;
    }
    Ok(())
}

/// プロジェクト選択ダイアログを閉じる
fn close_project_select_dialog() {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Some(dialog) = document.get_element_by_id("dialog-project-select") else {
        return;
    };
    if call_fade("arcadeerFadeOutDialog", dialog.as_ref()).is_none() {
        if let Ok(d) = dialog.dyn_into::<HtmlDialogElement>() {
            d.close();
        }
    }
}

/// サブディレクトリのハンドルを得る。存在しない場合は作成する
///
/// 作成もできない場合（書き込み許可が無い等）は `None` を返す
async fn ensure_subdirectory(
    root: &FileSystemDirectoryHandle,
    dir_name: &str,
) -> Option<FileSystemDirectoryHandle> {
    let options = FileSystemGetDirectoryOptions::new();
    options.set_create(true);
    JsFuture::from(root.get_directory_handle_with_options(dir_name, &options))
        .await
        .ok()?
        .dyn_into()
        .ok()
}

/// `assets/<種別>/` のハンドルを得る（無ければ作成する）
async fn ensure_asset_subdir(
    project: &FileSystemDirectoryHandle,
    kind: ResourceKind,
) -> Option<FileSystemDirectoryHandle> {
    let assets = ensure_subdirectory(project, ASSETS_DIR).await?;
    ensure_subdirectory(&assets, kind.dir_name()).await
}

/// `assets/<種別>/` 直下のファイル名を集める
async fn list_asset_files(
    project: &FileSystemDirectoryHandle,
    kind: ResourceKind,
) -> Option<Vec<String>> {
    let dir = ensure_asset_subdir(project, kind).await?;
    list_files(&dir).await
}

/// サブディレクトリ直下のファイル名を集める
///
/// 対象ディレクトリが無い場合は作成する。作成もできない場合のみ `None` を返す
async fn list_file_names(
    root: &FileSystemDirectoryHandle,
    dir_name: &str,
) -> Option<Vec<String>> {
    let dir = ensure_subdirectory(root, dir_name).await?;
    list_files(&dir).await
}

/// ディレクトリハンドル直下のファイル名を集める
async fn list_files(dir: &FileSystemDirectoryHandle) -> Option<Vec<String>> {
    // FileSystemDirectoryHandle.values() の非同期イテレータを手動で回す
    let values_fn: js_sys::Function =
        js_sys::Reflect::get(dir.as_ref(), &JsValue::from_str("values"))
            .ok()?
            .dyn_into()
            .ok()?;
    let iterator = values_fn.call0(dir.as_ref()).ok()?;

    let mut names = Vec::new();
    loop {
        let next_fn: js_sys::Function =
            js_sys::Reflect::get(&iterator, &JsValue::from_str("next"))
                .ok()?
                .dyn_into()
                .ok()?;
        let promise: js_sys::Promise = next_fn.call0(&iterator).ok()?.dyn_into().ok()?;
        let result = JsFuture::from(promise).await.ok()?;
        let done = js_sys::Reflect::get(&result, &JsValue::from_str("done"))
            .ok()?
            .as_bool()
            .unwrap_or(true);
        if done {
            break;
        }
        let value = js_sys::Reflect::get(&result, &JsValue::from_str("value")).ok()?;
        let kind = js_sys::Reflect::get(&value, &JsValue::from_str("kind"))
            .ok()?
            .as_string()
            .unwrap_or_default();
        if kind != "file" {
            continue;
        }
        if let Some(name) = js_sys::Reflect::get(&value, &JsValue::from_str("name"))
            .ok()
            .and_then(|n| n.as_string())
        {
            names.push(name);
        }
    }
    Some(names)
}

/// localStorage を取得する（プライベートモード等で使えない場合は None）
fn local_storage() -> Option<web_sys::Storage> {
    window()?.local_storage().ok().flatten()
}

/// 直前に開いていたプロジェクトのディレクトリ名を保存する
fn store_last_project(dir_name: &str) {
    if let Some(storage) = local_storage() {
        let _ = storage.set_item(LAST_PROJECT_KEY, dir_name);
    }
}

/// 保存済みのプロジェクトディレクトリ名を読む
fn load_last_project() -> Option<String> {
    local_storage()?
        .get_item(LAST_PROJECT_KEY)
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
}

/// 保存済みのプロジェクト情報を消す
fn clear_last_project() {
    if let Some(storage) = local_storage() {
        let _ = storage.remove_item(LAST_PROJECT_KEY);
    }
}

/// 起動時に、直前まで開いていたプロジェクトを開き直す
///
/// 権限が既に付与されている場合のみ行う。起動直後は利用者の操作が無く
/// `requestPermission` を出せないため、確認が必要な状態なら何もしない。
async fn restore_last_project() {
    let Some(dir_name) = load_last_project() else {
        return;
    };
    // 復元する見込みが立った時点で読み込み表示を出す
    log(&t("msg.restoringProject"));
    show_loading();

    let Some(root) = load_home_handle_silent().await else {
        hide_loading().await;
        return;
    };

    // ディレクトリが消えている場合は記録を捨てて通常の起動画面にする
    let Ok(value) = JsFuture::from(root.get_directory_handle(&dir_name)).await else {
        clear_last_project();
        hide_loading().await;
        return;
    };
    let Ok(project) = value.dyn_into::<FileSystemDirectoryHandle>() else {
        clear_last_project();
        hide_loading().await;
        return;
    };
    let Ok(info_text) = read_text_file(&project, "info.toml").await else {
        clear_last_project();
        hide_loading().await;
        return;
    };

    let name = parse_info_toml(&info_text)
        .get("project_name")
        .cloned()
        .unwrap_or_else(|| project.name());
    log(&t_with("msg.projectOpened", &[("name", &name)]));
    open_project(project, name).await;
}

/// 保存済みホームディレクトリを、確認バブルを出さずに取得する
///
/// 既に readwrite が許可されている場合だけ返す（起動時の自動復帰に使う）。
async fn load_home_handle_silent() -> Option<FileSystemDirectoryHandle> {
    let window = window()?;
    let func: js_sys::Function =
        js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerLoadHandle"))
            .ok()?
            .dyn_into()
            .ok()?;
    let promise: js_sys::Promise = func
        .call1(&window, &JsValue::from_str("home"))
        .ok()?
        .dyn_into()
        .ok()?;
    let value = JsFuture::from(promise).await.ok()?;
    if value.is_null() || value.is_undefined() {
        return None;
    }
    let handle: FileSystemDirectoryHandle = value.dyn_into().ok()?;

    // queryPermission は利用者の操作を必要としない
    let query = js_sys::Reflect::get(handle.as_ref(), &JsValue::from_str("queryPermission")).ok()?;
    let query: js_sys::Function = query.dyn_into().ok()?;
    let descriptor = js_sys::Object::new();
    js_sys::Reflect::set(
        &descriptor,
        &JsValue::from_str("mode"),
        &JsValue::from_str("readwrite"),
    )
    .ok()?;
    let promise: js_sys::Promise = query
        .call1(handle.as_ref(), &descriptor)
        .ok()?
        .dyn_into()
        .ok()?;
    let state = JsFuture::from(promise).await.ok()?;
    if state.as_string().as_deref() == Some("granted") {
        Some(handle)
    } else {
        None
    }
}

/// 実行トグルボタンを組み立てる
///
/// ゲーム表示エリアの最上部（横長時）と左ペインのプロジェクト名の右端（狭い時）に
/// 同じ働きのボタンを置き、表示の切り替えはCSSに任せる。
fn build_game_toggle(document: &Document, extra_class: &str) -> Result<Element, JsValue> {
    let button = document.create_element("button")?;
    button.set_attribute("type", "button")?;
    button.set_class_name(&format!("header-icon-btn game-toggle-btn {extra_class}"));
    wire_game_toggle(&button)?;
    Ok(button)
}

/// トグルボタンにクリック処理を割り当てる（実行と停止を兼ねる）
fn wire_game_toggle(button: &Element) -> Result<(), JsValue> {
    let on_click = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        if RUN_STATE.with(|s| s.borrow().is_running()) {
            stop_game();
        } else {
            start_game();
        }
    });
    button.add_event_listener_with_callback("click", on_click.as_ref().unchecked_ref())?;
    on_click.forget();
    Ok(())
}

/// ゲームの実行・停止ボタンを配線する
fn wire_game_buttons(document: &Document) -> Result<(), JsValue> {
    let toggle: HtmlButtonElement = document
        .get_element_by_id("btn-toggle-game")
        .ok_or_else(|| JsValue::from_str("#btn-toggle-game not found"))?
        .dyn_into()?;
    wire_game_toggle(toggle.as_ref())?;

    // 表示言語が変わったらツールチップを付け直す
    let on_language = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        update_game_buttons();
    });
    window()
        .ok_or_else(|| JsValue::from_str("no window"))?
        .add_event_listener_with_callback(
            "arcadeer:languagechange",
            on_language.as_ref().unchecked_ref(),
        )?;
    on_language.forget();

    update_game_buttons();
    Ok(())
}

/// `info.toml` から保存済みの並び順を読む
async fn load_order(project: &FileSystemDirectoryHandle) -> HashMap<String, Vec<String>> {
    match read_text_file(project, "info.toml").await {
        Ok(text) => parse_order(&text),
        Err(_) => HashMap::new(),
    }
}

/// 並び順を `info.toml` へ保存する
///
/// 既存のプロジェクト情報を読み直したうえで、`[order]` セクションを差し替える。
async fn save_order(
    project: &FileSystemDirectoryHandle,
    order: &HashMap<String, Vec<String>>,
) -> Result<(), JsValue> {
    let text = read_text_file(project, "info.toml").await?;
    let fields = parse_info_toml(&text);
    let project_name = fields.get("project_name").cloned().unwrap_or_default();
    let project_id = fields
        .get("project_id")
        .cloned()
        .unwrap_or_else(|| project.name());
    let icon = fields
        .get("icon")
        .cloned()
        .unwrap_or_else(|| ICON_FILE_NAME.to_string());

    let mut updated = build_info_toml(&project_name, &project_id, &icon);
    let section = format_order(order);
    if !section.is_empty() {
        updated.push('\n');
        updated.push_str(&section);
    }
    write_text_file(project, "info.toml", &updated).await
}

/// 並べ替えの結果（表示順そのもの）を保存する
///
/// 画面側は既に並べ替え済みのため、**一覧の作り直しは行わない**
/// （作り直すとフェードやサムネイルの再読み込みが起きるため）。
async fn set_order(names: Vec<String>) -> Result<(), JsValue> {
    let project = CURRENT_PROJECT
        .with(|c| c.borrow().clone())
        .ok_or_else(|| JsValue::from_str("no project is open"))?;
    let tab_key = SELECTED_TAB.with(|k| k.borrow().clone());
    let Some(order_key) = order_key_for_tab(&tab_key) else {
        return Ok(());
    };

    let mut order = load_order(&project).await;
    order.insert(order_key.to_string(), names.clone());
    save_order(&project, &order).await?;

    // タブを切り替えて戻っても並びが保たれるよう、保持しているタブ内容も更新する
    PANE_TABS.with(|tabs| {
        if let Some(tab) = tabs
            .borrow_mut()
            .iter_mut()
            .find(|t| t.label_key == tab_key)
        {
            tab.items = names.clone();
        }
    });
    if tab_key == OBJECT_TAB_KEY {
        CURRENT_OBJECTS.with(|o| *o.borrow_mut() = names);
    }
    Ok(())
}

/// ゲームから呼べるオブジェクト操作APIを公開する（仕様書6.2節）
///
/// CoffeeScript 側から `addObject()` / `removeObject()` として利用する。
fn wire_game_api() -> Result<(), JsValue> {
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;

    // オブジェクトを一次元配列の末尾へ追加し、識別子を返す
    let add = Closure::<dyn FnMut(JsValue) -> f64>::new(move |object: JsValue| {
        f64::from(register_object(object).0)
    });
    js_sys::Reflect::set(
        &window,
        &JsValue::from_str("arcadeerAddObject"),
        add.as_ref(),
    )?;
    add.forget();

    // 削除は予約のみ。実際の除去はフレーム末にまとめて行う
    let remove = Closure::<dyn FnMut(f64)>::new(move |id: f64| {
        if id >= 0.0 {
            GAME_OBJECTS.with(|o| o.borrow_mut().remove(objects::ObjectId(id as u32)));
        }
    });
    js_sys::Reflect::set(
        &window,
        &JsValue::from_str("arcadeerRemoveObject"),
        remove.as_ref(),
    )?;
    remove.forget();

    // 並べ替え（ドラッグ＆ドロップ）の結果を、表示順そのままで受け取る
    let set_order_fn = Closure::<dyn FnMut(js_sys::Array)>::new(move |names: js_sys::Array| {
        let names: Vec<String> = names.iter().filter_map(|v| v.as_string()).collect();
        spawn_local(async move {
            if let Err(err) = set_order(names).await {
                log_err(&t("msg.reorderFailed"), &err);
            }
        });
    });
    js_sys::Reflect::set(
        &window,
        &JsValue::from_str("arcadeerSetOrder"),
        set_order_fn.as_ref(),
    )?;
    set_order_fn.forget();

    // 現在のオブジェクト数（削除予約は反映前）
    let count = Closure::<dyn FnMut() -> f64>::new(move || {
        GAME_OBJECTS.with(|o| o.borrow().len() as f64)
    });
    js_sys::Reflect::set(
        &window,
        &JsValue::from_str("arcadeerObjectCount"),
        count.as_ref(),
    )?;
    count.forget();

    Ok(())
}

/// プロジェクトを開いているかどうかを、メイン部のクラスへ反映する
///
/// 横長のウィンドウでゲーム実行画面を出すかどうかの判定に使う（4.4節）。
fn update_main_layout() {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Some(main) = document.get_element_by_id("ide-main") else {
        return;
    };
    let has_project = CURRENT_PROJECT.with(|c| c.borrow().is_some());
    let _ = main.class_list().toggle_with_force("has-project", has_project);
    // 16:9より狭い場合は、実行中だけ中央にゲーム画面を出す
    let running = RUN_STATE.with(|s| s.borrow().is_running());
    let _ = main.class_list().toggle_with_force("game-active", running);
    // 表示領域の大きさが変わるため、canvas を合わせ直す
    fit_game_canvas();
    if !running {
        release_game_input();
    }
}

/// 実行状態に応じて、トグルボタンの見た目と有効／無効を切り替える
fn update_game_buttons() {
    /// 再生アイコン（停止中に表示）
    const PLAY_ICON: &str = r#"<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" /></svg>"#;
    /// 停止アイコン（実行中に表示）
    const STOP_ICON: &str = r#"<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></svg>"#;

    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(buttons) = document.query_selector_all(".game-toggle-btn") else {
        return;
    };

    let running = RUN_STATE.with(|s| s.borrow().is_running());
    let label = t(if running {
        "header.stopGame"
    } else {
        "header.runGame"
    });
    let has_project = CURRENT_PROJECT.with(|c| c.borrow().is_some());

    // 置き場所が複数あるため、すべてのトグルを同じ状態にそろえる
    for i in 0..buttons.length() {
        let Some(node) = buttons.item(i) else { continue };
        let Ok(button) = node.dyn_into::<Element>() else {
            continue;
        };
        button.set_inner_html(if running { STOP_ICON } else { PLAY_ICON });
        let _ = button.set_attribute("data-tooltip", &label);
        let _ = button.set_attribute("aria-label", &label);
        let _ = button.class_list().toggle_with_force("game-running", running);

        // プロジェクトを開いていなければ押せない
        if has_project {
            let _ = button.remove_attribute("disabled");
        } else {
            let _ = button.set_attribute("disabled", "");
        }
    }
}

/// ゲームを実行する
fn start_game() {
    if RUN_STATE.with(|s| s.borrow().is_running()) {
        return;
    }
    // 目標FPSは今後 config.toml から読む（仕様書6.1節）。現時点は既定値。
    let fps = PACER.with(|p| {
        let mut pacer = p.borrow_mut();
        match pacer.as_mut() {
            Some(existing) => {
                existing.set_target_fps(DEFAULT_FPS);
                existing.reset();
            }
            None => *pacer = Some(FramePacer::new(DEFAULT_FPS)),
        }
        pacer.as_ref().map_or(DEFAULT_FPS, |x| x.target_fps())
    });
    RUN_STATE.with(|s| {
        let next = s.borrow().start();
        *s.borrow_mut() = next;
    });
    FPS_SHOWN_AT.with(|t| *t.borrow_mut() = 0.0);

    log(&t_with("msg.gameStarted", &[("fps", &fps.to_string())]));
    update_game_buttons();
    update_main_layout();

    // クラスのコンパイルはファイル読み込みを伴うため非同期に行い、
    // 完了してから起点オブジェクトを生成してループを回し始める
    spawn_local(async move {
        // 保存し忘れたまま実行しても、見ているコードがそのまま動くようにする（4.11節）
        flush_drafts().await;
        if !build_game_classes().await {
            stop_game();
            return;
        }
        spawn_entry_object();
        // gameMain の setScreenSize() を反映してから描画を始める
        apply_screen_size();
        if let Err(err) = init_renderer() {
            log_err(&t("msg.renderInitFailed"), &err);
            show_message(
                &t_with("msg.renderInitFailed", &[("detail", &format_err(&err))]),
                "error",
                None,
            );
            stop_game();
            return;
        }
        preload_models().await;
        // 隠れたまま実行を始めた場合は visibilitychange が起きないため、ここでも見る
        match on_visibility_change(
            is_window_hidden(),
            RUN_STATE.with(|s| *s.borrow()),
            PAUSED_BY_HIDE.with(|f| *f.borrow()),
        ) {
            VisibilityAction::Pause => pause_for_hide(),
            _ => schedule_frame(),
        }
    });
}

/// ゲームを停止する
fn stop_game() {
    // 一時停止中（ウィンドウが隠れている間）でも止められるようにする
    if RUN_STATE.with(|s| *s.borrow()) == RunState::Stopped {
        return;
    }
    RUN_STATE.with(|s| {
        let next = s.borrow().stop();
        *s.borrow_mut() = next;
    });
    PAUSED_BY_HIDE.with(|f| *f.borrow_mut() = false);
    GAME_OBJECTS.with(|o| o.borrow_mut().clear());
    call_global("arcadeerClearObjectRegistrar");
    call_global("arcadeerClearModels");
    call_global("arcadeerClearScreen");
    // 次回の実行に備えて、計測とフレーム状態だけ戻す
    PACER.with(|p| {
        if let Some(pacer) = p.borrow_mut().as_mut() {
            pacer.reset();
        }
    });
    set_fps_display(None);

    log(&t("msg.gameStopped"));
    update_game_buttons();
    update_main_layout();
}

/// `code/*.coffee` をコンパイルしてクラスを登録する
///
/// コンパイルエラーはコンソールとメッセージダイアログで通知する（仕様書5.8節）。
/// 成功したら `true` を返す。
async fn build_game_classes() -> bool {
    let Some(project) = CURRENT_PROJECT.with(|c| c.borrow().clone()) else {
        return false;
    };
    let Some(code_dir) = ensure_subdirectory(&project, CODE_DIR).await else {
        return false;
    };
    let Some(files) = list_files(&code_dir).await else {
        return false;
    };

    // クラス名とソースの組をJSへ渡す
    let sources = js_sys::Array::new();
    for file_name in files {
        let Some(name) = listing::object_name(&file_name) else {
            continue;
        };
        let Ok(source) = read_text_file(&code_dir, &file_name).await else {
            continue;
        };
        let entry = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&entry, &JsValue::from_str("name"), &JsValue::from_str(&name));
        let _ = js_sys::Reflect::set(
            &entry,
            &JsValue::from_str("source"),
            &JsValue::from_str(&source),
        );
        sources.push(&entry);
    }

    let errors = call_build_classes(sources).await;
    if errors.is_empty() {
        return true;
    }

    let detail = errors.join("\n");
    log(&detail);
    show_message(
        &t_with("msg.compileFailed", &[("detail", &detail)]),
        "error",
        None,
    );
    false
}

/// coffee.js の buildClasses を呼び、エラーメッセージの一覧を受け取る
async fn call_build_classes(sources: js_sys::Array) -> Vec<String> {
    let Some(window) = window() else {
        return vec!["no window".to_string()];
    };
    let Ok(func) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerBuildClasses")) else {
        return vec!["arcadeerBuildClasses not found".to_string()];
    };
    let Ok(func) = func.dyn_into::<js_sys::Function>() else {
        return vec!["arcadeerBuildClasses not found".to_string()];
    };
    let Ok(promise) = func.call1(&JsValue::NULL, sources.as_ref()) else {
        return vec!["failed to call arcadeerBuildClasses".to_string()];
    };
    let Ok(promise) = promise.dyn_into::<js_sys::Promise>() else {
        return vec!["arcadeerBuildClasses did not return a promise".to_string()];
    };
    match JsFuture::from(promise).await {
        Ok(value) => js_sys::Array::from(&value)
            .iter()
            .filter_map(|v| v.as_string())
            .collect(),
        Err(err) => vec![format_err(&err)],
    }
}

/// ゲームの起点オブジェクト（`gameMain`）を生成し、オブジェクトリストへ追加する
///
/// 仕様書6.2.2節。実行開始時に**最初に**追加するため、`behavior()` は毎フレーム先頭で呼ばれる。
/// クラスの生成は CoffeeScript のトランスパイル（5.1節）に依存するため、
/// トランスパイル層が用意されるまでは何もしない。
fn spawn_entry_object() {
    // コンストラクタの中で addObject を呼ぶ書き方に対応するため、
    // **生成する前に**登録先を差し込んでおく
    install_object_registrar();

    let Some(window) = window() else { return };
    // トランスパイル層が公開する生成関数。未実装のうちは存在しない
    let Ok(factory) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerCreateObject"))
    else {
        return;
    };
    let Ok(factory) = factory.dyn_into::<js_sys::Function>() else {
        log(&t_with("msg.entryObjectPending", &[("name", ENTRY_OBJECT_NAME)]));
        return;
    };

    match factory.call1(&JsValue::NULL, &JsValue::from_str(ENTRY_OBJECT_NAME)) {
        Ok(instance) if !instance.is_null() && !instance.is_undefined() => {
            // 起点オブジェクトは、コンストラクタで作られたものより後ろに置く。
            // 走査順は追加順のため、先に作られた子が先に動く。
            register_object(instance);
        }
        // 生成できなかった理由を添える。
        // 理由が分からないと、書き間違いなのかコンストラクタの不具合なのか切り分けられない
        Ok(_) => log(&t_with(
            "msg.entryObjectFailed",
            &[("name", ENTRY_OBJECT_NAME), ("detail", &last_instantiate_error())],
        )),
        Err(err) => log_err(
            &t_with("msg.entryObjectMissing", &[("name", ENTRY_OBJECT_NAME)]),
            &err,
        ),
    }
}

/// ゲームが指定した解像度を、canvas の内部解像度（描画バッファ）へ反映する
///
/// 画面上の表示サイズはCSSが決めるため、ここでは `width` / `height` 属性だけを設定する。
fn apply_screen_size() {
    let Some(window) = window() else { return };
    let Some(document) = window.document() else {
        return;
    };
    let Some(canvas) = document.get_element_by_id("game-canvas") else {
        return;
    };

    // runtime.js が保持している解像度を読む
    let size = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerScreenSize"))
        .ok()
        .and_then(|f| f.dyn_into::<js_sys::Function>().ok())
        .and_then(|f| f.call0(&JsValue::NULL).ok());
    let Some(size) = size else { return };

    let read = |key: &str| {
        js_sys::Reflect::get(&size, &JsValue::from_str(key))
            .ok()
            .and_then(|v| v.as_f64())
    };
    let (Some(width), Some(height)) = (read("width"), read("height")) else {
        return;
    };

    let _ = canvas.set_attribute("width", &format!("{}", width as u32));
    let _ = canvas.set_attribute("height", &format!("{}", height as u32));
    fit_game_canvas();
    log(&t_with(
        "msg.screenSize",
        &[
            ("width", &format!("{}", width as u32)),
            ("height", &format!("{}", height as u32)),
        ],
    ));
}

/// canvas を表示領域へ収める
///
/// 長い方を表示領域に合わせ、短い方は余白ができる（CSSで中央に置く）。
/// 内部解像度（`width` / `height` 属性）は変えず、**表示サイズだけ**を指定する。
fn fit_game_canvas() {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    // canvas を実際に置いている領域を基準にする。
    // 外側（ide-game）はボタン欄を含むため、その高さで計算するとはみ出す。
    let Some(area) = document
        .get_element_by_id("ide-game-body")
        .or_else(|| document.get_element_by_id("ide-game"))
    else {
        return;
    };
    let Some(canvas) = document.get_element_by_id("game-canvas") else {
        return;
    };

    let read_attr = |name: &str| {
        canvas
            .get_attribute(name)
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0)
    };
    let (width, height) = fit_size(
        f64::from(area.client_width()),
        f64::from(area.client_height()),
        read_attr("width"),
        read_attr("height"),
    );
    if width <= 0.0 || height <= 0.0 {
        return;
    }

    if let Ok(element) = canvas.dyn_into::<web_sys::HtmlElement>() {
        let style = element.style();
        let _ = style.set_property("width", &format!("{width:.2}px"));
        let _ = style.set_property("height", &format!("{height:.2}px"));
    }
}

/// ゲーム実行中のキー入力を受け取る
///
/// canvas にフォーカスがある状態で押されたキーを記録し、ゲームコードから
/// `isKeyDown(コード)` で参照できるようにする。
fn wire_game_input() -> Result<(), JsValue> {
    let document = window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("no document"))?;
    let canvas = document
        .get_element_by_id("game-canvas")
        .ok_or_else(|| JsValue::from_str("#game-canvas not found"))?;

    let on_down = Closure::<dyn FnMut(_)>::new(move |e: web_sys::KeyboardEvent| {
        // ブラウザ既定の動作（スクロールなど）を止めてゲームへ渡す
        e.prevent_default();
        call_global_with_str("arcadeerKeyDown", &e.code());
    });
    canvas.add_event_listener_with_callback("keydown", on_down.as_ref().unchecked_ref())?;
    on_down.forget();

    let on_up = Closure::<dyn FnMut(_)>::new(move |e: web_sys::KeyboardEvent| {
        e.prevent_default();
        call_global_with_str("arcadeerKeyUp", &e.code());
    });
    canvas.add_event_listener_with_callback("keyup", on_up.as_ref().unchecked_ref())?;
    on_up.forget();

    // ESCは必ず「停止」、⌘/Ctrl+Enter は必ず「実行」にする（どちらもトグルではない）
    let on_escape = Closure::<dyn FnMut(_)>::new(move |e: web_sys::KeyboardEvent| {
        let key = e.key();
        let code = e.code();
        let action = resolve_shortcut(
            &KeyPress {
                key: &key,
                code: &code,
                command: e.meta_key() || e.ctrl_key(),
                alt: e.alt_key(),
                shift: e.shift_key(),
            },
            &KeyContext {
                running: RUN_STATE.with(|s| s.borrow().is_running()),
                editor_focused: is_editor_focused(),
                project_open: CURRENT_PROJECT.with(|c| c.borrow().is_some()),
                reference_open: is_reference_open(),
                dialog_open: is_dialog_open(),
            },
        );
        match action {
            Shortcut::Stop => {
                e.prevent_default();
                stop_game();
            }
            Shortcut::Start => {
                e.prevent_default();
                start_game();
            }
            Shortcut::CloseReference => {
                e.prevent_default();
                call_global("arcadeerToggleReference");
            }
            Shortcut::ToggleLog => {
                e.prevent_default();
                call_global("arcadeerToggleFooterLog");
            }
            Shortcut::None => {}
        }
        move_focus(focus_after(action));
    });
    window()
        .ok_or_else(|| JsValue::from_str("no window"))?
        .add_event_listener_with_callback("keydown", on_escape.as_ref().unchecked_ref())?;
    on_escape.forget();

    // 画面外へフォーカスが移ったら押しっぱなし扱いを解除する
    let on_blur = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        call_global("arcadeerClearKeys");
    });
    canvas.add_event_listener_with_callback("blur", on_blur.as_ref().unchecked_ref())?;
    on_blur.forget();

    Ok(())
}

/// 操作のあとにフォーカスを移す
///
/// キーボードだけで「直す → 動かす → 止める → 直す」と往復できるようにする。
fn move_focus(target: FocusTarget) {
    match target {
        FocusTarget::Editor => {
            // ファイルを開いていない場合、エディタ側で何もせずに済ませる
            call_global("arcadeerFocusEditor");
        }
        FocusTarget::Game => focus_game_canvas(),
        FocusTarget::None => {}
    }
}

/// ゲーム表示エリアへフォーカスを移す
///
/// 以降のキー操作がゲームへ送られるようにする（6.2.1節）。
fn focus_game_canvas() {
    let Some(canvas) = window()
        .and_then(|w| w.document())
        .and_then(|d| d.get_element_by_id("game-canvas"))
    else {
        return;
    };
    // 画面を動かさずにフォーカスだけ移す。
    // 既定の focus() は要素が見える位置まで親をスクロールさせるため、
    // ボタン欄が上へ隠れてしまう。
    let Ok(func) = js_sys::Reflect::get(canvas.as_ref(), &JsValue::from_str("focus")) else {
        return;
    };
    let Ok(func) = func.dyn_into::<js_sys::Function>() else {
        return;
    };
    let options = js_sys::Object::new();
    let _ = js_sys::Reflect::set(
        &options,
        &JsValue::from_str("preventScroll"),
        &JsValue::TRUE,
    );
    let _ = func.call1(canvas.as_ref(), &options);
}

/// ダイアログを開いているか
///
/// キーコンフィグなどの `<dialog>` が開いている間は、ESCで閉じるのが
/// ダイアログの役目なので、こちらは何もしない。
fn is_dialog_open() -> bool {
    window()
        .and_then(|w| w.document())
        .and_then(|d| d.query_selector("dialog[open]").ok().flatten())
        .is_some()
}

/// リファレンスを開いているか
fn is_reference_open() -> bool {
    window()
        .and_then(|w| w.document())
        .and_then(|d| d.body())
        .is_some_and(|b| b.class_list().contains("reference-open"))
}

/// エディタにフォーカスがあるか
///
/// Ace は本体の中に入力用の要素を持つため、フォーカスされている要素が
/// エディタの内側にあるかどうかで判定する。
fn is_editor_focused() -> bool {
    let Some(active) = window()
        .and_then(|w| w.document())
        .and_then(|d| d.active_element())
    else {
        return false;
    };
    matches!(active.closest("#editor-body"), Ok(Some(_)))
}

/// ウィンドウの表示状態を見張る（仕様書6.1節）
///
/// 隠れているタブでは `setTimeout` が1秒間隔まで制限され、1fps まで落ちてしまう。
/// 中途半端な速度で回し続けず、**隠れたら止めて、戻ったら再開する**。
fn wire_visibility() -> Result<(), JsValue> {
    let document = window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("no document"))?;

    let on_change = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        let hidden = is_window_hidden();
        let state = RUN_STATE.with(|s| *s.borrow());
        let by_hide = PAUSED_BY_HIDE.with(|f| *f.borrow());

        match on_visibility_change(hidden, state, by_hide) {
            VisibilityAction::Pause => pause_for_hide(),
            VisibilityAction::Resume => resume_from_hide(),
            VisibilityAction::None => {}
        }
    });
    document
        .add_event_listener_with_callback("visibilitychange", on_change.as_ref().unchecked_ref())?;
    on_change.forget();
    Ok(())
}

/// 直近の生成に失敗した理由（トランスパイル層が覚えている）
///
/// 分からない場合は空文字を返す。
fn last_instantiate_error() -> String {
    let Some(window) = window() else {
        return String::new();
    };
    let Ok(func) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerLastInstantiateError"))
    else {
        return String::new();
    };
    let Ok(func) = func.dyn_into::<js_sys::Function>() else {
        return String::new();
    };
    func.call0(&JsValue::NULL)
        .ok()
        .and_then(|v| v.as_string())
        .unwrap_or_default()
}

/// ウィンドウが隠れているか/// ウィンドウが隠れているか
fn is_window_hidden() -> bool {
    window()
        .and_then(|w| w.document())
        .is_some_and(|d| d.hidden())
}

/// ウィンドウが隠れたので一時停止する
fn pause_for_hide() {
    RUN_STATE.with(|s| {
        let next = s.borrow().pause();
        *s.borrow_mut() = next;
    });
    PAUSED_BY_HIDE.with(|f| *f.borrow_mut() = true);
    // 押しっぱなし扱いが残らないようにする
    call_global("arcadeerClearKeys");
    set_fps_display(None);
    log(&t("msg.gamePaused"));
}

/// ウィンドウが表示へ戻ったので再開する
fn resume_from_hide() {
    RUN_STATE.with(|s| {
        let next = s.borrow().resume();
        *s.borrow_mut() = next;
    });
    PAUSED_BY_HIDE.with(|f| *f.borrow_mut() = false);
    // 止まっていた間の空白を1フレームとして数えない
    PACER.with(|p| {
        if let Some(pacer) = p.borrow_mut().as_mut() {
            pacer.resync();
        }
    });
    FPS_SHOWN_AT.with(|t| *t.borrow_mut() = 0.0);
    log(&t("msg.gameResumed"));
    schedule_frame();
}

/// 文字列を1つ渡してグローバル関数を呼ぶ/// 文字列を1つ渡してグローバル関数を呼ぶ
fn call_global_with_str(name: &str, value: &str) {
    let Some(window) = window() else { return };
    let Ok(func) = js_sys::Reflect::get(window.as_ref(), &JsValue::from_str(name)) else {
        return;
    };
    if let Ok(func) = func.dyn_into::<js_sys::Function>() {
        let _ = func.call1(&JsValue::NULL, &JsValue::from_str(value));
    }
}

/// ゲームを止めたときに、入力の受け取りを終える
///
/// 実行中は編集を妨げない。キー操作の宛先は
/// **どこをクリックしたか（フォーカス）** で決まる。
fn release_game_input() {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    if let Some(canvas) = document.get_element_by_id("game-canvas") {
        if let Ok(canvas) = canvas.dyn_into::<web_sys::HtmlElement>() {
            let _ = canvas.blur();
        }
    }
    call_global("arcadeerClearKeys");
}

/// ウィンドウの大きさが変わったら、canvas の表示サイズを合わせ直す
fn wire_canvas_resize() -> Result<(), JsValue> {
    let on_resize = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        fit_game_canvas();
    });
    window()
        .ok_or_else(|| JsValue::from_str("no window"))?
        .add_event_listener_with_callback("resize", on_resize.as_ref().unchecked_ref())?;
    on_resize.forget();
    Ok(())
}

/// `addObject` で作られたオブジェクトをオブジェクトリストへ入れる関数を登録する
///
/// 登録先はエンジン全体で1つ。オブジェクトごとに後から差し込む形にすると、
/// **コンストラクタの中で `addObject` を呼んだ場合に間に合わない**。
fn install_object_registrar() {
    let Some(window) = window() else { return };
    let Ok(setter) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerSetObjectRegistrar"))
    else {
        return;
    };
    let Ok(setter) = setter.dyn_into::<js_sys::Function>() else {
        return;
    };
    let registrar = Closure::<dyn FnMut(JsValue) -> f64>::new(move |created: JsValue| {
        // 消す時に使えるよう、識別子を返す
        f64::from(register_object(created).0)
    });
    let _ = setter.call1(&JsValue::NULL, registrar.as_ref());
    // ゲーム実行中は生き続ける必要があるため、寿命をJS側へ委ねる
    registrar.forget();

    // 削除の予約先も差し込む
    let Ok(setter) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerSetObjectRemover"))
    else {
        return;
    };
    let Ok(setter) = setter.dyn_into::<js_sys::Function>() else {
        return;
    };
    let remover = Closure::<dyn FnMut(f64)>::new(move |id: f64| {
        if id >= 0.0 {
            GAME_OBJECTS.with(|o| o.borrow_mut().remove(objects::ObjectId(id as u32)));
        }
    });
    let _ = setter.call1(&JsValue::NULL, remover.as_ref());
    remover.forget();
}

/// オブジェクトを一覧へ加え、**識別子を実体へ書き込む**
///
/// `removeObject()` は、この識別子を頼りに削除を予約する（6.2節）。
fn register_object(object: JsValue) -> objects::ObjectId {
    let id = GAME_OBJECTS.with(|o| o.borrow_mut().add(object.clone()));
    let _ = js_sys::Reflect::set(
        &object,
        &JsValue::from_str("_objectId"),
        &JsValue::from_f64(f64::from(id.0)),
    );
    id
}

/// 次のフレームを予約する
///
/// `setTimeout` を再帰的に呼ぶため、クロージャを Rc で持ち回す。
///
/// `requestAnimationFrame` を使わないのは、**表示のリフレッシュ間隔の整数倍でしか
/// 入れ替えられない**ため。60や30のように割り切れる値でないと 16.7ms と 33.3ms が
/// 交互に来てしまい、「FPSはゲーム作成者が自由に指定する（丸めない）」という
/// 方針（6.1節）を満たせない。
fn schedule_frame() {
    /// 再帰予約のために持ち回すコールバック
    type FrameCallback = Rc<RefCell<Option<Closure<dyn FnMut()>>>>;

    let callback: FrameCallback = Rc::new(RefCell::new(None));
    let keeper = callback.clone();

    *keeper.borrow_mut() = Some(Closure::wrap(Box::new(move || {
        let delay = run_frame();
        // 停止されたらここで予約を止め、クロージャも解放される
        if RUN_STATE.with(|s| s.borrow().is_running()) {
            if let Some(next) = callback.borrow().as_ref() {
                set_timeout(next, delay);
            }
        }
    }) as Box<dyn FnMut()>));

    let borrowed = keeper.borrow();
    if let Some(first) = borrowed.as_ref() {
        set_timeout(first, 0.0);
    }
}

/// setTimeout を呼ぶ
///
/// 待ち時間はミリ秒。小数は扱えないため切り上げて、締切より手前で起きないようにする。
fn set_timeout(callback: &Closure<dyn FnMut()>, delay_ms: f64) {
    let Some(window) = window() else { return };
    let delay = delay_ms.max(0.0).ceil() as i32;
    let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(
        callback.as_ref().unchecked_ref(),
        delay,
    );
}

/// 現在時刻（ミリ秒。performance.now 相当）
fn now_ms() -> f64 {
    window()
        .and_then(|w| w.performance())
        .map(|p| p.now())
        .unwrap_or(0.0)
}

/// 1フレーム分の処理（仕様書6.1節）
///
/// 表示時間が来ていればまず**バッファを入れ替え**、続けて次に表示するフレームの
/// 更新（全 `behavior()` ＋ 裏バッファ描画）を行う。
/// この順にすることで、1フレームにつき `setTimeout` は1回で済む。
///
/// 更新が表示時間を超えた場合は、待ち時間が `0` になって次の呼び出しですぐ
/// 入れ替わる。**取り戻すために更新を多重に回すことはしない。**
///
/// @returns 次の呼び出しまで待つ時間（ミリ秒）
fn run_frame() -> f64 {
    let mut pacer = match PACER.with(|p| p.borrow_mut().take()) {
        Some(pacer) => pacer,
        None => return 0.0,
    };

    let now = now_ms();
    if pacer.should_present(now) {
        present_back_buffer();
        pacer.present(now);
        show_fps(pacer.measured_fps(), now);
    }

    if pacer.should_update(now) {
        // Gamepad API は呼んだ時点の写しを返すため、毎フレーム読み直す（6.2.9節）
        call_global("arcadeerUpdateGamepads");
        // そのフレームの情報は1つ作り、全オブジェクトへ同じものを渡す。
        // ここで作るのは、PACER をこの関数へ取り出している間だからで、
        // 走査の中からは参照できないため。
        let event = build_frame_event(pacer.frame_index(), pacer.elapsed_sec());
        run_behaviors(&event);
        // 表示するフレームの姿勢を決めてから描く
        advance_animations(pacer.frame_interval_ms() / 1000.0);
        draw_back_buffer();
        pacer.mark_drawn();
    }

    // 更新にかかった時間を反映するため、時刻を取り直してから求める
    let delay = pacer.delay_until_present_ms(now_ms());
    PACER.with(|p| *p.borrow_mut() = Some(pacer));
    delay
}

/// オブジェクトリストを順に走査し、全オブジェクトの `behavior()` を呼ぶ（仕様書6.2節）
///
/// 走査対象は先に固定するため、`behavior()` 内で追加されたオブジェクトは次フレームから対象になる。
/// 削除はフレーム末にまとめて反映する。
fn run_behaviors(event: &JsValue) {
    if GAME_OBJECTS.with(|o| o.borrow().is_empty()) {
        return;
    }
    let ids = GAME_OBJECTS.with(|o| o.borrow().ids());
    for id in ids {
        let object = GAME_OBJECTS.with(|o| o.borrow().get(id).cloned());
        let Some(object) = object else { continue };
        call_behavior(&object, event);
    }
    // 消すものは、走査が終わってからまとめて片付ける。
    // **取り除く前に `destructor(e)` を呼ぶ**（6.2節）
    let removed = GAME_OBJECTS.with(|o| o.borrow_mut().apply_removals());
    for object in removed {
        call_destructor(&object, event);
    }
}

/// オブジェクトの `destructor()` を呼ぶ
///
/// 持っていないオブジェクトも多いため、無ければ何もしない。
fn call_destructor(object: &JsValue, event: &JsValue) {
    let Ok(method) = js_sys::Reflect::get(object, &JsValue::from_str("destructor")) else {
        return;
    };
    if let Ok(func) = method.dyn_into::<js_sys::Function>() {
        let _ = func.call1(object, event);
    }
}

/// オブジェクトの `behavior()` を呼ぶ
///
/// 呼び分けは実行基盤（`runtime.js`）の `arcadeerRunBehavior` が受け持つ。
/// `waitjob` で待機している間は、そのオブジェクト自身の `behavior()` は呼ばれず、
/// 共通処理だけが進む（仕様書6.2.1節）。
fn call_behavior(object: &JsValue, event: &JsValue) {
    if let Some(window) = window() {
        if let Ok(runner) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerRunBehavior"))
        {
            if let Ok(func) = runner.dyn_into::<js_sys::Function>() {
                // 実行時エラーの捕捉は仕様書5.8節で扱う（今後実装）
                let _ = func.call2(&JsValue::NULL, object, event);
                return;
            }
        }
    }

    // 実行基盤が読み込まれていない場合に備え、これまでどおり直接呼べるようにしておく
    let Ok(method) = js_sys::Reflect::get(object, &JsValue::from_str("behavior")) else {
        return;
    };
    if let Ok(func) = method.dyn_into::<js_sys::Function>() {
        let _ = func.call1(object, event);
    }
}

/// そのフレームの情報を組み立てる（仕様書6.2.8節）
///
/// `behavior(e)` の `e` として、すべてのオブジェクトへ同じものを渡す。
fn build_frame_event(frame: u64, time: f64) -> JsValue {
    let event = js_sys::Object::new();
    let _ = js_sys::Reflect::set(
        &event,
        &JsValue::from_str("frame"),
        &JsValue::from_f64(frame as f64),
    );
    let _ = js_sys::Reflect::set(&event, &JsValue::from_str("time"), &JsValue::from_f64(time));
    event.into()
}

/// 再生中のアニメーションを1フレームぶん進める
///
/// 進める量は**目標FPSの1フレーム時間**にする。処理落ちしても
/// アニメーションが飛ばず、ゲーム全体が素直に遅くなる（仕様書6.1節の考え方に合わせる）。
fn advance_animations(delta_sec: f64) {
    let Some(window) = window() else { return };
    let Ok(func) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerAdvanceAnimations"))
    else {
        return;
    };
    let Ok(func) = func.dyn_into::<js_sys::Function>() else {
        return;
    };

    let objects = js_sys::Array::new();
    GAME_OBJECTS.with(|o| {
        for (_, object) in o.borrow().iter() {
            objects.push(object);
        }
    });
    let _ = func.call2(&JsValue::NULL, objects.as_ref(), &JsValue::from_f64(delta_sec));
}

/// 裏フレームバッファへ描画する（仕様書6.1節）
fn draw_back_buffer() {
    let Some(window) = window() else { return };
    let Ok(func) = js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerDrawScene")) else {
        return;
    };
    let Ok(func) = func.dyn_into::<js_sys::Function>() else {
        return;
    };

    // 走査順（＝追加順）のままレンダラーへ渡す
    let objects = js_sys::Array::new();
    GAME_OBJECTS.with(|o| {
        for (_, object) in o.borrow().iter() {
            objects.push(object);
        }
    });
    let _ = func.call1(&JsValue::NULL, objects.as_ref());
}

/// 表示バッファと裏バッファを入れ替える（仕様書6.1節）
fn present_back_buffer() {
    call_global("arcadeerPresent");
}

/// レンダラーを初期化する（失敗した理由をそのまま返す）
fn init_renderer() -> Result<(), JsValue> {
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    let func: js_sys::Function =
        js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerInitRenderer"))?.dyn_into()?;
    func.call0(&JsValue::NULL)?;
    Ok(())
}

/// ゲームが使う3Dモデルを、あらかじめGPUへ載せておく
///
/// 実行中に読み込むと描画が止まるため、実行開始時にまとめて用意する。
async fn preload_models() {
    let Some(project) = CURRENT_PROJECT.with(|c| c.borrow().clone()) else {
        return;
    };
    let Some(dir) = ensure_asset_subdir(&project, ResourceKind::Model).await else {
        return;
    };
    let Some(files) = list_files(&dir).await else {
        return;
    };

    let mut loaded = 0usize;
    for name in files {
        if listing::classify_resource(&name) != Some(ResourceKind::Model) {
            continue;
        }
        let Some(url) = load_asset_url(&dir, &name).await else {
            continue;
        };
        if let Err(err) = load_model(&name, &url).await {
            log_err(&t_with("msg.modelLoadFailed", &[("name", &name)]), &err);
        } else {
            loaded += 1;
        }
    }
    log(&t_with("msg.modelsLoaded", &[("count", &loaded.to_string())]));
}

/// renderer.js の loadModel を呼ぶ
async fn load_model(name: &str, url: &str) -> Result<(), JsValue> {
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    let func: js_sys::Function =
        js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerLoadModel"))?.dyn_into()?;
    let promise: js_sys::Promise = func
        .call2(
            &JsValue::NULL,
            &JsValue::from_str(name),
            &JsValue::from_str(url),
        )?
        .dyn_into()?;
    JsFuture::from(promise).await?;
    Ok(())
}

/// FPS表示を更新する（毎フレーム書き換えないよう間引く）
fn show_fps(fps: f64, now: f64) {
    const INTERVAL_MS: f64 = 250.0;
    let last = FPS_SHOWN_AT.with(|t| *t.borrow());
    if now - last < INTERVAL_MS {
        return;
    }
    FPS_SHOWN_AT.with(|t| *t.borrow_mut() = now);
    set_fps_display(Some(fps));
}

/// フッターのFPS表示を書き換える（`None` で停止中の表示に戻す）
fn set_fps_display(fps: Option<f64>) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    if let Some(el) = document.get_element_by_id("footer-fps") {
        let text = match fps {
            Some(value) => format!("FPS: {value:.1}"),
            None => "FPS: --".to_string(),
        };
        el.set_text_content(Some(&text));
    }
}

/// 左ペインに表示する読み込み中のスケルトン（A案）
const PANE_SKELETON_HTML: &str = concat!(
    r#"<div class="skeleton skeleton-project"></div>"#,
    r#"<div class="skeleton-tabbar">"#,
    r#"<div class="skeleton skeleton-tab"></div><div class="skeleton skeleton-tab"></div>"#,
    r#"<div class="skeleton skeleton-tab"></div><div class="skeleton skeleton-tab"></div>"#,
    r#"</div>"#,
    r#"<div class="skeleton-grid">"#,
    r#"<div class="skeleton-card"><div class="skeleton skeleton-thumb"></div><div class="skeleton skeleton-name"></div></div>"#,
    r#"<div class="skeleton-card"><div class="skeleton skeleton-thumb"></div><div class="skeleton skeleton-name"></div></div>"#,
    r#"<div class="skeleton-card"><div class="skeleton skeleton-thumb"></div><div class="skeleton skeleton-name"></div></div>"#,
    r#"<div class="skeleton-card"><div class="skeleton skeleton-thumb"></div><div class="skeleton skeleton-name"></div></div>"#,
    r#"<div class="skeleton-card"><div class="skeleton skeleton-thumb"></div><div class="skeleton skeleton-name"></div></div>"#,
    r#"<div class="skeleton-card"><div class="skeleton skeleton-thumb"></div><div class="skeleton skeleton-name"></div></div>"#,
    r#"</div>"#,
);

/// 左ペインを読み込み中のスケルトン表示にする（A案）
fn show_pane_skeleton() {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    if let Some(sidebar) = document.get_element_by_id("ide-sidebar") {
        sidebar.set_inner_html(PANE_SKELETON_HTML);
        call_fade("arcadeerFadeInElement", sidebar.as_ref());
    }
}

/// 画面中央の読み込みインジケーターを表示する（B案）
fn show_loading() {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    if let Some(el) = document.get_element_by_id("app-loading") {
        let _ = el.class_list().add_1("is-visible");
        call_fade("arcadeerFadeInElement", el.as_ref());
    }
}

/// 画面中央の読み込みインジケーターを隠す
async fn hide_loading() {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Some(el) = document.get_element_by_id("app-loading") else {
        return;
    };
    if let Some(value) = call_fade("arcadeerFadeOutElement", el.as_ref()) {
        if let Ok(promise) = value.dyn_into::<js_sys::Promise>() {
            let _ = JsFuture::from(promise).await;
        }
    }
    let _ = el.class_list().remove_1("is-visible");
}

/// プロジェクトを開いた状態にする（新規作成後・一覧から選択時に共通で使う）
///
/// 編集中のファイルと選択タブを初期化し、メイン部を空にして左ペインを描画する。
/// コンソールへの記録は、作成・選択のどちらかが分かるよう呼び出し側で行う。
async fn open_project(project: FileSystemDirectoryHandle, name: String) {
    // 読み込み中であることを 3か所で示す
    show_loading(); // 中央のインジケーター
    show_pane_skeleton(); // 左ペインのスケルトン
    log(&t_with("msg.loadingProject", &[("name", &name)])); // フッターのコンソール

    // リロード後に開き直せるよう、ディレクトリ名（GUID）を控える
    store_last_project(&project.name());
    CURRENT_PROJECT.with(|c| *c.borrow_mut() = Some(project.clone()));
    CURRENT_FILE.with(|f| *f.borrow_mut() = None);
    SELECTED_TAB.with(|k| k.borrow_mut().clear());
    clear_main();
    CURRENT_PROJECT_NAME.with(|n| *n.borrow_mut() = name.clone());
    if let Err(err) = render_project_pane(&project).await {
        log_err(&t("msg.paneRenderFailed"), &err);
    }
    update_game_buttons();
    update_main_layout();
    hide_loading().await;
}

/// 左ペイン（サイドバー）にプロジェクト編集用の内容を描画する
///
/// 上段: タブバー（オブジェクト／画像／音声／3Dモデル／その他）
/// 中段: 選択中タブの一覧
/// 最下段: 新規オブジェクト作成ボタン
async fn render_project_pane(project: &FileSystemDirectoryHandle) -> Result<(), JsValue> {
    let code_files = list_file_names(project, CODE_DIR).await;
    let image_files = list_asset_files(project, ResourceKind::Image).await;
    let sound_files = list_asset_files(project, ResourceKind::Sound).await;
    let model_files = list_asset_files(project, ResourceKind::Model).await;
    let mut tabs = build_pane_tabs(
        code_files.as_deref(),
        image_files.as_deref(),
        sound_files.as_deref(),
        model_files.as_deref(),
    );

    // info.toml に保存された並び順を反映する（3.3節）
    let saved = load_order(project).await;
    for tab in &mut tabs {
        if let Some(key) = order_key_for_tab(&tab.label_key) {
            let empty = Vec::new();
            let order = saved.get(key).unwrap_or(&empty);
            tab.items = apply_order(&tab.items, order);
        }
    }

    let document = window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("no document"))?;
    let sidebar = document
        .get_element_by_id("ide-sidebar")
        .ok_or_else(|| JsValue::from_str("#ide-sidebar not found"))?;

    // 既存表示のフェードアウト完了を待つ
    if sidebar.child_element_count() > 0 {
        if let Some(value) = call_fade("arcadeerFadeOutElement", sidebar.as_ref()) {
            if let Ok(promise) = value.dyn_into::<js_sys::Promise>() {
                let _ = JsFuture::from(promise).await;
            }
        }
    }
    sidebar.set_inner_html("");

    // 最上部: 開いているプロジェクト名
    let heading = document.create_element("div")?;
    heading.set_class_name("pane-project");
    let project_name = CURRENT_PROJECT_NAME.with(|n| n.borrow().clone());
    heading.set_attribute("title", &project_name)?;

    // 名前は独立した要素にする。直接テキストを置くと、長い名前が
    // 右端のボタンを押し出してしまうため。
    let name = document.create_element("span")?;
    name.set_class_name("pane-project-name");
    name.set_text_content(Some(&project_name));
    heading.append_child(&name)?;

    // 16:9より狭い場合は、ここに実行トグルを置く（表示切り替えはCSSが行う）
    let pane_toggle = build_game_toggle(&document, "pane-toggle-btn")?;
    heading.append_child(&pane_toggle)?;

    sidebar.append_child(&heading)?;

    // タブバー: 左に「タブ群」、右端に「＋」を置く2要素構成にする
    // （margin だけに頼らず、確実に両端へ寄せるため）
    let tab_bar = document.create_element("div")?;
    tab_bar.set_class_name("pane-tabbar");

    let tab_group = document.create_element("div")?;
    tab_group.set_class_name("pane-tabs");
    tab_group.set_attribute("role", "tablist")?;

    // 一覧の表示領域
    let body = document.create_element("div")?;
    body.set_class_name("pane-body");

    // 再描画（アセット追加・クラス作成・言語切替）で選択中のタブが戻らないようにする
    let previous = SELECTED_TAB.with(|k| k.borrow().clone());
    let active = active_tab_index(&tabs, &previous);

    for (index, tab) in tabs.iter().enumerate() {
        let button = document.create_element("button")?;
        button.set_attribute("type", "button")?;
        button.set_attribute("role", "tab")?;
        button.set_class_name("pane-tab");
        // 見出しはアイコンで表し、名称はツールチップで示す
        let label = t(&tab.label_key);
        button.set_inner_html(tab_icon_svg(&tab.label_key));
        button.set_attribute("data-tooltip", &label)?;
        button.set_attribute("aria-label", &label)?;
        set_tab_selected(&button, index == active)?;

        let label_key = tab.label_key.clone();
        let bar = tab_group.clone();
        let target = body.clone();
        let on_click = Closure::<dyn FnMut(_)>::new(move |e: web_sys::Event| {
            // 同じタブバー内の選択状態を切り替える
            if let Some(clicked) = e.current_target().and_then(|t| t.dyn_into::<Element>().ok()) {
                let children = bar.children();
                for i in 0..children.length() {
                    if let Some(child) = children.item(i) {
                        let selected = child.is_same_node(Some(clicked.as_ref()));
                        let _ = set_tab_selected(&child, selected);
                    }
                }
            }
            SELECTED_TAB.with(|k| *k.borrow_mut() = label_key.clone());

            // 描画時点ではなく、現在の内容（並べ替え後）を読み直す
            let current = PANE_TABS.with(|tabs| {
                tabs.borrow()
                    .iter()
                    .find(|t| t.label_key == label_key)
                    .cloned()
            });
            if let Some(tab) = current {
                if let Err(err) = fill_pane_body(&target, &tab) {
                    log_err("failed to render pane body", &err);
                }
            }
        });
        button.add_event_listener_with_callback("click", on_click.as_ref().unchecked_ref())?;
        on_click.forget();

        tab_group.append_child(&button)?;
    }
    // 3Dモデルの右へ、アセットの対応表を開くボタンを置く（仕様書5.7節）。
    // タブではないため、選択状態は持たない
    let asset_map_button = build_asset_map_button(&document)?;
    tab_group.append_child(&asset_map_button)?;
    tab_bar.append_child(&tab_group)?;

    // クラス名の重複判定に使うため、オブジェクトタブの内容は常に控えておく
    if let Some(object_tab) = tabs.first() {
        CURRENT_OBJECTS.with(|o| *o.borrow_mut() = object_tab.items.clone());
    }

    PANE_TABS.with(|t| *t.borrow_mut() = tabs.clone());

    if let Some(tab) = tabs.get(active) {
        SELECTED_TAB.with(|k| *k.borrow_mut() = tab.label_key.clone());
        fill_pane_body(&body, tab)?;
    }

    sidebar.append_child(&tab_bar)?;
    sidebar.append_child(&body)?;

    // 左ペインに置いたトグルにも現在の状態を反映する
    update_game_buttons();

    call_fade("arcadeerFadeInElement", sidebar.as_ref());
    Ok(())
}

/// 選択中のタブに応じた新規追加の動作を行う
///
///   オブジェクト: 新規クラスファイル作成
///   画像／音声／3Dモデル: ファイル選択画面から assets/ へ追加
fn trigger_pane_action() {
    let selected = SELECTED_TAB.with(|k| k.borrow().clone());
    if selected == OBJECT_TAB_KEY {
        if let Err(err) = open_new_object_dialog() {
            log_err(&t("msg.dialogFailed"), &err);
        }
        return;
    }
    spawn_local(async move {
        if let Err(err) = add_assets(&selected).await {
            if is_user_cancel(&err) {
                return;
            }
            log_err(&t("msg.assetAddFailed"), &err);
            show_message(
                &t_with("msg.assetAddFailed", &[("detail", &format_err(&err))]),
                "error",
                None,
            );
        }
    });
}

/// サムネイル一覧の先頭に置く「新規追加」カードを組み立てる
///
/// サムネイルと同じ大きさで、押すと選択中タブに応じた追加動作を行う。
fn build_add_card(document: &Document, tab_key: &str) -> Result<Element, JsValue> {
    let label = if tab_key == OBJECT_TAB_KEY {
        t("pane.newObject")
    } else {
        t("pane.addAsset")
    };

    let card = document.create_element("li")?;
    card.set_class_name("object-card add-card");
    card.set_attribute("role", "button")?;
    card.set_attribute("tabindex", "0")?;
    card.set_attribute("title", &label)?;
    card.set_attribute("aria-label", &label)?;

    let thumb = document.create_element("div")?;
    thumb.set_class_name("object-card-thumb");
    thumb.set_inner_html(
        r#"<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14" /><path d="M5 12h14" /></svg>"#,
    );
    card.append_child(&thumb)?;

    // 他のカードと同じ位置に名前欄を置く。ここへ「新規追加」を出す
    // （欄の高さがそろうことで、サムネイルの大きさも全カードで揃う）
    let name = document.create_element("div")?;
    name.set_class_name("object-card-name add-card-name");
    name.set_text_content(Some(&t("pane.addNew")));
    card.append_child(&name)?;

    let on_click = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        trigger_pane_action();
    });
    card.add_event_listener_with_callback("click", on_click.as_ref().unchecked_ref())?;
    on_click.forget();

    let on_key = Closure::<dyn FnMut(_)>::new(move |e: web_sys::KeyboardEvent| {
        if e.key() == "Enter" || e.key() == " " {
            e.prevent_default();
            trigger_pane_action();
        }
    });
    card.add_event_listener_with_callback("keydown", on_key.as_ref().unchecked_ref())?;
    on_key.forget();

    Ok(card)
}

/// アセットの対応表を開くボタンを組み立てる（仕様書5.7節）
fn build_asset_map_button(document: &Document) -> Result<Element, JsValue> {
    let button = document.create_element("button")?;
    button.set_attribute("type", "button")?;
    button.set_id("btn-asset-map");
    button.set_class_name("pane-tab pane-tab-action");
    let label = t("pane.assetMap");
    button.set_attribute("data-tooltip", &label)?;
    button.set_attribute("aria-label", &label)?;
    // 対応表: 箇条書きと虫めがね
    button.set_inner_html(concat!(
        r#"<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">"#,
        r#"<path d="M4 6h9M4 12h9M4 18h6" />"#,
        r#"<circle cx="17.5" cy="17" r="2.5" /><path d="M19.6 18.8 22 21" /></svg>"#
    ));

    let on_click = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        spawn_local(async move {
            if let Err(err) = open_asset_map().await {
                log_err(&t("msg.assetMapFailed"), &err);
            }
        });
    });
    button.add_event_listener_with_callback("click", on_click.as_ref().unchecked_ref())?;
    on_click.forget();
    Ok(button)
}

/// 対応表の編集画面を開く
///
/// 実際に置かれているファイルの一覧と、保存されている `assets.toml` を
/// 画面側へ渡す。突き合わせは asset-map.js が行う。
async fn open_asset_map() -> Result<(), JsValue> {
    let project = CURRENT_PROJECT
        .with(|c| c.borrow().clone())
        .ok_or_else(|| JsValue::from_str("no project is open"))?;

    let files = js_sys::Object::new();
    for kind in RESOURCE_ORDER {
        let list = js_sys::Array::new();
        for name in list_asset_files(&project, kind).await.unwrap_or_default() {
            list.push(&JsValue::from_str(&name));
        }
        js_sys::Reflect::set(&files, &JsValue::from_str(kind.dir_name()), &list)?;
    }

    // 対応表がまだ無い場合は、空として扱う
    let toml = read_text_file(&project, ASSET_MAP_FILE)
        .await
        .unwrap_or_default();

    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    let func: js_sys::Function =
        js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerShowAssetMap"))?.dyn_into()?;
    func.call2(&JsValue::NULL, &files, &JsValue::from_str(&toml))?;
    Ok(())
}

/// 画面から渡された対応表を `assets.toml` へ書き出す
fn wire_asset_map_save() -> Result<(), JsValue> {
    let save = Closure::<dyn FnMut(String)>::new(move |text: String| {
        spawn_local(async move {
            let Some(project) = CURRENT_PROJECT.with(|c| c.borrow().clone()) else {
                return;
            };
            if let Err(err) = write_text_file(&project, ASSET_MAP_FILE, &text).await {
                log_err(&t("msg.assetMapFailed"), &err);
            }
        });
    });
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    js_sys::Reflect::set(
        &window,
        &JsValue::from_str("arcadeerSaveAssetMap"),
        save.as_ref(),
    )?;
    save.forget();
    Ok(())
}

/// タブ見出しに使うアイコン（翻訳キーごと）
fn tab_icon_svg(label_key: &str) -> &'static str {
    match label_key {
        // オブジェクト: 円柱
        OBJECT_TAB_KEY => concat!(
            r#"<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">"#,
            r#"<ellipse cx="12" cy="6" rx="7" ry="3" />"#,
            r#"<path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" /></svg>"#
        ),
        // 画像: 額縁と山
        IMAGE_TAB_KEY => concat!(
            r#"<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">"#,
            r#"<rect x="3" y="4.5" width="18" height="15" rx="2" />"#,
            r#"<circle cx="8.5" cy="10" r="1.6" />"#,
            r#"<path d="m21 15.5-5-5-11 9" /></svg>"#
        ),
        // 音声: 連桁付きの音符
        SOUND_TAB_KEY => concat!(
            r#"<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">"#,
            r#"<path d="M9 17.5V5.2l11-1.9v12.3" />"#,
            r#"<ellipse cx="6.5" cy="17.5" rx="2.5" ry="2.2" />"#,
            r#"<ellipse cx="17.5" cy="15.6" rx="2.5" ry="2.2" /></svg>"#
        ),
        // 3Dモデル: 立方体をL字に3つ並べ、上にもう1つ積んだ形
        // （中央の立方体は手前2つに隠れるため描かない。輪郭は「Y」を逆さにした形になる）
        MODEL_TAB_KEY => concat!(
            r#"<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">"#,
            r#"<path d="M12 4.45 16.3 6.6 16.3 10.9 20.6 13.05 20.6 17.35 16.3 19.5 12 17.35 7.7 19.5 3.4 17.35 3.4 13.05 7.7 10.9 7.7 6.6z" />"#,
            r#"<path d="M7.7 6.6 12 8.75 16.3 6.6" /><path d="M12 8.75v4.3" />"#,
            r#"<path d="M16.3 10.9 12 13.05" /><path d="M7.7 10.9 12 13.05" />"#,
            r#"<path d="M12 13.05 16.3 15.2 20.6 13.05" /><path d="M16.3 15.2v4.3" />"#,
            r#"<path d="M3.4 13.05 7.7 15.2 12 13.05" /><path d="M7.7 15.2v4.3" />"#,
            r#"<path d="M12 13.05v4.3" /></svg>"#
        ),
        _ => concat!(
            r#"<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">"#,
            r#"<circle cx="12" cy="12" r="8" /></svg>"#
        ),
    }
}

/// タブの選択状態を切り替える
fn set_tab_selected(tab: &Element, selected: bool) -> Result<(), JsValue> {
    tab.set_attribute("aria-selected", if selected { "true" } else { "false" })?;
    tab.set_class_name(if selected {
        "pane-tab pane-tab-active"
    } else {
        "pane-tab"
    });
    Ok(())
}

/// 選択中タブの内容を一覧領域へ描画する
fn fill_pane_body(body: &Element, tab: &PaneTab) -> Result<(), JsValue> {
    let document = window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("no document"))?;
    body.set_inner_html("");

    // ディレクトリを使えないときだけ案内文を出す。
    // 単に0件のときは何も出さず、追加カードだけを見せる。
    if !tab.dir_available {
        let notice = document.create_element("p")?;
        notice.set_class_name("pane-empty");
        notice.set_text_content(Some(&t(&tab.unavailable_message_key)));
        body.append_child(&notice)?;
    }

    // オブジェクトタブは正方形アイコンのグリッド、それ以外は一覧で表示する
    if tab.label_key == OBJECT_TAB_KEY {
        let grid = document.create_element("ul")?;
        grid.set_class_name("pane-object-grid");
        let add = build_add_card(&document, &tab.label_key)?;
        grid.append_child(&add)?;
        for name in &tab.items {
            let card = build_object_card(&document, name)?;
            grid.append_child(&card)?;
        }
        body.append_child(&grid)?;

        // タブ切り替えや一覧の作り直しでも、編集中のオブジェクトを強調したままにする
        if let Some(open) = current_object_name() {
            highlight_open_object(&open);
        }

        // 各オブジェクトが使うアセットを読み、サムネイルへ差し込む
        let names = tab.items.clone();
        spawn_local(async move {
            load_object_thumbnails(names).await;
        });
        return Ok(());
    }

    // 画像タブはサムネイル付きのグリッド表示にする
    if tab.label_key == IMAGE_TAB_KEY {
        let grid = document.create_element("ul")?;
        grid.set_class_name("pane-object-grid");
        let add = build_add_card(&document, &tab.label_key)?;
        grid.append_child(&add)?;
        for name in &tab.items {
            let card = build_asset_card(&document, name)?;
            grid.append_child(&card)?;
        }
        body.append_child(&grid)?;

        // 実画像の読み込みは非同期。まずプレースホルダーを出し、後から差し替える
        let names = tab.items.clone();
        spawn_local(async move {
            load_image_thumbnails(names).await;
        });
        return Ok(());
    }

    // 音声タブは再生ボタン付きのグリッド表示にする
    if tab.label_key == SOUND_TAB_KEY {
        let grid = document.create_element("ul")?;
        grid.set_class_name("pane-object-grid");
        let add = build_add_card(&document, &tab.label_key)?;
        grid.append_child(&add)?;
        for name in &tab.items {
            let card = build_audio_card(&document, name)?;
            grid.append_child(&card)?;
        }
        body.append_child(&grid)?;

        // object URL の発行は非同期。取得できたボタンから再生可能にする
        let names = tab.items.clone();
        spawn_local(async move {
            load_audio_urls(names).await;
        });
        return Ok(());
    }

    // 3Dモデルタブもグリッド表示にし、WebGLで描いたプレビューを差し込む
    if tab.label_key == MODEL_TAB_KEY {
        let grid = document.create_element("ul")?;
        grid.set_class_name("pane-object-grid");
        let add = build_add_card(&document, &tab.label_key)?;
        grid.append_child(&add)?;
        for name in &tab.items {
            let card = build_model_card(&document, name)?;
            grid.append_child(&card)?;
        }
        body.append_child(&grid)?;

        let names = tab.items.clone();
        spawn_local(async move {
            load_model_thumbnails(names).await;
        });
        return Ok(());
    }

    let list = document.create_element("ul")?;
    list.set_class_name("pane-list");
    for item in &tab.items {
        let li = document.create_element("li")?;
        li.set_class_name("pane-item");
        li.set_attribute("title", item)?;
        li.set_text_content(Some(item));
        list.append_child(&li)?;
    }
    body.append_child(&list)?;
    Ok(())
}

/// 3Dモデル1件分の正方形カードを組み立てる（プレビューは後から差し込む）
fn build_model_card(document: &Document, file_name: &str) -> Result<Element, JsValue> {
    let card = document.create_element("li")?;
    // model-card はホバー回転の対象を示す（data-url は読み込み後に設定する）
    card.set_class_name("object-card asset-card model-card");
    card.set_attribute("data-asset", file_name)?;
    card.set_attribute("title", file_name)?;
    card.set_attribute("draggable", "true")?;

    let thumb = document.create_element("div")?;
    thumb.set_class_name("object-card-thumb");
    // 描画できるまでのプレースホルダー（立方体）
    thumb.set_inner_html(
        r#"<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2.5 21 7v10l-9 4.5L3 17V7z" /><path d="M3 7l9 4.5L21 7" /><path d="M12 11.5V21.5" /></svg>"#,
    );
    card.append_child(&thumb)?;

    let label = document.create_element("div")?;
    label.set_class_name("object-card-name");
    label.set_text_content(Some(file_name));
    card.append_child(&label)?;

    Ok(card)
}

/// assets/models/ のモデルをWebGLで描画し、各カードへプレビューを差し込む
async fn load_model_thumbnails(file_names: Vec<String>) {
    revoke_asset_urls();

    let Some(project) = CURRENT_PROJECT.with(|c| c.borrow().clone()) else {
        return;
    };
    let Some(dir) = ensure_asset_subdir(&project, ResourceKind::Model).await else {
        return;
    };

    for name in file_names {
        let Some(url) = load_asset_url(&dir, &name).await else {
            continue;
        };
        // 描画できないモデル（.gltf の外部参照など）はプレースホルダーのままにする
        if let Some(data_url) = build_model_thumbnail(&url).await {
            set_asset_thumbnail(&name, &data_url);
            // ホバー中の回転描画で読み直せるよう、カードへ object URL を持たせる
            set_card_url(&name, &url);
        }
    }
}

/// model-preview.js にサムネイル生成を依頼する
async fn build_model_thumbnail(url: &str) -> Option<String> {
    let window = window()?;
    let func: js_sys::Function =
        js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("arcadeerBuildModelThumbnail"))
            .ok()?
            .dyn_into()
            .ok()?;
    let promise: js_sys::Promise = func
        .call1(&JsValue::NULL, &JsValue::from_str(url))
        .ok()?
        .dyn_into()
        .ok()?;
    JsFuture::from(promise).await.ok()?.as_string()
}

/// model-preview.js に、組み込みプリミティブのサムネイル生成を依頼する
async fn build_primitive_thumbnail(shape: &str) -> Option<String> {
    let window = window()?;
    let func: js_sys::Function = js_sys::Reflect::get(
        window.as_ref(),
        &JsValue::from_str("arcadeerBuildPrimitiveThumbnail"),
    )
    .ok()?
    .dyn_into()
    .ok()?;
    func.call1(&JsValue::NULL, &JsValue::from_str(shape)).ok()?.as_string()
}

/// プリミティブのカードを、ホバーで回せるようにする
///
/// 3Dモデルと違って読み込むファイルが無いため、形状名だけを持たせる。
fn enable_object_primitive_hover(object_name: &str, shape: &str) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(cards) = document.query_selector_all(".object-card[data-object]") else {
        return;
    };
    for i in 0..cards.length() {
        let Some(node) = cards.item(i) else { continue };
        let Ok(card) = node.dyn_into::<Element>() else {
            continue;
        };
        if card.get_attribute("data-object").as_deref() != Some(object_name) {
            continue;
        }
        let _ = card.class_list().add_1("model-card");
        let _ = card.set_attribute("data-primitive", shape);
        return;
    }
}

/// アセット1件分の正方形カードを組み立てる（サムネイルは後から差し込む）
fn build_asset_card(document: &Document, file_name: &str) -> Result<Element, JsValue> {
    let card = document.create_element("li")?;
    card.set_class_name("object-card asset-card");
    card.set_attribute("data-asset", file_name)?;
    card.set_attribute("title", file_name)?;
    card.set_attribute("draggable", "true")?;

    let thumb = document.create_element("div")?;
    thumb.set_class_name("object-card-thumb");
    // 読み込み中のプレースホルダー（画像アイコン）
    thumb.set_inner_html(
        r#"<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m21 16-5-5-11 9" /></svg>"#,
    );
    card.append_child(&thumb)?;

    let label = document.create_element("div")?;
    label.set_class_name("object-card-name");
    label.set_text_content(Some(file_name));
    card.append_child(&label)?;

    Ok(card)
}

/// 音声1件分の正方形カードを組み立てる（再生ボタン付き）
fn build_audio_card(document: &Document, file_name: &str) -> Result<Element, JsValue> {
    let card = document.create_element("li")?;
    card.set_class_name("object-card asset-card");
    card.set_attribute("data-asset", file_name)?;
    card.set_attribute("title", file_name)?;
    card.set_attribute("draggable", "true")?;

    let thumb = document.create_element("div")?;
    thumb.set_class_name("object-card-thumb");

    let button = document.create_element("button")?;
    button.set_attribute("type", "button")?;
    button.set_class_name("audio-play-btn");
    button.set_attribute("data-asset", file_name)?;
    // 再生可能になるまでは押せない（data-url は読み込み後に設定する）
    button.set_attribute("disabled", "")?;
    init_play_button(&button);
    thumb.append_child(&button)?;
    card.append_child(&thumb)?;

    let label = document.create_element("div")?;
    label.set_class_name("object-card-name");
    label.set_text_content(Some(file_name));
    card.append_child(&label)?;

    Ok(card)
}

/// audio-preview.js に再生ボタンの初期表示を整えてもらう
fn init_play_button(button: &Element) {
    let Some(window) = window() else { return };
    let Ok(func) = js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("arcadeerInitPlayButton"))
    else {
        return;
    };
    if let Ok(func) = func.dyn_into::<js_sys::Function>() {
        let _ = func.call1(&JsValue::NULL, button.as_ref());
    }
}

/// assets/sounds/ の音声を読み込み、各再生ボタンへ object URL を設定する
async fn load_audio_urls(file_names: Vec<String>) {
    revoke_asset_urls();

    let Some(project) = CURRENT_PROJECT.with(|c| c.borrow().clone()) else {
        return;
    };
    let Some(dir) = ensure_asset_subdir(&project, ResourceKind::Sound).await else {
        return;
    };

    for name in file_names {
        let Some(url) = load_asset_url(&dir, &name).await else {
            continue;
        };
        set_audio_url(&name, &url);
    }
}

/// 該当するカードへ object URL を設定する（ホバー回転で使用）
fn set_card_url(file_name: &str, url: &str) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(cards) = document.query_selector_all(".model-card") else {
        return;
    };
    for i in 0..cards.length() {
        let Some(node) = cards.item(i) else { continue };
        let Ok(card) = node.dyn_into::<Element>() else {
            continue;
        };
        if card.get_attribute("data-asset").as_deref() == Some(file_name) {
            let _ = card.set_attribute("data-url", url);
            return;
        }
    }
}

/// 該当する再生ボタンへ object URL を設定し、押せるようにする
fn set_audio_url(file_name: &str, url: &str) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(buttons) = document.query_selector_all(".audio-play-btn") else {
        return;
    };
    for i in 0..buttons.length() {
        let Some(node) = buttons.item(i) else { continue };
        let Ok(button) = node.dyn_into::<Element>() else {
            continue;
        };
        if button.get_attribute("data-asset").as_deref() != Some(file_name) {
            continue;
        }
        let _ = button.set_attribute("data-url", url);
        let _ = button.remove_attribute("disabled");
        return;
    }
}

/// 発行済みの object URL をまとめて解放する（再生中なら停止してから）
fn revoke_asset_urls() {
    stop_audio_preview();
    clear_model_cache();
    ASSET_URLS.with(|urls| {
        for url in urls.borrow_mut().drain(..) {
            Url::revoke_object_url(&url).ok();
        }
    });
}

/// ホバー回転を止め、解放済み URL のモデルキャッシュを捨てる
fn clear_model_cache() {
    call_global("arcadeerClearModelCache");
}

/// 引数なしのグローバル関数を呼ぶ（未ロード時は何もしない）
fn call_global(name: &str) {
    let Some(window) = window() else { return };
    let Ok(func) = js_sys::Reflect::get(window.as_ref(), &JsValue::from_str(name)) else {
        return;
    };
    if let Ok(func) = func.dyn_into::<js_sys::Function>() {
        let _ = func.call0(&JsValue::NULL);
    }
}

/// 再生中のプレビューを止める
fn stop_audio_preview() {
    call_global("arcadeerStopAudio");
}

/// オブジェクトカードのサムネイル枠に置く、既定の絵（立方体アイコン）
const OBJECT_THUMB_PLACEHOLDER: &str = r#"<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2.5 21 7v10l-9 4.5L3 17V7z" /><path d="M3 7l9 4.5L21 7" /><path d="M12 11.5V21.5" /></svg>"#;

/// サムネイルを作り直す前に、カードを既定の状態へ戻す
///
/// `@MODEL` を書き替えた時に、**前の絵やホバー指定が残らない**ようにする。
/// 例えば `"sphere"` から `.glb` へ変えた場合、`data-primitive` が残っていると
/// ホバーで前の形が回ってしまう。
fn reset_object_thumbnail(object_name: &str) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(cards) = document.query_selector_all(".object-card[data-object]") else {
        return;
    };
    for i in 0..cards.length() {
        let Some(node) = cards.item(i) else { continue };
        let Ok(card) = node.dyn_into::<Element>() else {
            continue;
        };
        if card.get_attribute("data-object").as_deref() != Some(object_name) {
            continue;
        }
        let _ = card.class_list().remove_1("model-card");
        let _ = card.remove_attribute("data-primitive");
        let _ = card.remove_attribute("data-url");
        if let Some(thumb) = card.first_element_child() {
            thumb.set_inner_html(OBJECT_THUMB_PLACEHOLDER);
        }
        return;
    }
}

/// 各オブジェクトが `@MODEL` で指定したアセットを読み、サムネイルへ差し込む（仕様書6.3節）
///
/// 指定が無い・読めない・文字列で書かれていない場合はプレースホルダーのままにする。
async fn load_object_thumbnails(object_names: Vec<String>) {
    revoke_asset_urls();

    let Some(project) = CURRENT_PROJECT.with(|c| c.borrow().clone()) else {
        return;
    };
    let Some(code_dir) = ensure_subdirectory(&project, CODE_DIR).await else {
        return;
    };

    for name in object_names {
        // 前の絵とホバー指定を落としてから作り直す
        reset_object_thumbnail(&name);

        let Ok(source) = read_text_file(&code_dir, &class_file_name(&name)).await else {
            continue;
        };
        let Some(asset) = parse_model_ref(&source) else {
            continue;
        };
        // 組み込みプリミティブ（box / sphere など）は、その形を白く描いて出す。
        // ファイルが無いので、ここで済ませてしまう
        if is_primitive_name(&asset) {
            if let Some(data_url) = build_primitive_thumbnail(&asset).await {
                set_object_thumbnail(&name, &data_url);
                enable_object_primitive_hover(&name, &asset);
            }
            continue;
        }
        // 拡張子で画像か3Dモデルかを判断する（既定値の "primitive" はここで除かれる）
        let Some(kind) = classify_resource(&asset) else {
            continue;
        };
        let Some(dir) = ensure_asset_subdir(&project, kind).await else {
            continue;
        };
        let Some(url) = load_asset_url(&dir, &asset).await else {
            continue;
        };

        match kind {
            ResourceKind::Model => {
                if let Some(data_url) = build_model_thumbnail(&url).await {
                    set_object_thumbnail(&name, &data_url);
                    // ホバーで回して確認できるようにする
                    enable_object_model_hover(&name, &url);
                }
            }
            // 音声には見た目が無いため、サムネイルにはしない
            ResourceKind::Sound => {}
            ResourceKind::Image => set_object_thumbnail(&name, &url),
        }
    }
}

/// 該当するオブジェクトカードのサムネイル枠を <img> へ差し替える
fn set_object_thumbnail(object_name: &str, url: &str) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(cards) = document.query_selector_all(".object-card[data-object]") else {
        return;
    };
    for i in 0..cards.length() {
        let Some(node) = cards.item(i) else { continue };
        let Ok(card) = node.dyn_into::<Element>() else {
            continue;
        };
        if card.get_attribute("data-object").as_deref() != Some(object_name) {
            continue;
        }
        if let Some(thumb) = card.first_element_child() {
            let Ok(img) = document.create_element("img") else {
                return;
            };
            let _ = img.set_attribute("src", url);
            let _ = img.set_attribute("alt", "");
            thumb.set_inner_html("");
            let _ = thumb.append_child(&img);
        }
        return;
    }
}

/// 3Dモデルを使うオブジェクトを、ホバーで回転できるようにする
fn enable_object_model_hover(object_name: &str, url: &str) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(cards) = document.query_selector_all(".object-card[data-object]") else {
        return;
    };
    for i in 0..cards.length() {
        let Some(node) = cards.item(i) else { continue };
        let Ok(card) = node.dyn_into::<Element>() else {
            continue;
        };
        if card.get_attribute("data-object").as_deref() != Some(object_name) {
            continue;
        }
        let _ = card.class_list().add_1("model-card");
        let _ = card.set_attribute("data-url", url);
        return;
    }
}

/// assets/ の画像を読み込み、各カードのサムネイル枠へ差し込む
async fn load_image_thumbnails(file_names: Vec<String>) {
    revoke_asset_urls();

    let Some(project) = CURRENT_PROJECT.with(|c| c.borrow().clone()) else {
        return;
    };
    let Some(assets_dir) = ensure_asset_subdir(&project, ResourceKind::Image).await else {
        return;
    };

    for name in file_names {
        let Some(url) = load_asset_url(&assets_dir, &name).await else {
            continue;
        };
        set_asset_thumbnail(&name, &url);
    }
}

/// アセットファイルを読み込み、<img> 表示用の object URL を発行する
async fn load_asset_url(dir: &FileSystemDirectoryHandle, file_name: &str) -> Option<String> {
    let file_handle: FileSystemFileHandle = JsFuture::from(dir.get_file_handle(file_name))
        .await
        .ok()?
        .dyn_into()
        .ok()?;
    let file: File = JsFuture::from(file_handle.get_file()).await.ok()?.dyn_into().ok()?;
    let url = Url::create_object_url_with_blob(&file).ok()?;
    ASSET_URLS.with(|urls| urls.borrow_mut().push(url.clone()));
    Some(url)
}

/// 該当カードのサムネイル枠を <img> へ差し替える
fn set_asset_thumbnail(file_name: &str, url: &str) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(cards) = document.query_selector_all(".asset-card") else {
        return;
    };
    for i in 0..cards.length() {
        let Some(node) = cards.item(i) else { continue };
        let Ok(card) = node.dyn_into::<Element>() else {
            continue;
        };
        if card.get_attribute("data-asset").as_deref() != Some(file_name) {
            continue;
        }
        if let Some(thumb) = card.first_element_child() {
            let Ok(img) = document.create_element("img") else {
                return;
            };
            let _ = img.set_attribute("src", url);
            let _ = img.set_attribute("alt", "");
            thumb.set_inner_html("");
            let _ = thumb.append_child(&img);
        }
        return;
    }
}

/// オブジェクト1件分の正方形カードを組み立てる
///
/// サムネイル枠は、クラスが使う画像・3Dモデルのプレビューへ差し替えられるようにしてある
/// （現時点は共通のプレースホルダーを表示する）
fn build_object_card(document: &Document, name: &str) -> Result<Element, JsValue> {
    let entry = is_entry_object(name);

    let card = document.create_element("li")?;
    card.set_class_name(if entry {
        "object-card object-card-entry"
    } else {
        "object-card"
    });
    card.set_attribute("data-object", name)?;
    // 起点オブジェクトも掴めるようにする（周りは動くが、ドロップすると元へ戻る）
    card.set_attribute("draggable", "true")?;
    // 起点オブジェクトは削除できないことを補足する
    let hint = if entry {
        format!("{} - {}", name, t("pane.entryObject"))
    } else {
        name.to_string()
    };
    card.set_attribute("title", &hint)?;
    card.set_attribute("role", "button")?;
    card.set_attribute("tabindex", "0")?;

    let thumb = document.create_element("div")?;
    thumb.set_class_name("object-card-thumb");
    // プレースホルダー（立方体）
    thumb.set_inner_html(OBJECT_THUMB_PLACEHOLDER);
    card.append_child(&thumb)?;

    let label = document.create_element("div")?;
    label.set_class_name("object-card-name");
    label.set_text_content(Some(name));
    card.append_child(&label)?;

    let target = name.to_string();
    let on_open = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        spawn_open_object(target.clone());
    });
    card.add_event_listener_with_callback("click", on_open.as_ref().unchecked_ref())?;
    on_open.forget();

    let target = name.to_string();
    let on_key = Closure::<dyn FnMut(_)>::new(move |e: web_sys::KeyboardEvent| {
        if e.key() == "Enter" || e.key() == " " {
            e.prevent_default();
            spawn_open_object(target.clone());
        }
    });
    card.add_event_listener_with_callback("keydown", on_key.as_ref().unchecked_ref())?;
    on_key.forget();

    Ok(card)
}

/// エディタで開いているファイルに対応するオブジェクト名を返す
fn current_object_name() -> Option<String> {
    CURRENT_FILE.with(|f| f.borrow().as_deref().and_then(listing::object_name))
}

/// オブジェクトのクラスファイルをエディタで開く（非同期処理を起動する）
///
/// 既に開いているファイルをクリックした場合は何もしない
/// （読み直すと未保存の編集内容が失われるため）
fn spawn_open_object(name: String) {
    let file_name = class_file_name(&name);
    let already_open = CURRENT_FILE.with(|f| f.borrow().as_deref() == Some(file_name.as_str()));
    if already_open {
        return;
    }
    spawn_local(async move {
        if let Err(err) = open_object_in_editor(&name).await {
            log_err(&t("msg.fileOpenFailed"), &err);
            show_message(
                &t_with("msg.fileOpenFailed", &[("detail", &format_err(&err))]),
                "error",
                None,
            );
        }
    });
}

/// クラスファイルを読み込み、メイン部のエディタで開く
async fn open_object_in_editor(name: &str) -> Result<(), JsValue> {
    let project = CURRENT_PROJECT
        .with(|c| c.borrow().clone())
        .ok_or_else(|| JsValue::from_str("no project is open"))?;
    let code_dir = ensure_subdirectory(&project, CODE_DIR)
        .await
        .ok_or_else(|| JsValue::from_str("code/ directory is unavailable"))?;

    let file_name = class_file_name(name);
    let (content, modified) = read_text_file_with_modified(&code_dir, &file_name).await?;

    CURRENT_FILE.with(|f| *f.borrow_mut() = Some(file_name.clone()));
    highlight_open_object(name);
    call_editor_open(&file_name, &content, &project.name(), modified)
}

/// いま開いているプロジェクトの識別子（ディレクトリ名）
fn current_project_id() -> String {
    CURRENT_PROJECT
        .with(|c| c.borrow().clone())
        .map(|p| p.name())
        .unwrap_or_default()
}

/// 保存されていない下書きを、すべてファイルへ書き出す（仕様書4.11節）
///
/// ゲームを実行する前に呼ぶ。エンジンはファイルを読むため、
/// **書き出さないと編集した内容が実行に反映されない**。
async fn flush_drafts() {
    let Some(window) = window() else { return };
    let project = current_project_id();
    if project.is_empty() {
        return;
    }

    // 打った直後に実行された場合、下書きはまだ書かれていない。
    // 待ちを打ち切って確定させてから読む
    if let Ok(commit) =
        js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("arcadeerCommitDraft"))
    {
        if let Ok(commit) = commit.dyn_into::<js_sys::Function>() {
            if let Ok(promise) = commit.call0(&JsValue::NULL) {
                if let Ok(promise) = promise.dyn_into::<js_sys::Promise>() {
                    let _ = JsFuture::from(promise).await;
                }
            }
        }
    }

    let Ok(func) = js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("arcadeerDraftsOf"))
    else {
        return;
    };
    let Ok(func) = func.dyn_into::<js_sys::Function>() else {
        return;
    };
    let Ok(promise) = func.call1(&JsValue::NULL, &JsValue::from_str(&project)) else {
        return;
    };
    let Ok(promise) = promise.dyn_into::<js_sys::Promise>() else {
        return;
    };
    let Ok(list) = JsFuture::from(promise).await else {
        return;
    };
    let Ok(list) = list.dyn_into::<js_sys::Array>() else {
        return;
    };

    let mut saved = Vec::new();
    for item in list.iter() {
        let get = |key: &str| {
            js_sys::Reflect::get(&item, &JsValue::from_str(key))
                .ok()
                .and_then(|v| v.as_string())
        };
        let (Some(file_name), Some(content), Some(key)) =
            (get("fileName"), get("content"), get("key"))
        else {
            continue;
        };
        match save_class_file(&file_name, &content).await {
            Ok(()) => {
                log(&t_with("msg.fileSaved", &[("name", &file_name)]));
                // 書けたので下書きは用済み。開いているファイルなら未保存マークも消す
                call_global_with_str("arcadeerClearDraft", &key);
                if CURRENT_FILE.with(|f| f.borrow().as_deref() == Some(file_name.as_str())) {
                    notify_editor_saved(&content);
                }
                if let Some(object) = listing::object_name(&file_name) {
                    saved.push(object);
                }
            }
            Err(err) => log_err(&t("msg.fileSaveFailed"), &err),
        }
    }

    // ⌘S と同じように、書けたぶんのサムネイルを作り直す。
    // まとめて1回にするのは、`load_object_thumbnails` が先頭で
    // **全カードぶんの object URL を捨てる**ため。1件ずつ呼ぶと、
    // そのたびに他のカードの URL が無効になり、ホバー回転が効かなくなる
    if !saved.is_empty() {
        load_object_thumbnails(saved).await;
    }
}

/// 一覧で開いているオブジェクトを強調表示する
fn highlight_open_object(name: &str) {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Ok(items) = document.query_selector_all(".object-card") else {
        return;
    };
    for i in 0..items.length() {
        let Some(node) = items.item(i) else { continue };
        let Ok(el) = node.dyn_into::<Element>() else {
            continue;
        };
        let target = el.get_attribute("data-object").unwrap_or_default();
        let mut classes = String::from("object-card");
        if is_entry_object(&target) {
            classes.push_str(" object-card-entry");
        }
        if target == name {
            classes.push_str(" object-card-active");
        }
        el.set_class_name(&classes);
    }
}

/// editor.js の openEditor を呼び出す
fn call_editor_open(
    file_name: &str,
    content: &str,
    project_id: &str,
    modified: f64,
) -> Result<(), JsValue> {
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    let func: js_sys::Function =
        js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("arcadeerOpenEditor"))?
            .dyn_into()?;
    let args = js_sys::Array::new();
    args.push(&JsValue::from_str(file_name));
    args.push(&JsValue::from_str(content));
    args.push(&JsValue::from_str(project_id));
    args.push(&JsValue::from_f64(modified));
    func.apply(&JsValue::NULL, &args)?;
    Ok(())
}

/// エディタからの保存要求（arcadeer:save）を受け取り、ファイルへ書き込む
fn wire_editor_save() -> Result<(), JsValue> {
    let on_save = Closure::<dyn FnMut(_)>::new(move |e: web_sys::CustomEvent| {
        let detail = e.detail();
        let file_name = js_sys::Reflect::get(&detail, &JsValue::from_str("fileName"))
            .ok()
            .and_then(|v| v.as_string());
        let content = js_sys::Reflect::get(&detail, &JsValue::from_str("content"))
            .ok()
            .and_then(|v| v.as_string());
        let (Some(file_name), Some(content)) = (file_name, content) else {
            return;
        };
        spawn_local(async move {
            match save_class_file(&file_name, &content).await {
                Ok(()) => {
                    log(&t_with("msg.fileSaved", &[("name", &file_name)]));
                    notify_editor_saved(&content);
                    // @MODEL を書き替えた場合に備え、そのカードのサムネイルだけ作り直す
                    if let Some(object) = listing::object_name(&file_name) {
                        load_object_thumbnails(vec![object]).await;
                    }
                }
                Err(err) => {
                    log_err(&t("msg.fileSaveFailed"), &err);
                    show_message(
                        &t_with("msg.fileSaveFailed", &[("detail", &format_err(&err))]),
                        "error",
                        None,
                    );
                }
            }
        });
    });
    window()
        .ok_or_else(|| JsValue::from_str("no window"))?
        .add_event_listener_with_callback("arcadeer:save", on_save.as_ref().unchecked_ref())?;
    on_save.forget();
    Ok(())
}

/// クラスファイルを上書き保存する
async fn save_class_file(file_name: &str, content: &str) -> Result<(), JsValue> {
    let project = CURRENT_PROJECT
        .with(|c| c.borrow().clone())
        .ok_or_else(|| JsValue::from_str("no project is open"))?;
    let code_dir = ensure_subdirectory(&project, CODE_DIR)
        .await
        .ok_or_else(|| JsValue::from_str("code/ directory is unavailable"))?;
    write_text_file(&code_dir, file_name, content).await
}

/// 保存完了を editor.js へ伝え、未保存マークを消してもらう
fn notify_editor_saved(content: &str) {
    let Some(window) = window() else { return };
    let Ok(func) = js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("arcadeerEditorSaved"))
    else {
        return;
    };
    if let Ok(func) = func.dyn_into::<js_sys::Function>() {
        let _ = func.call1(&JsValue::NULL, &JsValue::from_str(content));
    }
}

/// ファイル選択画面から選んだアセットを assets/ へ保存する
async fn add_assets(tab_key: &str) -> Result<(), JsValue> {
    let project = CURRENT_PROJECT
        .with(|c| c.borrow().clone())
        .ok_or_else(|| JsValue::from_str("no project is open"))?;

    let kind = kind_from_tab_key(tab_key)
        .ok_or_else(|| JsValue::from_str("tab does not accept assets"))?;

    let files = pick_asset_files(tab_key).await?;
    if files.length() == 0 {
        return Ok(());
    }

    let target_dir = ensure_asset_subdir(&project, kind)
        .await
        .ok_or_else(|| JsValue::from_str("asset directory is unavailable"))?;
    let existing = list_files(&target_dir).await.unwrap_or_default();

    let mut saved = 0usize;
    for value in files.iter() {
        let file: File = value.dyn_into()?;
        let name = file.name();

        // ピッカーの絞り込みはOS側の解釈で緩くなることがあるため、拡張子を必ず確認する
        // （例: audio/mp4 の指定で .mp4 が選べてしまう）
        if listing::classify_resource(&name) != Some(kind) {
            log(&t_with("msg.assetSkipped", &[("name", &name)]));
            continue;
        }

        // 同名ファイルは上書きになるため、その旨をコンソールへ残す
        if existing.iter().any(|e| e == &name) {
            log(&t_with("msg.assetOverwritten", &[("name", &name)]));
        }
        let buffer = JsFuture::from(file.array_buffer()).await?;
        write_binary_file(&target_dir, &name, &buffer.dyn_into()?).await?;
        saved += 1;
    }

    log(&t_with("msg.assetsAdded", &[("count", &saved.to_string())]));

    // 一覧へ反映する
    render_project_pane(&project).await
}

/// asset-picker.js の pickAssets を呼び出す
async fn pick_asset_files(tab_key: &str) -> Result<js_sys::Array, JsValue> {
    let window = window().ok_or_else(|| JsValue::from_str("no window"))?;
    let func: js_sys::Function =
        js_sys::Reflect::get(window.as_ref(), &JsValue::from_str("arcadeerPickAssets"))?
            .dyn_into()?;
    let promise: js_sys::Promise = func
        .call1(&JsValue::NULL, &JsValue::from_str(tab_key))?
        .dyn_into()?;
    JsFuture::from(promise).await?.dyn_into()
}

/// バイナリ内容をファイルへ書き込む
async fn write_binary_file(
    dir: &FileSystemDirectoryHandle,
    file_name: &str,
    buffer: &js_sys::ArrayBuffer,
) -> Result<(), JsValue> {
    let options = FileSystemGetFileOptions::new();
    options.set_create(true);
    let file_handle: FileSystemFileHandle =
        JsFuture::from(dir.get_file_handle_with_options(file_name, &options))
            .await?
            .dyn_into()?;
    let writable: FileSystemWritableFileStream =
        JsFuture::from(file_handle.create_writable()).await?.dyn_into()?;
    JsFuture::from(writable.write_with_buffer_source(buffer)?).await?;
    JsFuture::from(writable.close()).await?;
    Ok(())
}

/// 新規オブジェクト作成ダイアログのボタンを配線する
fn wire_new_object_dialog(document: &Document) -> Result<(), JsValue> {
    let ok: HtmlButtonElement = document
        .get_element_by_id("dialog-new-object-ok")
        .ok_or_else(|| JsValue::from_str("#dialog-new-object-ok not found"))?
        .dyn_into()?;
    let cancel: HtmlButtonElement = document
        .get_element_by_id("dialog-new-object-cancel")
        .ok_or_else(|| JsValue::from_str("#dialog-new-object-cancel not found"))?
        .dyn_into()?;

    let on_ok = Closure::<dyn FnMut(_)>::new(move |e: web_sys::Event| {
        // 検証に失敗したらダイアログを閉じずに入力し直してもらう
        e.prevent_default();
        let raw = match read_input_value("input-object-name") {
            Ok(value) => value,
            Err(err) => {
                log_err("failed to read #input-object-name", &err);
                return;
            }
        };
        let existing = CURRENT_OBJECTS.with(|o| o.borrow().clone());
        let name = match validate_class_name(&raw, &existing) {
            Ok(name) => name,
            Err(reason) => {
                let msg = if reason == class_name::ClassNameError::TooLong {
                    t_with(
                        reason.message_key(),
                        &[("max", &MAX_CLASS_NAME_LEN.to_string())],
                    )
                } else {
                    t(reason.message_key())
                };
                log(&msg);
                show_message(&msg, "warning", None);
                return;
            }
        };
        close_new_object_dialog();
        spawn_local(async move {
            if let Err(err) = create_class_file(name).await {
                log_err(&t("msg.objectCreateFailed"), &err);
                show_message(
                    &t_with("msg.objectCreateFailed", &[("detail", &format_err(&err))]),
                    "error",
                    None,
                );
            }
        });
    });
    ok.add_event_listener_with_callback("click", on_ok.as_ref().unchecked_ref())?;
    on_ok.forget();

    let on_cancel = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        close_new_object_dialog();
    });
    cancel.add_event_listener_with_callback("click", on_cancel.as_ref().unchecked_ref())?;
    on_cancel.forget();

    Ok(())
}

/// 新規オブジェクト作成ダイアログを開く
fn open_new_object_dialog() -> Result<(), JsValue> {
    let document = window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("no document"))?;
    let dialog: HtmlDialogElement = document
        .get_element_by_id("dialog-new-object")
        .ok_or_else(|| JsValue::from_str("#dialog-new-object not found"))?
        .dyn_into()?;
    let input: HtmlInputElement = document
        .get_element_by_id("input-object-name")
        .ok_or_else(|| JsValue::from_str("#input-object-name not found"))?
        .dyn_into()?;
    input.set_value("");

    if call_fade("arcadeerFadeInDialog", dialog.as_ref()).is_none() {
        dialog.show_modal()?;
    }
    input.focus().ok();
    Ok(())
}

/// 新規オブジェクト作成ダイアログを閉じる
fn close_new_object_dialog() {
    let Some(document) = window().and_then(|w| w.document()) else {
        return;
    };
    let Some(dialog) = document.get_element_by_id("dialog-new-object") else {
        return;
    };
    if call_fade("arcadeerFadeOutDialog", dialog.as_ref()).is_none() {
        if let Ok(d) = dialog.dyn_into::<HtmlDialogElement>() {
            d.close();
        }
    }
}

/// 入力欄の値を読む
fn read_input_value(id: &str) -> Result<String, JsValue> {
    let document = window()
        .and_then(|w| w.document())
        .ok_or_else(|| JsValue::from_str("no document"))?;
    let input: HtmlInputElement = document
        .get_element_by_id(id)
        .ok_or_else(|| JsValue::from_str("input not found"))?
        .dyn_into()?;
    Ok(input.value())
}

/// クラスファイル（`code/<クラス名>.coffee`）を作成し、左ペインを更新する
async fn create_class_file(name: String) -> Result<(), JsValue> {
    let project = CURRENT_PROJECT
        .with(|c| c.borrow().clone())
        .ok_or_else(|| JsValue::from_str("no project is open"))?;
    let code_dir = ensure_subdirectory(&project, CODE_DIR)
        .await
        .ok_or_else(|| JsValue::from_str("code/ directory is unavailable"))?;

    let file_name = class_file_name(&name);
    write_text_file(&code_dir, &file_name, &build_class_template(&name)).await?;

    // 完了ダイアログは出さず、フッターのコンソール表示のみとする
    log(&t_with("msg.objectCreated", &[("name", &name)]));

    // 一覧へ反映する
    render_project_pane(&project).await
}

/// クラスファイルの雛形を組み立てる（内容は docs/templete.md に準拠。詳細は今後詰める）
fn build_class_template(name: &str) -> String {
    format!(
        "class {name} extends arcadeermain\n  constructor: (param) ->\n    super(param)\n\n  behavior: (e) ->\n    super(e)\n\n    switch @proc\n      when 0\n        @waitjob(1000)\n"
    )
}

/// メイン部（作業エリア）を 0.3 秒フェードアウトしてから空にする
fn clear_main() {
    let document = match window().and_then(|w| w.document()) {
        Some(d) => d,
        None => return,
    };
    if let Some(el) = document.get_element_by_id("ide-content") {
        // fade.js 未ロード時は即時クリアにフォールバック
        if call_fade("arcadeerFadeOutAndClear", el.as_ref()).is_none() {
            el.set_inner_html("");
        }
    }
}

async fn ensure_readwrite_permission(root: &FileSystemDirectoryHandle) -> Result<(), JsValue> {
    let request = js_sys::Reflect::get(root.as_ref(), &JsValue::from_str("requestPermission"))?;
    let func: js_sys::Function = match request.dyn_into() {
        Ok(f) => f,
        // requestPermission 非対応の環境では picker の readwrite 指定に委ねる
        Err(_) => return Ok(()),
    };
    let descriptor = js_sys::Object::new();
    js_sys::Reflect::set(
        &descriptor,
        &JsValue::from_str("mode"),
        &JsValue::from_str("readwrite"),
    )?;
    let promise: js_sys::Promise = func.call1(root.as_ref(), &descriptor)?.dyn_into()?;
    let state = JsFuture::from(promise).await?;
    if state.as_string().as_deref() == Some("granted") {
        Ok(())
    } else {
        Err(JsValue::from_str(ERR_PERMISSION_DENIED))
    }
}

fn is_user_cancel(err: &JsValue) -> bool {
    if err.as_string().as_deref() == Some(ERR_PERMISSION_DENIED) {
        return true;
    }
    let name = js_sys::Reflect::get(err, &JsValue::from_str("name"))
        .ok()
        .and_then(|v| v.as_string())
        .unwrap_or_default();
    name == "AbortError" || name == "NotAllowedError"
}

/// メッセージダイアログ(message-dialog.js)をWASMから呼び出す
///   kind: "info" | "success" | "warning" | "error"
fn show_message(message: &str, kind: &str, title: Option<&str>) {
    let window = match window() {
        Some(w) => w,
        None => return,
    };
    let func = match js_sys::Reflect::get(&window, &JsValue::from_str("arcadeerShowMessage")) {
        Ok(f) => f,
        Err(_) => return,
    };
    let func: js_sys::Function = match func.dyn_into() {
        Ok(f) => f,
        Err(_) => return,
    };
    let title_val = match title {
        Some(t) => JsValue::from_str(t),
        None => JsValue::UNDEFINED,
    };
    let _ = func.call3(
        &window,
        &JsValue::from_str(message),
        &JsValue::from_str(kind),
        &title_val,
    );
}

fn log(msg: &str) {
    web_sys::console::log_1(&JsValue::from_str(msg));
    append_console(msg);
}

fn log_err(prefix: &str, err: &JsValue) {
    web_sys::console::error_2(&JsValue::from_str(prefix), err);
    let text = format!("{}: {}", prefix, format_err(err));
    append_console(&text);
}

fn format_err(err: &JsValue) -> String {
    err.as_string()
        .or_else(|| {
            js_sys::Reflect::get(err, &JsValue::from_str("message"))
                .ok()
                .and_then(|v| v.as_string())
        })
        .unwrap_or_else(|| format!("{:?}", err))
}

fn append_console(msg: &str) {
    // フッターの1行表示と履歴の更新は console-log.js が受け持つ（4.6節）。
    // ゲームコードの echo() と同じ経路にして、履歴の並びをそろえるため。
    call_global_with_str("arcadeerLog", msg);
}
