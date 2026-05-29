# storage-demo

ブラウザ標準の3つのストレージAPI (**Web Storage / IndexedDB / OPFS**) の使い分けを学ぶための、簡易ペイントツールのデモアプリです。

**デモページ**: <https://ics-creative.github.io/260601_storage_api/>

UI部分は React で実装していますが、本題であるストレージまわりは **React に依存しないピュアな TypeScript** で書いてあるので、`src/storage/` の各ファイルだけを読めば API の使い方が追えるようになっています。

## ストレージの役割分担

ペイントアプリで扱う3種類のデータを、それぞれに適したAPIへ振り分けています。

| データ                    | 特性                                           | 採用API                        |
| ------------------------- | ---------------------------------------------- | ------------------------------ |
| 設定 (色・ブラシ太さなど) | 小さな key-value、同期で読めると楽             | **Web Storage (localStorage)** |
| 操作ログ (Undo/Redo履歴)  | レコード単位で追記・範囲取得したい構造化データ | **IndexedDB**                  |
| レイヤーのビットマップ    | 大きなバイナリをそのまま保存したい             | **OPFS**                       |

## 各モジュールの紹介

### [src/storage/settings.ts](src/storage/settings.ts) — Web Storage

`localStorage` を使った設定値の永続化。同期APIで扱いが手軽な代わりに、文字列しか保存できず容量も5MB程度。本デモではブラシ色や太さなどの小さなオブジェクトを `JSON.stringify` して保存しています。

### [src/storage/history.ts](src/storage/history.ts) — IndexedDB

操作ログ (描画ストローク・レイヤー追加など) と Undo/Redo カーソルを保持します。`log` ストアは `autoIncrement` で seq を自動採番し、`cursor` ストアで現在の head 位置を管理。`IDBKeyRange` を使った範囲削除・範囲取得や、`onversionchange` を絡めた `deleteDatabase` の作法など、IndexedDB の素のAPIを Promise 化しつつ一通り触っています。

### [src/storage/snapshot.ts](src/storage/snapshot.ts) — OPFS

各レイヤーの RGBA バイト列を `deflate-raw` で圧縮し、`layers/{layerId}.bin` として保存します。`navigator.storage.getDirectory()` から `FileSystemDirectoryHandle` を辿り、`createWritable()` で書き込み、`AsyncIterable` でディレクトリを列挙、といった OPFS / File System Access API の基本操作をまとめて確認できます。

## 開発コマンド

```bash
npm install
npm run dev        # 開発サーバ
npm run build      # 型チェック + 本番ビルド
npm run lint       # oxlint
npm run format     # oxfmt
```
