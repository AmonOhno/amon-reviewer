import { memo, type CSSProperties } from "react";

export type Option = {
  value: string;
  /** API から取得した表示名 */
  label: string;
};

type OptionListProps = {
  /** 取引先などのマスタ。数千件になることがある */
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  filter?: string;
};

export function OptionList({ options, selected, onToggle, filter = "" }: OptionListProps) {
  const keyword = filter.toLowerCase();
  const visible = options.filter((option) => option.label.toLowerCase().includes(keyword));

  return (
    <ul className="option-list">
      {visible.map((option, i) => (
        <OptionRow
          key={i}
          option={option}
          checked={selected.includes(option.value)}
          onToggle={() => onToggle(option.value)}
          style={{ padding: "4px 8px" }}
        />
      ))}
    </ul>
  );
}

type OptionRowProps = {
  option: Option;
  checked: boolean;
  onToggle: () => void;
  style: CSSProperties;
};

const OptionRow = memo(function OptionRow({ option, checked, onToggle, style }: OptionRowProps) {
  return (
    <li className={checked ? "option-list__row is-checked" : "option-list__row"} style={style} onClick={onToggle}>
      <span className="option-list__check">{checked ? "✓" : ""}</span>
      {option.label}
    </li>
  );
});
