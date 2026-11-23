1. `src/OptionList.tsx`：絞り込みで並びが変わるのに `key` に添字を使っている
2. `src/OptionList.tsx`：毎回新しい `onToggle` と `style` を渡しており、`memo` が効かない
3. `src/OptionList.tsx`：数千件の用途で、行ごとに `selected.includes` を呼び、仮想化もしていない
4. `src/OptionList.tsx`：`label` が null だと `toLowerCase()` で落ちる
5. `src/OptionList.tsx`：行が `<li onClick>` だけで、選択状態が支援技術に伝わらず、キーボードで選べない
