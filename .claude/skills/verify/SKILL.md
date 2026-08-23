---
name: verify
description: Arcadeer の検証をひととおり行う（Rustテスト・JavaScriptテスト・clippy・WASMビルド）。コミットやプッシュの前、変更が壊れていないかを確かめたい時に使う。gitpush スキルからも呼ばれる。
---

# verify

**このリポジトリ（Arcadeer）の検証手順。**npm ではなく **Rust + Bun** で構成されているため、
`npm test` は使えない。

## 実行するもの

上から順に実行し、**1つでも失敗したらそこで止めて内容を報告する**。

| # | コマンド | 期待する結果 |
| --- | --- | --- |
| 1 | `cargo test --lib` | 全通過 |
| 2 | `bun test` | 全通過 |
| 3 | `cargo clippy --all-targets -- -D warnings` | **警告0** |
| 4 | `wasm-pack build --target web --out-dir web/pkg` | 成功 |

- `bun` が PATH に無い場合は `~/.bun/bin/bun` を使う
- clippy は**警告を1つも残さない**（作業原則「Warningは全て解消する」）

## 報告

- 各項目の件数と結果を表でまとめる
- 失敗した場合は、**どこで何が起きたか**を具体的に伝える

## 補足

- テストは `tests/`（JavaScript）と各 `src/*.rs` の `mod tests`（Rust）にある
- 機能追加はテスト駆動で行う。**先にテストを書き、REDを確認してから実装する**
- `web/pkg` はビルド成果物。`.gitignore` 済みで、GitHub Actions 側でも生成される
