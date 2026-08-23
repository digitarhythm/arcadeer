//! 翻訳キーを表示文言へ変換するモジュール。
//!
//! 辞書の実体は `web/locales/*.json` にあり、JS側の `window.arcadeerT` を通して参照する。
//! Rust側は文言を持たず翻訳キーだけを扱う（設計は docs/i18n.md）。

use wasm_bindgen::prelude::*;
use web_sys::window;

/// 翻訳キーを表示文言へ変換する
pub fn t(key: &str) -> String {
    translate(key, &[])
}

/// プレースホルダ付きの翻訳キーを展開する
///
/// ```ignore
/// t_with("msg.projectOpened", &[("name", "my-game")])
/// ```
pub fn t_with(key: &str, params: &[(&str, &str)]) -> String {
    translate(key, params)
}

fn translate(key: &str, params: &[(&str, &str)]) -> String {
    // i18n.js 未ロード時はキーをそのまま返し、画面が壊れないようにする
    let Some(func) = window()
        .and_then(|w| js_sys::Reflect::get(w.as_ref(), &JsValue::from_str("arcadeerT")).ok())
        .and_then(|v| v.dyn_into::<js_sys::Function>().ok())
    else {
        return key.to_string();
    };

    let names = js_sys::Array::new();
    let values = js_sys::Array::new();
    for (name, value) in params {
        names.push(&JsValue::from_str(name));
        values.push(&JsValue::from_str(value));
    }

    func.call3(
        &JsValue::NULL,
        &JsValue::from_str(key),
        names.as_ref(),
        values.as_ref(),
    )
    .ok()
    .and_then(|v| v.as_string())
    .unwrap_or_else(|| key.to_string())
}
