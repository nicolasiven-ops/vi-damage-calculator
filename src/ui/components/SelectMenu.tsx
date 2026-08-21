/**
 * A dropdown that can sit where a heading sits.
 *
 * A native `<select>` cannot: the browser paints its list and its closed state
 * with system chrome, which reads as a form control dropped into a hextech
 * panel. This renders both parts itself, so a panel title can *be* the picker —
 * the target panel's heading is the target, and changing it changes the target.
 *
 * Past a dozen entries a list stops being scannable, hence the optional search.
 * Keyboard handling is the part that is easy to leave out and annoying to live
 * without: arrows move, Enter picks, Escape closes, and focus returns to the
 * trigger so tabbing continues where it left off.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  id: string;
  label: string;
  /** Secondary line, e.g. a champion's title or a preset's numbers. */
  detail?: string;
  iconUrl?: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  ariaLabel: string;
  /** `title` renders the trigger as a panel heading rather than as a field. */
  variant?: 'title' | 'field';
}

export function SelectMenu({
  value,
  options,
  onChange,
  placeholder = 'Select …',
  searchable = false,
  searchPlaceholder = 'Search …',
  ariaLabel,
  variant = 'field',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const current = options.find((option) => option.id === value) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  // Reopening should start clean rather than in whatever state it was closed.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setHighlight(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function close(): void {
    setOpen(false);
    trigger.current?.focus();
  }

  function pick(id: string): void {
    onChange(id);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((index) => {
        if (filtered.length === 0) return 0;
        return (index + step + filtered.length) % filtered.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      const option = filtered[highlight];
      if (option) {
        event.preventDefault();
        pick(option.id);
      }
    }
  }

  return (
    <div className={`select-menu ${variant}`} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className="select-menu-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="select-menu-value">{current?.label ?? placeholder}</span>
        <span className="select-menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="select-menu-pop">
          {searchable && (
            <input
              type="search"
              className="select-menu-search"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(0);
              }}
              autoFocus
            />
          )}

          <div className="select-menu-list scroll-y" role="listbox" aria-label={ariaLabel}>
            {filtered.length === 0 && <p className="empty-note">No match.</p>}
            {filtered.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                className={`select-menu-option${index === highlight ? ' highlight' : ''}${
                  option.id === value ? ' selected' : ''
                }`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(option.id)}
              >
                {option.iconUrl && <img src={option.iconUrl} alt="" className="select-menu-icon" />}
                <span className="select-menu-option-label">{option.label}</span>
                {option.detail && <span className="select-menu-option-detail">{option.detail}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
