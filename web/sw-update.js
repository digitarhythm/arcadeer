// Service Worker の登録と、新しい版の見張り（仕様書2.2節）
//
// 更新したはずの内容が届かず、遊ぶ人にサイトデータの消去を求める――
// という事態を避けるための仕組み。
//
// 画面に依存しないため単体テストできる。

/**
 * Service Worker を登録し、新しい版が動き出したら知らせる
 *
 * @param sw `navigator.serviceWorker`（対応していない環境では undefined）
 * @param onUpdate 新しい版が動き出した時に呼ぶ
 * @returns 登録。登録できなかった場合は null
 */
export async function registerServiceWorker(sw, onUpdate) {
  if (!sw || typeof sw.register !== "function") return null;

  // 登録より**先に**控える。初めての登録でも controllerchange は起きるため、
  // それを「更新された」と取り違えないようにする
  const hadController = !!sw.controller;

  let registration = null;
  try {
    // 本体は**HTTPキャッシュを通さない**。古い中身が返ると、
    // 更新したこと自体に気付けない
    registration = await sw.register("./service-worker.js", { updateViaCache: "none" });
  } catch {
    // 登録できなくても、ツールもゲームもそのまま動く
    return null;
  }

  try {
    // 開いた時点で更新を確かめる
    await registration.update?.();
  } catch {
    // オフラインでは確かめられない。次に繋がった時でよい
  }

  if (typeof sw.addEventListener === "function") {
    sw.addEventListener("controllerchange", () => {
      if (!hadController) return;
      // 既に読み込み終えた JS や WASM は古いままなので、
      // **勝手に読み込み直さず**、操作する人に委ねる
      // （編集中のコードが飛ぶのを避けるため）
      onUpdate?.();
    });
  }

  return registration;
}
