1. `src/toast/Toaster.tsx`：購読が `useEffect` のため、兄弟コンポーネントがマウント直後に出した通知が黙って捨てられる
2. `src/toast/Toaster.tsx`：白文字と背景色（特に warning）のコントラストが不足している
3. `src/toast/Toaster.tsx`：通知の要素ごとに role を付けて挿入しており、読み上げられないことがある
4. `src/toast/Toaster.tsx`：キャプチャで登録した scroll のたびに `getBoundingClientRect()` と state 更新が走る
5. `src/toast/toastStore.ts`：不正な `duration` は固定の 5000、不正な `width` はホストの既定値と、扱いが揃っておらず仕様書にもない
6. `src/toast/Toaster.test.tsx`：`sleep(5100)` など実時間の待機に依存している
