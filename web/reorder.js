// サムネイルの並べ替え（ドラッグ＆ドロップ）モジュール
//
// ドラッグ中は実際にDOMを動かして、ドロップ後の並びをその場で見せる。
// ドロップ時は並びをWASM(Rust)へ渡して保存するだけで、一覧の作り直しは行わない
// （作り直すとフェードやサムネイルの再読み込みが起きるため）。

/** ドラッグ中のカード */
let dragging = null;
/** 元の位置に戻すための、ドラッグ開始時の次要素 */
let originalNext = null;
/** ドラッグしているのがゲームの起点（gameMain）か */
let draggingEntry = false;
/** dragging クラスを遅らせて付けるためのタイマー */
let dragClassTimer = 0;

/** カードから項目名を取り出す（オブジェクトとアセットで属性が異なる） */
function itemName(card) {
  return card.getAttribute("data-object") ?? card.getAttribute("data-asset");
}

/** 並べ替え対象のカードだけを、表示順に取り出す */
function orderedNames(grid) {
  return [...grid.querySelectorAll(".object-card:not(.add-card)")]
    .map(itemName)
    .filter((name) => name !== null);
}

/** ドラッグ状態を片付ける */
function endDrag() {
  clearTimeout(dragClassTimer);
  dragClassTimer = 0;
  dragging?.classList.remove("dragging");
  dragging = null;
  originalNext = null;
  draggingEntry = false;
}

/**
 * 並べ替え対象のカードへ draggable を付ける
 *
 * カードは WASM 側が描き直すため、DOMの変化を見て付け直す。
 * （描画側の実装に依存せず、常にドラッグできる状態を保つ）
 */
function markDraggable(root = document) {
  for (const card of root.querySelectorAll(".object-card:not(.add-card)")) {
    if (card.getAttribute("draggable") !== "true") {
      card.setAttribute("draggable", "true");
    }
  }
}

if (typeof window !== "undefined") {
  markDraggable();
  const sidebar = document.getElementById("ide-sidebar");
  if (sidebar) {
    new MutationObserver(() => markDraggable(sidebar)).observe(sidebar, {
      childList: true,
      subtree: true,
    });
  }

  document.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.(".object-card[draggable='true']");
    if (!card) return;
    dragging = card;
    originalNext = card.nextElementSibling;
    draggingEntry = card.classList.contains("object-card-entry");
    // dragstart の中で pointer-events: none を当てるとドラッグ元が無効になり、
    // ブラウザがドラッグを即座に中断してしまう。1拍おいてから適用する。
    dragClassTimer = setTimeout(() => card.classList.add("dragging"), 0);
    e.dataTransfer.effectAllowed = "move";
    // Firefox はデータを設定しないとドラッグが始まらない
    e.dataTransfer.setData("text/plain", itemName(card) ?? "");
  });

  // 一部のブラウザは dragenter も止めないとドロップを受け付けない
  document.addEventListener("dragenter", (e) => {
    if (dragging) e.preventDefault();
  });

  document.addEventListener("dragover", (e) => {
    if (!dragging) return;
    const grid = dragging.parentElement;
    if (!grid) return;

    // drop を発生させるには dragover の既定動作を必ず止める必要がある。
    // 対象カードが無い位置（掴んでいるカードの上など）でも止めておく。
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const target = e.target.closest?.(".object-card");
    if (!target || target === dragging || target.parentElement !== grid) return;
    // 新規追加カードは常に先頭。その前後へは入れない
    if (target.classList.contains("add-card")) return;

    const rect = target.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    let reference = after ? target.nextElementSibling : target;

    // ゲームの起点より前へは入れない（起点自身をドラッグしている場合を除く）
    const entry = grid.querySelector(".object-card-entry");
    if (!draggingEntry && entry && reference === entry) {
      reference = entry.nextElementSibling;
    }

    // その場で並べ替えて、ドロップ後の姿を見せる
    if (reference !== dragging) {
      grid.insertBefore(dragging, reference);
    }
  });

  document.addEventListener("drop", (e) => {
    if (!dragging) return;
    e.preventDefault();

    const grid = dragging.parentElement;
    // 起点（gameMain）は常に先頭のため、ドロップしても元の位置へ戻す
    if (draggingEntry) {
      grid?.insertBefore(dragging, originalNext);
      endDrag();
      return;
    }

    if (grid) {
      window.arcadeerSetOrder?.(orderedNames(grid));
    }
    endDrag();
  });

  document.addEventListener("dragend", () => {
    // ドロップされずに終わった場合も元の位置へ戻す
    if (dragging && draggingEntry) {
      dragging.parentElement?.insertBefore(dragging, originalNext);
    }
    endDrag();
  });
}
