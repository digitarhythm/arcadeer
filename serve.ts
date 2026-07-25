import { file } from "bun";
import { join, extname, normalize } from "node:path";
import { existsSync, statSync } from "node:fs";

const ROOT = join(import.meta.dir, "web");
// 汎用の PORT は他アプリと衝突するため、Arcadeer 専用の ARCADEER_PORT を優先する（既定 3001）
const PORT = Number(process.env.ARCADEER_PORT ?? 3001);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";

    const safe = normalize(path).replace(/^(\.\.[\/])+/, "");
    const fsPath = join(ROOT, safe);

    if (!fsPath.startsWith(ROOT)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!existsSync(fsPath) || statSync(fsPath).isDirectory()) {
      return new Response("Not Found", { status: 404 });
    }

    const mime = MIME[extname(fsPath).toLowerCase()] ?? "application/octet-stream";
    return new Response(file(fsPath), {
      headers: {
        "content-type": mime,
        "cache-control": "no-cache",
      },
    });
  },
});

console.log(`Arcadeer dev server: http://localhost:${server.port}`);
