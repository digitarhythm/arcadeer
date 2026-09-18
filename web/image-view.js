// 画像の詳細表示（仕様書4.4節）
//
// 左ペインの画像タブで画像を選ぶと、メイン部に
//
// - ファイル名と大きさ
// - 市松模様の上に、**ドットをにじませず**拡大した画像
// - 「コマの一辺」を入れると、コマの区切り線と番号（2Dの `size` と `pattern` を書く時の確認用）
//
// を表示する。3Dモデルの詳細表示（model-view.js）と同じ場所に、同じ作法で出す。

import { t } from "./i18n.js";
import { cellRect } from "./sprite.js";

/** 拡大の段階。ドット絵が巨大になりすぎないよう、上限は 8 倍 */
export const ZOOM_STEPS = Object.freeze([1, 2, 3, 4, 6, 8]);

/** 区切りの数の上限。小さすぎる値で固まらないため */
const MAX_CELLS = 4096;

/** 正の有限数か */
function positive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 表示倍率を決める
 *
 * 収まる範囲で `ZOOM_STEPS` の整数倍に拡大する（段階に無い倍率は下の段階へ落とす）。
 * 収まらない大きな画像は 1 未満に縮めて全体を見せる。大きさが取れなければ等倍。
 */
export function fitZoom(width, height, availWidth, availHeight) {
  if (!positive(width) || !positive(height) || !positive(availWidth) || !positive(availHeight)) {
    return 1;
  }
  const max = Math.min(availWidth / width, availHeight / height);
  if (max < 1) return max;
  let zoom = 1;
  for (const step of ZOOM_STEPS) {
    if (step <= max) zoom = step;
  }
  return zoom;
}

/**
 * コマの区切り（左上から番号付き）
 *
 * `sprite.js` と同じ数え方。端数は区切らず、大きさが無い・画像より大きい値は空。
 *
 * @returns `[{ index, x, y }]`
 */
export function cellGrid(width, height, size) {
  if (!positive(size) || !positive(width) || !positive(height)) return [];
  const columns = Math.floor(width / size);
  const rows = Math.floor(height / size);
  const count = Math.min(columns * rows, MAX_CELLS);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const rect = cellRect(index, size, width, height);
    if (!rect) break;
    out.push({ index, x: rect.x, y: rect.y });
  }
  return out;
}

/**
 * 大きさの表示
 *
 * コマの大きさを添えると「何列 × 何段 = 何コマ」も出す。区切れない時は出さない。
 */
export function sizeLabel(width, height, size = 0) {
  const base = `${width} × ${height} px`;
  if (!positive(size)) return base;
  const columns = Math.floor(width / size);
  const rows = Math.floor(height / size);
  if (columns < 1 || rows < 1) return base;
  return `${base}（${size} px × ${columns} × ${rows} = ${columns * rows}）`;
}

/** 画像を読み込む（失敗したら null） */
function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** 区切り線と番号を、画像と同じ大きさのキャンバスへ描く */
function drawGrid(canvas, image, size, zoom) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cells = cellGrid(image.naturalWidth, image.naturalHeight, size);
  if (cells.length === 0) return;

  const side = size * zoom;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 96, 96, 0.9)";
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.font = `${Math.max(10, Math.min(14, side / 3))}px sans-serif`;
  ctx.textBaseline = "top";
  for (const cell of cells) {
    const x = cell.x * zoom;
    const y = cell.y * zoom;
    ctx.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1);
    const label = String(cell.index);
    const width = ctx.measureText(label).width + 6;
    ctx.fillRect(x + 1, y + 1, width, 15);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + 4, y + 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  }
}

/**
 * 画像の詳細表示をメイン部へ出す
 *
 * @param fileName 表示する名前
 * @param url 画像の URL（object URL）
 * @param initialSize 「スプライトサイズ」の初期値（ゲームコードで指定している size。無ければ 0）
 */
export async function showImageView(fileName, url, initialSize = 0) {
  const main = document.getElementById("ide-content");
  if (!main) return;

  main.innerHTML = `
    <div class="modelview-pane imageview-pane">
      <div class="modelview-header">
        <span class="modelview-title" id="imageview-title"></span>
        <span class="modelview-note" id="imageview-size"></span>
        <label class="imageview-cell">
          <span id="imageview-cell-label"></span>
          <input type="number" min="0" step="1" id="imageview-cell-size">
        </label>
      </div>
      <div class="modelview-body imageview-body" id="imageview-body"></div>
    </div>
  `;
  document.getElementById("imageview-title").textContent = fileName;
  document.getElementById("imageview-cell-label").textContent = t("imageView.cellSize");
  document.getElementById("imageview-cell-size").value =
    String(Number.isInteger(initialSize) && initialSize > 0 ? initialSize : 0);
  const body = document.getElementById("imageview-body");
  const sizeNote = document.getElementById("imageview-size");

  const image = await loadImage(url);
  // 読み込みを待つ間に別の画面へ切り替わっていたら、何もしない
  if (!image || !document.body.contains(body)) {
    if (!image) sizeNote.textContent = t("imageView.unreadable");
    return;
  }

  const stage = document.createElement("div");
  stage.className = "imageview-stage";
  const picture = document.createElement("img");
  picture.className = "imageview-picture";
  picture.src = url;
  picture.alt = fileName;
  const grid = document.createElement("canvas");
  grid.className = "imageview-grid";
  stage.appendChild(picture);
  stage.appendChild(grid);
  body.appendChild(stage);

  const input = document.getElementById("imageview-cell-size");
  const layout = () => {
    // ヘッダーと余白を除いた、使える広さ
    const zoom = fitZoom(
      image.naturalWidth,
      image.naturalHeight,
      Math.max(body.clientWidth - 40, 1),
      Math.max(body.clientHeight - 40, 1),
    );
    const width = Math.round(image.naturalWidth * zoom);
    const height = Math.round(image.naturalHeight * zoom);
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    grid.width = width;
    grid.height = height;
    const size = Math.floor(Number(input.value));
    sizeNote.textContent = `${sizeLabel(image.naturalWidth, image.naturalHeight, size)}  ×${
      zoom >= 1 ? zoom : zoom.toFixed(2)
    }`;
    drawGrid(grid, image, size, zoom);
  };
  input.addEventListener("input", layout);
  window.addEventListener("resize", layout);
  layout();
}

if (typeof window !== "undefined") {
  window.arcadeerShowImageView = showImageView;
}
