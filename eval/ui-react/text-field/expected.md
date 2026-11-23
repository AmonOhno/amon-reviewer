1. `src/TextField.tsx`：`value` を state にコピーしており、親が `value` を変えても反映されない（制御モードが壊れている）
2. `src/TextField.tsx`：ref を転送せず、`name`・`disabled`・`onBlur` などのネイティブ属性も渡せない
3. `src/TextField.tsx`：ラベル名に「コード」を含むと大文字にする、特定業務の処理が入っている
4. `src/TextField.tsx`：ラベルが input と関連付いておらず、エラーや必須も支援技術に伝わらない
5. `src/TextField.tsx`：「（必須）」の文言がハードコードされている
6. `src/TextField.test.tsx`：`querySelector` や見た目に依存し、制御モードの振る舞いを検証していない
