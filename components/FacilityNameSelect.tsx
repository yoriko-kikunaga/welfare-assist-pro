import React, { useState, useRef } from 'react';

interface FacilityNameSelectProps {
  value: string;
  options: string[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (v: string) => void;     // 値の即時変更（handleChange）
  onFocusValue?: () => void;         // 変更履歴のフォーカス検知（handleTrackedFocus）
  onBlurValue?: () => void;          // 変更履歴の離脱検知（handleTrackedBlur）
}

/**
 * 入居施設名の入力。
 * ・クリック／フォーカスすると候補を「全件」表示（既存値で絞り込まない）。
 * ・文字を打つと、その文字で候補を絞り込み（検索）。
 * ・候補をクリックで選択。候補に無い施設名はそのまま手入力で登録可。
 * テキスト入力のままなので、変更履歴（🕐）の onFocus/onBlur 検知も従来どおり動く。
 */
const FacilityNameSelect: React.FC<FacilityNameSelectProps> = ({
  value, options, disabled, placeholder, onChange, onFocusValue, onBlurValue,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');   // 絞り込み用（空＝全件）
  const inputRef = useRef<HTMLInputElement>(null);

  // 編集不可のときは通常の入力欄として表示
  if (disabled) {
    return (
      <input
        disabled
        value={value}
        placeholder={placeholder}
        className="w-full p-2 border rounded border-gray-300 bg-gray-50 text-gray-600 outline-none"
      />
    );
  }

  const q = query.trim();
  const filtered = q ? options.filter(o => o.includes(q)) : options;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { onFocusValue?.(); setQuery(''); setOpen(true); }}
        onBlur={() => { onBlurValue?.(); setOpen(false); }}
        className="w-full p-2 pr-9 border rounded border-gray-300 focus:ring-2 focus:ring-primary-500 outline-none"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="施設候補を開く"
        onMouseDown={(e) => { e.preventDefault(); inputRef.current?.focus(); setQuery(''); setOpen(o => !o); }}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary-600 text-xs"
      >▼</button>

      {open && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-400">該当なし（このまま手入力で登録できます）</li>
          ) : (
            filtered.map(opt => (
              <li key={opt}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onChange(opt); setQuery(''); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-50 ${
                    opt === value ? 'bg-primary-50 text-primary-700 font-bold' : 'text-gray-700'
                  }`}
                >{opt}</button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
};

export default FacilityNameSelect;
