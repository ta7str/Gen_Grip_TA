# Finger Mod

SO-101 用のグリッパーフィンガーをブラウザで設計し、**STEP** と **STL** で書き出す静的Webアプリです。
サーバーは不要で、GitHub Pages だけで動きます。形状は OpenCascade（WebAssembly）で生成するため、
STEP は円や平面を保ったソリッド（B-rep）として出力されます。データはどこにも送信されません。

## GitHub Pages で公開する

1. GitHub で新しいリポジトリを作り、このフォルダの中身をそのままアップロード（または push）します。
   `js/` の中のビルド済みファイル（`app.js` / `cad-worker.js` / `replicad_single.wasm`）も含めてください。
2. リポジトリの **Settings → Pages** を開き、**Source: Deploy from a branch**、
   **Branch: `main` / `(root)`** を選んで Save します。
3. 1〜2分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で開けます。

初回アクセスだけ CAD エンジン（約 23 MB、転送時は圧縮）を読み込みます。2回目以降はブラウザのキャッシュが使われます。

## ローカルで試す

`file://` では Worker と WebAssembly が動かないため、簡易サーバーを使います。

```
python3 -m http.server 8080
# → http://localhost:8080
```

## 形状を変える

| 変えたいもの | 場所 |
| --- | --- |
| スライダーの項目・範囲・初期値・テンプレート | `src/params.js` |
| 指の形（断面、溝、穴、丸め） | `src/finger.js` |
| 画面まわり | `index.html`, `css/style.css`, `src/main.js`, `src/i18n.js` |

`src/` を編集したら、次でビルドし直して `js/` をコミットします。

```
npm install
npm run build
```

## ファイル構成

```
index.html            画面
css/style.css
src/                  ソース（編集する場所）
js/                   ビルド済み（Pages が配信する）
  app.js              UI + three.js プレビュー
  cad-worker.js       形状生成・STEP/STL 出力（Web Worker）
  replicad_single.wasm
build.mjs             esbuild によるビルドスクリプト
```

## 構造の種類

- **ソリッド**: 中実の指（フラット、リブ付き、フック、ニードル、ワイド）。
- **フィンレイ**: 背骨・外側のカーブ・傾いたリブでできた、たわむ指。リブの本数・厚み・傾き、皮膜と背骨の厚み、マウント部の長さを調整できます。

## 注意

- 指の寸法（取り付け穴の径・間隔・位置、根元の厚みなど）は汎用の初期値です。
  実機の SO-101 ジョーやマウントに合わせて、必ず実測で調整してください。
- マウント（`SO101_soft_fin.stl`）は XLeRobot のパーツで、このアプリでは作りません。
- ライセンス: replicad（MIT）、three.js（MIT）、replicad-opencascadejs（OpenCascade、LGPL-2.1）。
