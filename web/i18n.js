// 多言語対応（i18n）モジュール
// 設計は docs/i18n.md を参照。
// 辞書の実体は web/locales/<タグ>.json のみで、Rust(WASM)・JS・HTML がすべてここを参照する。
// WASM(Rust)からは window.arcadeerT(key, names, values) 経由で呼び出す。

/** 対応言語（表示順） */
export const SUPPORTED_LANGS = [
  "ja",
  "en",
  "zh-Hans",
  "zh-Hant",
  "ko",
  "es",
  "fr",
  "de",
  "it",
  "nl",
  "pt",
];

/** 未対応言語の環境で使用するフォールバック言語 */
export const FALLBACK_LANG = "en";

/** 言語選択UIに表示する自称表記 */
export const LANG_NAMES = {
  ja: "日本語",
  en: "English",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
  ko: "한국어",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  nl: "Nederlands",
  pt: "Português",
};

/** 作業者が明示的に選んだ言語の保存先 */
const STORAGE_KEY = "arcadeer.lang";

/** 読み込み済みの辞書（タグ → キー/文言） */
const catalogs = {};
/** 選択中の言語 */
let current = FALLBACK_LANG;

/**
 * 言語タグを対応タグへ正規化する
 * 地域付きタグ（ja-JP 等）や大文字小文字の揺れを吸収する。未対応なら null を返す。
 */
export function normalizeLang(tag) {
  if (typeof tag !== "string" || tag.trim() === "") return null;
  const parts = tag.toLowerCase().replace(/_/g, "-").split("-");
  const base = parts[0];

  // 中国語は文字体系（script）で振り分ける。判別できない場合は簡体字を既定とする
  if (base === "zh") {
    if (parts.includes("hant")) return "zh-Hant";
    if (parts.includes("hans")) return "zh-Hans";
    if (parts.some((p) => ["tw", "hk", "mo"].includes(p))) return "zh-Hant";
    return "zh-Hans";
  }

  return SUPPORTED_LANGS.find((lang) => lang.toLowerCase() === base) ?? null;
}

/**
 * 使用する言語を決める
 * 保存済みの選択 → ブラウザの言語設定（navigator.languages）→ フォールバックの順。
 */
export function resolveLang(stored, preferred = []) {
  const fromStored = normalizeLang(stored);
  if (fromStored) return fromStored;
  for (const tag of preferred) {
    const normalized = normalizeLang(tag);
    if (normalized) return normalized;
  }
  return FALLBACK_LANG;
}

/** 辞書を登録する */
export function setCatalog(tag, messages) {
  catalogs[tag] = messages;
}

/** 選択中の言語を切り替える（辞書の読み込みは行わない） */
export function setLanguage(tag) {
  current = tag;
}

/** 選択中の言語を返す */
export function getLanguage() {
  return current;
}

/** {名前} のプレースホルダを展開する。値が無い箇所はそのまま残す */
function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * キーを選択中の言語で翻訳する
 * 選択中の言語に無いキーはフォールバック言語で補い、それも無ければキー文字列を返す。
 */
export function t(key, params) {
  const template = catalogs[current]?.[key] ?? catalogs[FALLBACK_LANG]?.[key];
  if (template === undefined) return key;
  return interpolate(template, params);
}

// --- 以下はブラウザ専用（bun のテストからは呼び出さない） ---

/** ロケールJSONを読み込んで登録する */
export async function loadLanguage(tag) {
  if (catalogs[tag]) return;
  const res = await fetch(`./locales/${tag}.json`);
  if (!res.ok) throw new Error(`locale ${tag}: HTTP ${res.status}`);
  setCatalog(tag, await res.json());
}

/** data-i18n* 属性を持つ要素へ翻訳を流し込む */
export function applyDom(root = document) {
  const apply = (attr, fn) => {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      fn(el, t(el.getAttribute(attr)));
    }
  };
  apply("data-i18n", (el, text) => (el.textContent = text));
  apply("data-i18n-title", (el, text) => el.setAttribute("title", text));
  apply("data-i18n-tooltip", (el, text) => el.setAttribute("data-tooltip", text));
  apply("data-i18n-aria", (el, text) => el.setAttribute("aria-label", text));
  apply("data-i18n-placeholder", (el, text) => el.setAttribute("placeholder", text));
  apply("data-i18n-alt", (el, text) => el.setAttribute("alt", text));
}

/** 保存済みの言語選択を読む */
function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 言語選択を保存する */
function writeStored(tag) {
  try {
    localStorage.setItem(STORAGE_KEY, tag);
  } catch {
    // プライベートモード等で保存できない場合は無視する（次回は自動判定に戻る）
  }
}

/**
 * 起動時の初期化
 * ブラウザの言語設定を自動判定し、辞書を読み込んで画面へ適用する。
 */
export async function initI18n() {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  const lang = resolveLang(readStored(), preferred);
  await loadLanguage(FALLBACK_LANG);
  if (lang !== FALLBACK_LANG) await loadLanguage(lang);
  setLanguage(lang);
  document.documentElement.lang = lang;
  applyDom();
}

/** 表示言語を切り替えて保存し、画面へ反映する */
export async function changeLanguage(tag) {
  if (!SUPPORTED_LANGS.includes(tag)) return;
  await loadLanguage(tag);
  setLanguage(tag);
  writeStored(tag);
  document.documentElement.lang = tag;
  applyDom();
  // WASM側の動的な描画を作り直してもらう
  window.dispatchEvent(new CustomEvent("arcadeer:languagechange", { detail: { lang: tag } }));
}

// WASMから呼べるようグローバルへ公開する
// names / values は対になる配列（例: ["name"], ["my-game"]）
if (typeof window !== "undefined") {
  window.arcadeerT = (key, names = [], values = []) => {
    const params = {};
    names.forEach((name, i) => (params[name] = values[i]));
    return t(key, names.length ? params : undefined);
  };
  window.arcadeerGetLanguage = getLanguage;
  window.arcadeerChangeLanguage = changeLanguage;
  window.arcadeerSupportedLangs = () => SUPPORTED_LANGS.map((tag) => [tag, LANG_NAMES[tag]]);
}
