# 期待される指摘

言い回しは問わず、同じ問題を指していれば「拾えた」と数えます。

| # | 指摘 | 観点 | 主な箇所 |
| --- | --- | --- | --- |
| 1 | 絞り込みで並びが変わるのに `key` に配列の添字を使っており、行の状態や DOM が別の選択肢に引き継がれる | 状態とライフサイクル | `src/OptionList.tsx` |
| 2 | `memo` した行に、毎回新しく作る `onToggle` と `style` を渡しているため、`memo` が効かず全行が再レンダリングされる | パフォーマンス | `src/OptionList.tsx` |
| 3 | 選択肢が数千件になる用途で、行ごとに `selected.includes` を呼び（件数×選択数）、仮想化もしていない | パフォーマンス | `src/OptionList.tsx` |
| 4 | API から来た `label` が null だと `toLowerCase()` で落ちる。型は string でも実行時には保証されない | 型と実行時の防御 | `src/OptionList.tsx` |
| 5 | 行が `<li onClick>` だけで、`role="option"`・`aria-selected`（または本物のチェックボックス）がなく、キーボードで選べない | アクセシビリティ | `src/OptionList.tsx` |
