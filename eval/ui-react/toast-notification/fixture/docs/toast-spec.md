# トースト通知 仕様

画面の右上に、一定時間で自動的に消える通知を表示する。

## 使い方

- アプリのルートに `<Toaster />` を1つ置く
- 画面のどこからでも `toast({ message, variant })` で通知を出せる

## 表示

- `variant` は `info` / `success` / `warning` / `error` の4種類。既定は `info`
- 背景色は MessagePanel の variant 色に揃える。文字色は白
    - info `#1E88E5` / success `#00B19D` / warning `#F4B142` / error `#E91E63`
- `error` はすぐに読み上げ、それ以外は落ち着いたタイミングで読み上げる

## 表示・消去の固定動作

- 通知は `duration` ミリ秒後に消える。既定値は `<Toaster defaultDuration>`（既定 5000）
- `<Toaster defaultDuration>` に不正な値が渡された場合は 5000 を使う
- 通知ごとの `width` が不正な場合は、`<Toaster defaultWidth>`（既定 360）を使う
- 通知の最大幅は、`<Toaster />` を置いた親要素の幅に合わせる

## ホスト未マウント時

- `<Toaster />` がマウントされていないときに呼ばれた `toast()` は破棄する
