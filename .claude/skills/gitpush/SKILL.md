---
name: gitpush
description: コミットして origin/main とタグへプッシュする。package.json のバージョンを stay（据え置き）／patch（第3オクテット）／minor（第2オクテット）で扱う。「gitpush」「gitpush stay」「gitpush patch」「gitpush minor」と指示された時に使う。
---

# gitpush

コミットし、`package.json` のバージョンをタグにして `origin/main` とタグをプッシュする。

**このスキルが呼ばれた時だけ、バージョンを上げてよい。**それ以外の場面で
バージョンを変更してはいけない。

## 引数

| 指示 | バージョンの扱い |
| --- | --- |
| `gitpush stay` | **上げない**（今の値をそのままタグにする） |
| `gitpush patch` | 第3オクテットを +1（`0.1.0` → `0.1.1`） |
| `gitpush minor` | 第2オクテットを +1、**第3オクテットを 0 に戻す**（`0.1.3` → `0.2.0`） |
| 引数なし | **作業者に stay / patch / minor のどれかを確認する。勝手に決めない** |

第1オクテット（メジャー）は、このスキルでは扱わない。

## 手順

1. **状態を確かめる**
   - `git status --short` で変更を確認する
   - `git remote -v` で `origin` を確認する
   - 変更が何も無ければ、その旨を伝えて終わる（空コミットは作らない）

2. **検証する**（失敗したらプッシュせず、内容を伝えて止まる）
   - `cargo test --lib`
   - `bun test`
   - `cargo clippy --all-targets -- -D warnings`（警告0であること）

3. **バージョンを決める**
   - `package.json` の `version` を読む
   - 引数に従って上げる。`stay` なら変更しない
   - 上げた場合は `package.json` を書き換える
   - `Cargo.toml` の `version` も同じ値にそろえる

4. **タグの重複を確かめる**
   - `git tag -l "v<バージョン>"` で確認する
   - 既にあれば**プッシュせず**、作業者へ知らせて指示を仰ぐ
     （`stay` で2回続けて呼ばれた場合に起きる）

5. **コミットする**
   - `git add -A`
   - コミットメッセージは**日本語**で、その回の変更内容がわかる要約にする
   - 末尾に次の行を入れる

     ```
     Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
     ```

6. **タグを付ける**
   - `git tag -a "v<バージョン>" -m "v<バージョン>"`（注釈付きタグ）

7. **プッシュする**
   - `git push origin main`
   - `git push origin "v<バージョン>"`

8. **報告する**
   - 版・タグ名・コミットの要約・プッシュ先を伝える
   - `say` コマンドで完了を知らせる

## 注意

- **このスキルが呼ばれていない限り、git 操作もバージョン変更も行わない**
- 検証が通らないうちはプッシュしない
- `web/pkg`（ビルド成果物）は `.gitignore` 済み。GitHub Actions 側でビルドされる
- ファイルの削除を伴う場合は、その都度2重の確認を行う
