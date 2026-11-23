import { useState } from "react";

type TextFieldProps = {
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  error?: string;
  required?: boolean;
};

export function TextField({ label, value, defaultValue = "", onChange, error, required }: TextFieldProps) {
  const [inner, setInner] = useState(value ?? defaultValue);

  return (
    <div className="text-field">
      <span className="text-field__label">
        {label}
        {required && <span className="text-field__required">（必須）</span>}
      </span>
      <input
        className="text-field__input"
        value={inner}
        onChange={(e) => {
          const next = label.includes("コード") ? e.target.value.toUpperCase() : e.target.value;
          setInner(next);
          onChange?.(next);
        }}
        style={{ borderColor: error ? "#D32F2F" : "#BDBDBD" }}
      />
      {error && <span className="text-field__error">{error}</span>}
    </div>
  );
}
