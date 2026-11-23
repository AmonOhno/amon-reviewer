# 期待される指摘

言い回しは問わず、同じ問題を指していれば「拾えた」と数えます。

| # | 指摘 | 観点 | 主な箇所 |
| --- | --- | --- | --- |
| 1 | `value` を初期値として state にコピーしており、親が `value` を変えても反映されない（制御モードが壊れている） | API設計／状態 | `src/TextField.tsx` |
| 2 | ref を転送しておらず、`name`・`disabled`・`onBlur` などのネイティブ属性も渡せないため、フォームライブラリと組み合わせられない | API設計 | `src/TextField.tsx` |
| 3 | ラベル名に「コード」を含むと大文字に変換する、特定業務の都合が共通部品に入っている | 拡張性 | `src/TextField.tsx` |
| 4 | ラベルが `<span>` で input と関連付いていない。エラーが `aria-describedby`・`aria-invalid` で伝わらず、必須も `aria-required` などで伝わらない | アクセシビリティ | `src/TextField.tsx` |
| 5 | 「（必須）」の文言がハードコードされている | 国際化 | `src/TextField.tsx` |
| 6 | テストが `querySelector` と内部の見た目に依存しており、制御モードの振る舞いを検証していない | テスト | `src/TextField.test.tsx` |
