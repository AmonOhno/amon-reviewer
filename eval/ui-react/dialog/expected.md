1. `src/Dialog.tsx`：effect にクリーンアップがなく、keydown リスナーと `body` の `overflow` が残る。依存配列に `onClose` がない
2. `src/Dialog.tsx`：`role="dialog"`・`aria-modal`・タイトルとの関連付けがない
3. `src/Dialog.tsx`：開いたときにフォーカスが移らず、閉じ込めもなく、閉じたあと元に戻らない
4. `src/Dialog.tsx`：閉じるボタンが `<div>` でキーボード操作できず、名前もない。既存の `Button` を使っていない
5. `src/Dialog.test.tsx`：Esc や背景クリックで閉じる振る舞いを検証していない
