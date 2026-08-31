// リファレンスの表示（仕様書4.9節）
//
// ヘッダーの辞書アイコンで開閉する。
// 横長のときはゲーム表示エリアと同じ場所へ、そうでないときは右ペイン全体へ出す。

import { getLanguage, FALLBACK_LANG, t } from "./i18n.js";
import { SECTIONS, headingId, sectionOfHeading } from "./reference/structure.js";

const OPEN_CLASS = "reference-open";

/** 言語 → 読み込んだ内容 */
const loaded = new Map();
let shownLang = null;

/** その言語の内容を読み込む（一度読んだら覚えておく） */
async function loadReference(lang) {
  if (loaded.has(lang)) return loaded.get(lang);
  try {
    const res = await fetch(`./reference/${lang}.json`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    loaded.set(lang, data);
    return data;
  } catch {
    // 読めない言語があってもリファレンス自体は開けるようにする
    if (lang !== FALLBACK_LANG) return loadReference(FALLBACK_LANG);
    return {};
  }
}

/** 開いているか */
export function isReferenceOpen() {
  return document.body.classList.contains(OPEN_CLASS);
}

/** セルを文字列にする（{k} は翻訳、{text} はそのまま、それ以外もそのまま） */
function cellText(cell, dict) {
  if (cell && typeof cell === "object") {
    if (typeof cell.k === "string") return dict[cell.k] ?? cell.k;
    // 飛び先つきのセル。名前は翻訳しない（API名のため）
    if (typeof cell.text === "string") return cell.text;
  }
  return String(cell);
}

/** ブロックを組み立てる */
function buildBlock(block, dict, goTo) {
  if (block.type === "heading") {
    const el = document.createElement("h3");
    el.className = "reference-heading";
    // 一覧から飛べるように、翻訳キーから決まる id を付ける
    el.id = headingId(block.k);
    el.textContent = dict[block.k] ?? block.k;
    return el;
  }
  if (block.type === "text") {
    const el = document.createElement("p");
    el.className = "reference-text";
    el.textContent = dict[block.k] ?? block.k;
    return el;
  }
  if (block.type === "code") {
    const pre = document.createElement("pre");
    pre.className = "reference-code";
    // コードは翻訳しないため、そのまま置く
    pre.textContent = block.code;
    return pre;
  }

  // 表。横幅が足りない場合は表だけを横スクロールさせる
  const wrap = document.createElement("div");
  wrap.className = "reference-table-wrap";
  const table = document.createElement("table");
  table.className = "reference-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const cell of block.head) {
    const th = document.createElement("th");
    th.textContent = cellText(cell, dict);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of block.rows) {
    const tr = document.createElement("tr");
    row.forEach((cell, i) => {
      const td = document.createElement("td");
      const text = cellText(cell, dict);
      // 翻訳しないセル（API名や記号）は等幅で見せる
      if (typeof cell === "string" || typeof cell?.to === "string") {
        td.className = "reference-mono";
      }
      // 飛び先を持つセルは押せるようにする。持たないものはただの文字のまま
      if (typeof cell?.to === "string" && goTo) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "reference-link";
        button.textContent = text;
        button.addEventListener("click", () => goTo(cell.to));
        td.appendChild(button);
      } else {
        td.textContent = text;
      }
      // 最初の列は見出し扱いにして読みやすくする
      if (i === 0) td.classList.add("reference-first");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/** 目次と本文を作り直す */
async function render() {
  const body = document.getElementById("reference-body");
  const nav = document.getElementById("reference-nav");
  if (!body || !nav) return;

  const lang = getLanguage();
  const dict = await loadReference(lang);
  shownLang = lang;

  nav.textContent = "";
  body.textContent = "";

  // 目次はタブにする。内容が長いので、選んだ節だけを出したほうが探しやすい
  const panels = new Map();
  const links = new Map();
  const show = (id) => {
    for (const [key, panel] of panels) panel.hidden = key !== id;
    for (const [key, link] of links) {
      link.classList.toggle("reference-nav-item-active", key === id);
      link.setAttribute("aria-selected", key === id ? "true" : "false");
    }
    body.scrollTop = 0;
  };

  /**
   * 一覧の名前から、その項目の説明まで動かす
   *
   * 飛び先が別の章にある場合は、**先に章を切り替える**。
   * 隠れたままだと位置が測れず、動かせないため。
   */
  const goTo = (key) => {
    const sectionId = sectionOfHeading(key);
    if (sectionId) show(sectionId);
    const heading = document.getElementById(headingId(key));
    if (!heading) return;
    // scrollIntoView は入れ子の都合で途中までしか動かないことがあるため、
    // 表示領域からの差を測って自分でずらす。少し上に余白を残す
    const offset = heading.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop += offset - 8;
  };

  for (const section of SECTIONS) {
    const title = dict[section.title] ?? section.title;

    const link = document.createElement("button");
    link.type = "button";
    link.className = "reference-nav-item";
    link.setAttribute("role", "tab");
    link.textContent = title;
    link.addEventListener("click", () => show(section.id));
    nav.appendChild(link);
    links.set(section.id, link);

    const panel = document.createElement("section");
    panel.className = "reference-panel";
    panel.id = `reference-${section.id}`;

    const heading = document.createElement("h2");
    heading.className = "reference-section-title";
    heading.textContent = title;
    panel.appendChild(heading);

    for (const block of section.blocks) panel.appendChild(buildBlock(block, dict, goTo));
    body.appendChild(panel);
    panels.set(section.id, panel);
  }

  // 最初は先頭の節を出す
  if (SECTIONS.length > 0) show(SECTIONS[0].id);

  const titleEl = document.getElementById("reference-title");
  if (titleEl) titleEl.textContent = t("header.reference");
}

/** 開閉を切り替える */
export async function toggleReference() {
  const open = document.body.classList.toggle(OPEN_CLASS);
  const btn = document.getElementById("btn-reference");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  // 表示言語が変わっていたら作り直す
  if (open && shownLang !== getLanguage()) await render();
  return open;
}

/** 辞書アイコンの操作を組み立てる */
export function initReference() {
  const btn = document.getElementById("btn-reference");
  if (!btn) return;
  btn.addEventListener("click", () => {
    toggleReference();
  });
  render();
  // 表示言語が変わったら作り直す
  window.addEventListener("arcadeer:languagechange", () => {
    render();
  });
}

if (typeof window !== "undefined") {
  window.arcadeerToggleReference = toggleReference;
}
