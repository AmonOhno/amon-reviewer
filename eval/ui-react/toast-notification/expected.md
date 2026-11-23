# 期待される指摘

このケースで拾ってほしい指摘は次の5件です。言い回しは問わず、同じ問題を指していれば「拾えた」と数えます。

| # | 指摘 | 観点 | 主な箇所 |
| --- | --- | --- | --- |
| 1 | マウント直後に出した通知が消える | ライフサイクル・実行順序 | `src/toast/Toaster.tsx`（購読）、`src/toast/toastStore.ts`（破棄） |
| 2 | 白文字のコントラストが不足している | アクセシビリティ（視覚） | `src/toast/Toaster.tsx`（色） |
| 3 | スクリーンリーダーで読み上げられない可能性がある | アクセシビリティ（支援技術） | `src/toast/Toaster.tsx`（role） |
| 4 | スクロールのたびに重い処理が走る | パフォーマンス | `src/toast/Toaster.tsx`（scroll） |
| 5 | 不正な duration の扱いが他の項目と食い違っている／テストが実時間に依存している | 不正値の一貫性・テスト | `src/toast/toastStore.ts`、`src/toast/Toaster.test.tsx` |

## 各指摘の中身

1. `subscribeToast` を `useEffect` で登録している。effect は子が先・兄弟は並び順に実行されるため、`<App><Routes/><Toaster/></App>` の配置では、ページが自分の `useEffect` で出した通知が、ホストの購読前に `listeners.size === 0` で黙って捨てられる。対策は購読を `useLayoutEffect` に移すこと。移さない場合も、仕様書の「ホスト未マウント時は破棄」にこの落とし穴を明記する。
2. 白文字（`#FFFFFF`）に対し、warning `#F4B142` は約 1.9:1、success `#00B19D` は約 2.7:1、error `#E91E63` は約 4.3:1 で、14px の通常テキストに必要な 4.5:1 を満たさない。少なくとも warning は暗い文字色にする。
3. `role="status"` / `role="alert"` を、新しく挿入する各通知の要素自体に付けている。中身ごと DOM に追加された live region は読み上げられないことがある。空の live region（polite と assertive）を常に置き、その中に通知を追加する。
4. `window.addEventListener("scroll", update, true)` はキャプチャで登録しているため、ページ内のどの要素のスクロールでも毎回 `getBoundingClientRect()` と `setBoundsWidth` が走る。`requestAnimationFrame` で間引き、通知が0件のときは何もしない。
5. 通知ごとの `width` が不正なときはホストの既定値に戻るが、`duration` が不正なときは固定の `5000` に戻る。方針を揃えて仕様書にも反映する（仕様書は通知ごとの `duration` の不正値に触れていない）。また、テストが `sleep(5100)` で実時間を待っており遅く不安定なので、`node:test` の `mock.timers` に置き換える。
