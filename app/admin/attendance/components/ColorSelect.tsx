'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type SelectColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'emerald'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'cream'
  | 'brown';

export interface ColorSelectOption {
  value: string;
  label: string;
  color?: SelectColor;
  /** Optional second-row label, e.g. owner email. */
  hint?: string;
}

interface ColorTokens {
  /** Solid swatch fill — used in dropdown rows. */
  swatch: string;
  /** Filled pill bg + text used when this option is selected on the trigger. */
  pill: string;
  /** Just the text color — used for option labels in the menu. */
  text: string;
}

const COLOR_TOKENS: Record<SelectColor, ColorTokens> = {
  red:     { swatch: 'bg-red-500',       pill: 'bg-red-500/20 text-red-300',         text: 'text-red-300' },
  orange:  { swatch: 'bg-orange-500',    pill: 'bg-orange-500/20 text-orange-300',   text: 'text-orange-300' },
  yellow:  { swatch: 'bg-yellow-500',    pill: 'bg-yellow-500/25 text-yellow-300',   text: 'text-yellow-300' },
  green:   { swatch: 'bg-green-500',     pill: 'bg-green-500/20 text-green-400',     text: 'text-green-400' },
  emerald: { swatch: 'bg-emerald-400',   pill: 'bg-emerald-500/20 text-emerald-300', text: 'text-emerald-300' },
  blue:    { swatch: 'bg-sky-400',       pill: 'bg-sky-500/20 text-sky-300',         text: 'text-sky-300' },
  purple:  { swatch: 'bg-violet-400',    pill: 'bg-violet-500/20 text-violet-300',   text: 'text-violet-300' },
  pink:    { swatch: 'bg-pink-400',      pill: 'bg-pink-500/20 text-pink-300',       text: 'text-pink-300' },
  cream:   { swatch: 'bg-cream-200',     pill: 'bg-cream-200/15 text-cream-100',     text: 'text-cream-100' },
  brown:   { swatch: 'bg-brown-800',     pill: 'bg-brown-800 text-cream-300',        text: 'text-cream-300' },
};

/**
 * Console-style dropdown with optional per-option color, in the spirit of
 * Airtable's single-select fields. Sharp corners, hairline outline, departure-
 * mono labels for that retrofuturistic readout feel.
 */
export function ColorSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  align = 'left',
  fullWidth = false,
  size = 'sm',
}: Readonly<{
  value: string;
  onChange: (v: string) => void;
  options: ColorSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  align?: 'left' | 'right';
  fullWidth?: boolean;
  size?: 'sm' | 'md';
}>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Reposition the portaled menu beneath the trigger.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    function update() {
      const r = triggerRef.current!.getBoundingClientRect();
      setPosition({ top: r.bottom + 4, left: r.left, width: r.width });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // When opening, highlight the currently selected option.
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setHighlight(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  function commit(idx: number) {
    const opt = options[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onTriggerKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlight(options.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(highlight);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  // Trigger styling.
  const sizeCls = size === 'md' ? 'text-sm px-2.5 py-1.5' : 'text-xs px-2.5 py-2';
  const tokens = selected?.color ? COLOR_TOKENS[selected.color] : null;
  const triggerBg = tokens ? tokens.pill : 'bg-brown-800 text-cream-50';
  const triggerOpenRing = open ? 'ring-2 ring-orange-500/70 ring-inset' : 'ring-0';
  const triggerWidth = fullWidth ? 'w-full' : '';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={`group/select inline-flex items-center justify-between gap-2 font-medium cursor-pointer outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-[background-color,color,box-shadow,filter] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.98] ${sizeCls} ${triggerBg} ${triggerOpenRing} ${triggerWidth} hover:brightness-110`}
      >
        <span className="truncate min-w-0">
          {selected?.label ?? placeholder ?? '—'}
        </span>
        <Caret open={open} />
      </button>

      {open && position && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              id={listboxId}
              tabIndex={-1}
              style={{
                position: 'fixed',
                top: position.top,
                left:
                  align === 'right'
                    ? Math.max(8, position.left + position.width - Math.max(position.width, 200))
                    : position.left,
                minWidth: Math.max(position.width, 200),
                zIndex: 100,
              }}
              className="color-select-menu relative max-h-[60vh]"
            >
              <div
                className="color-select-menu-bg absolute inset-0 bg-brown-900 outline outline-1 outline-cream-200/15 shadow-[0_8px_24px_rgba(0,0,0,0.5)] pointer-events-none"
                aria-hidden
              />
              <div className="relative flex flex-col py-2 max-h-[60vh] overflow-y-auto">
                {options.map((opt, i) => {
                  const isSelected = opt.value === value;
                  const isHighlight = i === highlight;
                  const t = opt.color ? COLOR_TOKENS[opt.color] : null;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => commit(i)}
                      className={`text-left flex items-center px-2.5 py-1.5 cursor-pointer outline-none transition-[background-color,box-shadow] duration-100 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        isHighlight ? 'bg-orange-500/15' : ''
                      } ${isSelected ? 'ring-1 ring-inset ring-orange-500/40' : ''}`}
                    >
                      <span className="flex-1 min-w-0 flex flex-col justify-center">
                        <span
                          className={`inline-block self-start max-w-full truncate text-xs px-1.5 py-0.5 ${
                            t ? t.pill : 'text-cream-100'
                          } font-medium`}
                        >
                          {opt.label}
                        </span>
                        {opt.hint ? (
                          <span className="block text-[10px] text-cream-400 truncate tabular-nums mt-0.5 px-1.5">
                            {opt.hint}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <span
      className={`text-cream-300 text-[9px] tracking-widest leading-none transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        open ? 'rotate-180' : ''
      }`}
      aria-hidden
    >
      ▼
    </span>
  );
}
