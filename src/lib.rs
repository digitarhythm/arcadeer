use std::cell::RefCell;
use std::collections::HashMap;

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::{
    window, Document, File, FileSystemDirectoryHandle, FileSystemFileHandle,
    FileSystemGetDirectoryOptions, FileSystemGetFileOptions, FileSystemWritableFileStream,
    HtmlButtonElement, HtmlDialogElement, HtmlInputElement, Response, Url,
};

/// プロジェクトアイコンのファイル名（プロジェクトディレクトリ直下に配置）
const ICON_FILE_NAME: &str = "icon.png";
/// 新規プロジェクトへコピーするデフォルトアイコン（512x512 PNG）
const DEFAULT_ICON_URL: &str = "./templates/assets/default-icon.png";

thread_local! {
    /// 開いているプロジェクトのディレクトリハンドル（今後の編集機能で使用）
    static CURRENT_PROJECT: RefCell<Option<FileSystemDirectoryHandle>> = RefCell::new(None);
    /// プロジェクト一覧のアイコン表示に発行した object URL（再スキャン時に解放する）
    static ICON_URLS: RefCell<Vec<String>> = RefCell::new(Vec::new());
}

#[wasm_bindgen(start)]
pub fn start() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    let document = window()
        .ok_or_else(|| JsValue::from_str("no window"))?
        .document()
        .ok_or_else(|| JsValue::from_str("no document"))?;

    wire_sidebar(&document)?;
    wire_dialog(&document)?;
    log("Arcadeer IDE 起動");
    Ok(())
}

fn wire_sidebar(document: &Document) -> Result<(), JsValue> {
    let button = document
        .get_element_by_id("btn-new-project")
        .ok_or_else(|| JsValue::from_str("#btn-new-project がありません"))?
        .dyn_into::<HtmlButtonElement>()?;

    let on_click = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        if let Err(err) = open_new_project_dialog() {
            log_err("ダイアログ表示に失敗", &err);
        }
    });
    button.add_event_listener_with_callback("click", on_click.as_ref().unchecked_ref())?;
    on_click.forget();

    let open_button = document
        .get_element_by_id("btn-open-project")
        .ok_or_else(|| JsValue::from_str("#btn-open-project がありません"))?
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
                let msg = "アクセス許可が得られなかったため、プロジェクトを開く処理を中止しました";
                log(msg);
                show_message(msg, "warning", None);
            }
            Err(err) => {
                log_err("プロジェクトを開けませんでした", &err);
                show_message(
                    &format!("プロジェクトを開けませんでした\n{}", format_err(&err)),
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
        .ok_or_else(|| JsValue::from_str("#dialog-new-project-ok がありません"))?
        .dyn_into::<HtmlButtonElement>()?;
    let cancel = document
        .get_element_by_id("dialog-new-project-cancel")
        .ok_or_else(|| JsValue::from_str("#dialog-new-project-cancel がありません"))?
        .dyn_into::<HtmlButtonElement>()?;

    let on_ok = Closure::<dyn FnMut(_)>::new(move |e: web_sys::Event| {
        e.prevent_default();
        let name = match read_project_name() {
            Ok(n) => n,
            Err(err) => {
                log_err("プロジェクト名取得に失敗", &err);
                return;
            }
        };
        if name.trim().is_empty() {
            log("プロジェクト名が空です");
            show_message("プロジェクト名を入力してください", "warning", None);
            return;
        }
        close_dialog();
        spawn_local(async move {
            match create_project(name.clone()).await {
                Ok(()) => {
                    let msg = format!("プロジェクト '{}' を作成しました", name);
                    log(&msg);
                    set_footer_project(&name);
                    show_message(&msg, "success", None);
                }
                Err(err) if is_user_cancel(&err) => {
                    let msg = "アクセス許可が得られなかったため、プロジェクト作成を中止しました";
                    log(msg);
                    show_message(msg, "warning", None);
                }
                Err(err) => {
                    log_err("プロジェクト作成に失敗", &err);
                    show_message(
                        &format!("プロジェクト作成に失敗しました\n{}", format_err(&err)),
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
        .ok_or_else(|| JsValue::from_str("#dialog-new-project がありません"))?
        .dyn_into::<HtmlDialogElement>()?;
    let input = document
        .get_element_by_id("input-project-name")
        .ok_or_else(|| JsValue::from_str("#input-project-name がありません"))?
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
        .ok_or_else(|| JsValue::from_str("#input-project-name がありません"))?
        .dyn_into::<HtmlInputElement>()?;
    Ok(input.value())
}

/// requestPermission が "granted" 以外を返した時に使う中止用エラー
const ERR_PERMISSION_DENIED: &str = "permission-denied";

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
        log("ホームディレクトリの保存に失敗しました（次回もピッカーで選択します）");
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
            "showDirectoryPicker が利用できません（File System Access API 非対応のブラウザ）",
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
                "保存済みホームディレクトリを使えませんでした。選択し直してください",
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

    CURRENT_PROJECT.with(|c| *c.borrow_mut() = Some(subdir));
    log(&format!(
        "ディレクトリ '{}' を作成 (info.toml / {} 記録済み)",
        project_id, ICON_FILE_NAME
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
        .ok_or_else(|| JsValue::from_str("テキストの読み込みに失敗しました"))
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
            "{} の取得に失敗しました (HTTP {})",
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
                "保存済みホームディレクトリを読めませんでした。選択し直してください",
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
        log("ワークスペースにArcadeerプロジェクトが見つかりませんでした");
    } else {
        log(&format!("{} 件のプロジェクトを検出", projects.len()));
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

    projects.sort_by(|a, b| a.name.cmp(&b.name));
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
    let document = window().unwrap().document().unwrap();
    let main = document
        .get_element_by_id("ide-main")
        .ok_or_else(|| JsValue::from_str("#ide-main がありません"))?;

    // 既存表示のフェードアウト完了を待つ
    if main.child_element_count() > 0 {
        if let Some(value) = call_fade("arcadeerFadeOutElement", main.as_ref()) {
            if let Ok(promise) = value.dyn_into::<js_sys::Promise>() {
                let _ = JsFuture::from(promise).await;
            }
        }
    }
    main.set_inner_html("");

    let container = document.create_element("div")?;
    container.set_class_name("project-select");

    // ヘッダー行
    let header = document.create_element("div")?;
    header.set_class_name("project-select-header");

    let title = document.create_element("h2")?;
    title.set_class_name("project-select-title");
    title.set_text_content(Some("プロジェクト選択"));
    header.append_child(&title)?;

    let repick = document.create_element("button")?;
    repick.set_attribute("type", "button")?;
    repick.set_class_name("dialog-btn");
    repick.set_text_content(Some("別のワークスペースを選択する"));
    // 保存済みハンドルを使わず、ピッカーで選び直す
    let on_repick = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
        spawn_open_task(true);
    });
    repick.add_event_listener_with_callback("click", on_repick.as_ref().unchecked_ref())?;
    on_repick.forget();
    header.append_child(&repick)?;

    container.append_child(&header)?;

    if projects.is_empty() {
        let empty = document.create_element("p")?;
        empty.set_class_name("project-select-empty");
        empty.set_text_content(Some(
            "このワークスペースにArcadeerプロジェクトが見つかりませんでした",
        ));
        container.append_child(&empty)?;
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
                CURRENT_PROJECT.with(|c| *c.borrow_mut() = Some(handle.clone()));
                clear_main();
                set_footer_project(&name);
                let msg = format!("プロジェクト '{}' を開きました", name);
                log(&msg);
                show_message(&msg, "success", None);
            });
            card.add_event_listener_with_callback("click", on_select.as_ref().unchecked_ref())?;
            on_select.forget();

            grid.append_child(&card)?;
        }
        container.append_child(&grid)?;
    }

    main.append_child(&container)?;
    // 新しい内容を 0.3 秒フェードイン
    call_fade("arcadeerFadeInElement", main.as_ref());
    Ok(())
}

/// メイン部（作業エリア）を 0.3 秒フェードアウトしてから空にする
fn clear_main() {
    let document = match window().and_then(|w| w.document()) {
        Some(d) => d,
        None => return,
    };
    if let Some(el) = document.get_element_by_id("ide-main") {
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

/// フッター右端に現在のプロジェクト名を表示する
fn set_footer_project(name: &str) {
    let document = match window().and_then(|w| w.document()) {
        Some(d) => d,
        None => return,
    };
    if let Some(el) = document.get_element_by_id("footer-project") {
        el.set_text_content(Some(name));
        // 表示の切り替えを 0.3 秒フェードイン
        call_fade("arcadeerFadeInElement", el.as_ref());
    }
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
    let document = match window().and_then(|w| w.document()) {
        Some(d) => d,
        None => return,
    };
    // フッターには最新のメッセージのみを表示する（履歴はブラウザコンソールで確認できる）
    if let Some(el) = document.get_element_by_id("footer-console") {
        el.set_text_content(Some(msg));
        // 表示の切り替えを 0.3 秒フェードイン
        call_fade("arcadeerFadeInElement", el.as_ref());
    }
}
