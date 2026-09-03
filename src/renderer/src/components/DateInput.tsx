// @ts-nocheck — ported from MDC DateInput.jsx
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '../lib/cn'

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @param {string | undefined} value
 * @returns {{ y: string, m: string, d: string }}
 */
function parseDateKey(value) {
  const match = DATE_KEY_RE.exec(String(value ?? ''));
  if (!match) return { y: '', m: '', d: '' };
  return { y: match[1], m: match[2], d: match[3] };
}

/**
 * @param {string} y
 * @param {string} m
 * @param {string} d
 */
function isValidDateParts(y, m, d) {
  if (y.length !== 4 || m.length !== 2 || d.length !== 2) return false;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
  );
}

/**
 * @param {string} key
 * @param {string | undefined} min
 * @param {string | undefined} max
 */
function clampDateKey(key, min, max) {
  if (min && DATE_KEY_RE.test(min) && key < min) return min;
  if (max && DATE_KEY_RE.test(max) && key > max) return max;
  return key;
}

/**
 * @param {string} raw
 * @param {number} maxLen
 */
function digitsOnly(raw, maxLen) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, maxLen);
}

type DateInputProps = {
  value?: string
  onChange?: (value: string) => void
  className?: string
  min?: string
  max?: string
  disabled?: boolean
  'aria-label'?: string
  id?: string
}

/**
 * YYYY-MM-DD date field with year → month → day auto-advance while typing,
 * plus a native calendar picker affordance.
 */
export default function DateInput({
  value = '',
  onChange,
  className,
  min,
  max,
  disabled = false,
  'aria-label': ariaLabel,
  id,
}: DateInputProps) {
  const autoId = useId();
  const rootId = id || autoId;
  const yearRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const monthRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const dayRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const pickerRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const focusedRef = useRef(false);

  const parsed = parseDateKey(value);
  const [year, setYear] = useState(parsed.y);
  const [month, setMonth] = useState(parsed.m);
  const [day, setDay] = useState(parsed.d);

  useEffect(() => {
    if (focusedRef.current) return;
    const next = parseDateKey(value);
    setYear(next.y);
    setMonth(next.m);
    setDay(next.d);
  }, [value]);

  const emitIfComplete = (y, m, d) => {
    if (!isValidDateParts(y, m, d)) return;
    const key = clampDateKey(`${y}-${m}-${d}`, min, max);
    if (key !== `${y}-${m}-${d}`) {
      const clamped = parseDateKey(key);
      setYear(clamped.y);
      setMonth(clamped.m);
      setDay(clamped.d);
    }
    if (key !== value) {
      onChange?.(key);
    }
  };

  const focusAndSelect = (ref) => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.select();
  };

  const onYearChange = (event) => {
    const next = digitsOnly(event.target.value, 4);
    setYear(next);
    if (next.length === 4) {
      focusAndSelect(monthRef);
    }
    emitIfComplete(next, month, day);
  };

  const onMonthChange = (event) => {
    const next = digitsOnly(event.target.value, 2);
    setMonth(next);
    if (next.length === 2) {
      focusAndSelect(dayRef);
    }
    emitIfComplete(year, next, day);
  };

  const onDayChange = (event) => {
    const next = digitsOnly(event.target.value, 2);
    setDay(next);
    emitIfComplete(year, month, next);
  };

  const onSegmentKeyDown = (segment, event) => {
    if (event.key !== 'Backspace') return;
    const target = /** @type {HTMLInputElement} */ (event.currentTarget);
    if (target.value.length > 0 || target.selectionStart !== 0) return;

    event.preventDefault();
    if (segment === 'month') {
      focusAndSelect(yearRef);
      setYear((prev) => prev.slice(0, -1));
    } else if (segment === 'day') {
      focusAndSelect(monthRef);
      setMonth((prev) => prev.slice(0, -1));
    }
  };

  const onPaste = (event) => {
    const text = event.clipboardData?.getData('text') ?? '';
    const digits = digitsOnly(text, 8);
    if (digits.length < 4) return;

    event.preventDefault();
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const d = digits.slice(6, 8);
    setYear(y);
    setMonth(m);
    setDay(d);
    if (d.length === 2) {
      emitIfComplete(y, m, d);
      dayRef.current?.focus();
    } else if (m.length === 2) {
      focusAndSelect(dayRef);
    } else if (y.length === 4) {
      focusAndSelect(monthRef);
    }
  };

  const padOnBlur = () => {
    window.setTimeout(() => {
      const root = document.getElementById(rootId);
      if (root?.contains(document.activeElement)) return;
      focusedRef.current = false;

      let y = year;
      let m = month;
      let d = day;
      if (m.length === 1) m = m.padStart(2, '0');
      if (d.length === 1) d = d.padStart(2, '0');
      if (m !== month) setMonth(m);
      if (d !== day) setDay(d);

      if (isValidDateParts(y, m, d)) {
        emitIfComplete(y, m, d);
        return;
      }

      // Incomplete / invalid edit — restore last committed value.
      const restored = parseDateKey(value);
      setYear(restored.y);
      setMonth(restored.m);
      setDay(restored.d);
    }, 0);
  };

  const openPicker = () => {
    const picker = pickerRef.current;
    if (!picker || disabled) return;
    try {
      if (typeof picker.showPicker === 'function') {
        picker.showPicker();
      } else {
        picker.focus();
        picker.click();
      }
    } catch {
      picker.focus();
    }
  };

  const segmentClass =
    'shrink-0 border-0 bg-transparent p-0 text-center tabular-nums tracking-normal text-inherit outline-none placeholder:text-gcal-muted';

  return (
    <div
      id={rootId}
      className={cn(
        // Content-sized: no fixed min-width (that left empty space after the calendar icon).
        'relative inline-flex w-fit max-w-full items-center gap-0.5 pl-2 pr-1',
        className,
      )}
      role="group"
      aria-label={ariaLabel}
      onFocusCapture={() => {
        focusedRef.current = true;
      }}
      onBlurCapture={padOnBlur}
    >
      <input
        ref={yearRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        maxLength={4}
        placeholder="YYYY"
        size={4}
        aria-label={ariaLabel ? `${ariaLabel} 연도` : '연도'}
        className={cn(segmentClass, 'w-[4.75ch]')}
        value={year}
        onChange={onYearChange}
        onKeyDown={(event) => onSegmentKeyDown('year', event)}
        onPaste={onPaste}
      />
      <span className="select-none text-gcal-muted" aria-hidden="true">-</span>
      <input
        ref={monthRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        maxLength={2}
        placeholder="MM"
        size={2}
        aria-label={ariaLabel ? `${ariaLabel} 월` : '월'}
        className={cn(segmentClass, 'w-[2.75ch]')}
        value={month}
        onChange={onMonthChange}
        onKeyDown={(event) => onSegmentKeyDown('month', event)}
        onPaste={onPaste}
      />
      <span className="select-none text-gcal-muted" aria-hidden="true">-</span>
      <input
        ref={dayRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        maxLength={2}
        placeholder="DD"
        size={2}
        aria-label={ariaLabel ? `${ariaLabel} 일` : '일'}
        className={cn(segmentClass, 'w-[2.75ch]')}
        value={day}
        onChange={onDayChange}
        onKeyDown={(event) => onSegmentKeyDown('day', event)}
        onPaste={onPaste}
      />

      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gcal-muted transition-colors hover:bg-gcal-surface-2 hover:text-gcal-heading disabled:opacity-40"
        aria-label={ariaLabel ? `${ariaLabel} 달력에서 선택` : '달력에서 선택'}
        title="달력에서 선택"
        onClick={openPicker}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"
          />
        </svg>
      </button>

      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        disabled={disabled}
        min={min}
        max={max}
        value={DATE_KEY_RE.test(value) ? value : ''}
        aria-hidden="true"
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        onChange={(event) => {
          const next = event.target.value;
          if (!next) return;
          const parts = parseDateKey(next);
          setYear(parts.y);
          setMonth(parts.m);
          setDay(parts.d);
          onChange?.(clampDateKey(next, min, max));
        }}
      />
    </div>
  );
}
