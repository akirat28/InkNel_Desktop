import {
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';

interface Props {
  /** 現在値（0〜4 文字）。常に数字のみ */
  value: string;
  /** 値が変わった時に呼ばれる */
  onChange: (next: string) => void;
  /** 4 文字すべて埋まった瞬間に呼ばれる（Enter での確定処理に使う） */
  onComplete?: (value: string) => void;
  /** Enter キー押下時のコールバック */
  onEnter?: () => void;
  /** マウント時に最初のボックスへフォーカス */
  autoFocus?: boolean;
  /** 全体のラベル */
  ariaLabel?: string;
  /** 1 つ目の input の id（label の htmlFor と紐付ける） */
  id?: string;
}

export interface PinInputHandle {
  /** 最初のボックスにフォーカス */
  focus(): void;
  /** 全ボックスをクリア + 最初のボックスにフォーカス */
  reset(): void;
}

const LENGTH = 4;

/**
 * 4 桁数字パスワード用の 1 文字 × 4 ボックス入力。
 *
 * - 数字以外は無視
 * - 入力するたびに次のボックスへ自動でフォーカス遷移
 * - Backspace は現在のボックスをクリア（既に空なら前のボックスへ戻る）
 * - 左右矢印でボックス間を移動
 * - 4 桁のペーストにも対応（最初のボックスで ⌘V するとすべて埋まる）
 * - type="password" でマスク表示
 */
const PinInput = forwardRef<PinInputHandle, Props>(function PinInput(
  { value, onChange, onComplete, onEnter, autoFocus, ariaLabel, id },
  ref,
) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        inputsRef.current[0]?.focus();
        inputsRef.current[0]?.select();
      },
      reset() {
        onChange('');
        // 描画後に最初のボックスへフォーカス
        setTimeout(() => {
          inputsRef.current[0]?.focus();
        }, 0);
      },
    }),
    [onChange],
  );

  useEffect(() => {
    if (autoFocus) {
      inputsRef.current[0]?.focus();
    }
  }, [autoFocus]);

  // value 配列を 4 要素に正規化（不足は空文字埋め）
  const chars: string[] = [];
  for (let i = 0; i < LENGTH; i++) chars.push(value[i] ?? '');

  const focusBox = (idx: number) => {
    const el = inputsRef.current[idx];
    if (el) {
      el.focus();
      el.select();
    }
  };

  const updateAt = (idx: number, ch: string) => {
    // 数字以外を弾く
    const digit = ch.replace(/\D/g, '');
    if (digit.length === 0) {
      // 空入力 = 削除
      const next = value.split('');
      next[idx] = '';
      // 末尾の空文字を削るのではなく、その位置だけクリア
      const merged = next.join('').slice(0, idx) + next.slice(idx + 1).join('');
      // 上記は複雑になるので、シンプルに「該当桁だけ ' ' に置き換えてから空文字フィルタ」
      const arr = chars.slice();
      arr[idx] = '';
      onChange(arr.join(''));
      return;
    }
    // 1 文字だけ取り出して該当桁にセット
    const arr = chars.slice();
    arr[idx] = digit[0];
    const merged = arr.join('');
    onChange(merged);
    // 次のボックスへ移動
    if (idx < LENGTH - 1) {
      focusBox(idx + 1);
    }
    // 完了
    if (merged.length === LENGTH && merged.replace(/\D/g, '').length === LENGTH) {
      onComplete?.(merged);
    }
  };

  const handleChange = (
    idx: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const raw = e.target.value;
    if (raw.length === 0) {
      // 削除（既存値は保持して updateAt に空を渡す）
      const arr = chars.slice();
      arr[idx] = '';
      onChange(arr.join(''));
      return;
    }
    // 複数文字入力（IME 等）の場合は最後の数字を採用
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 0) return;
    // 4 桁ペースト対応: 元の値が空で、4 桁全部入ってきた場合
    if (digits.length >= LENGTH && idx === 0) {
      const merged = digits.slice(0, LENGTH);
      onChange(merged);
      focusBox(LENGTH - 1);
      onComplete?.(merged);
      return;
    }
    updateAt(idx, digits[digits.length - 1]);
  };

  const handleKeyDown = (
    idx: number,
    e: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
      return;
    }
    if (e.key === 'Backspace') {
      const cur = chars[idx];
      if (cur) {
        // 現在のボックスをクリア（フォーカスはそのまま）
        const arr = chars.slice();
        arr[idx] = '';
        onChange(arr.join(''));
      } else if (idx > 0) {
        // 既に空なら前のボックスへ戻り、そこをクリア
        const arr = chars.slice();
        arr[idx - 1] = '';
        onChange(arr.join(''));
        focusBox(idx - 1);
      }
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      focusBox(idx - 1);
      return;
    }
    if (e.key === 'ArrowRight' && idx < LENGTH - 1) {
      e.preventDefault();
      focusBox(idx + 1);
      return;
    }
  };

  const handlePaste = (idx: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    const digits = text.replace(/\D/g, '');
    if (digits.length === 0) return;
    e.preventDefault();
    // ペースト位置から埋める
    const arr = chars.slice();
    let pos = idx;
    for (const d of digits) {
      if (pos >= LENGTH) break;
      arr[pos] = d;
      pos++;
    }
    const merged = arr.join('');
    onChange(merged);
    focusBox(Math.min(pos, LENGTH - 1));
    if (merged.length === LENGTH && merged.replace(/\D/g, '').length === LENGTH) {
      onComplete?.(merged);
    }
  };

  return (
    <div className="pin-input" role="group" aria-label={ariaLabel}>
      {chars.map((c, i) => (
        <input
          key={i}
          id={i === 0 ? id : undefined}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          className="pin-input__box"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={1}
          value={c}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={`${ariaLabel ?? 'パスワード'} ${i + 1} 桁目`}
        />
      ))}
    </div>
  );
});

export default PinInput;
