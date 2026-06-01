"use client";

// Type-ahead combobox. Use this anywhere a native <select> has more than
// ~30 options — they're unusable past that (no search, alphabetical scroll
// only). Two outputs via hidden inputs:
//
//   <input name={name}>            → the picked option's id ("" if nothing
//                                     was picked or the user typed a new name)
//   <input name={createField}>     → the typed-but-not-matched string, only
//                                     when createField is set
//
// Server actions then check createField first (createOrg-style flow) before
// falling back to the id. Existing resolveCompany() in actions.ts already
// does exactly that.
//
// Keyboard: ↓/↑ to navigate · Enter to pick · Esc to close.

import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboboxOption {
  id: string;
  label: string;
  /** Secondary line shown below the label in the dropdown. */
  sublabel?: string;
}

export function Combobox({
  name,
  options,
  defaultValue,
  placeholder = "Type to search…",
  createField,
  createLabel = "Create new",
  required,
  className,
  emptyLabel = "— none —",
}: {
  name: string;
  options: ComboboxOption[];
  defaultValue?: string | null;
  placeholder?: string;
  /** If set, typing a value that doesn't match any option reveals a
   *  "+ Create '<typed>'" suggestion at the bottom of the list. Picking
   *  it posts the typed value under this field name. */
  createField?: string;
  createLabel?: string;
  required?: boolean;
  className?: string;
  /** Label for the "clear selection" option at the top of the list. */
  emptyLabel?: string;
}) {
  const initial = options.find((o) => o.id === (defaultValue ?? ""));
  const [text, setText] = useState(initial?.label ?? "");
  const [selectedId, setSelectedId] = useState(defaultValue ?? "");
  const [createValue, setCreateValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Filter (case-insensitive substring). Cap at 100 so a huge list doesn't
  // blow up the dropdown on initial open.
  const lower = text.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!lower) return options.slice(0, 100);
    return options.filter((o) => o.label.toLowerCase().includes(lower)).slice(0, 100);
  }, [options, lower]);

  const hasExact = options.some((o) => o.label.toLowerCase() === lower);
  const showCreate = !!createField && lower.length > 0 && !hasExact;

  // Total interactive rows in the open list (used for keyboard nav).
  const rowCount = filtered.length + (showCreate ? 1 : 0);

  const choose = (opt: ComboboxOption) => {
    setText(opt.label);
    setSelectedId(opt.id);
    setCreateValue("");
    setOpen(false);
  };

  const chooseCreate = () => {
    setCreateValue(text.trim());
    setSelectedId("");
    setOpen(false);
  };

  const clear = () => {
    setText("");
    setSelectedId("");
    setCreateValue("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(rowCount - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && rowCount > 0) {
        e.preventDefault();
        if (activeIdx < filtered.length) choose(filtered[activeIdx]!);
        else chooseCreate();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <input
        type="text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSelectedId("");
          setCreateValue("");
          setOpen(true);
          setActiveIdx(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        // Only mark required when the operator hasn't picked or created.
        required={required && !selectedId && !createValue}
        className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        autoComplete="off"
      />
      {/* Hidden submitted values */}
      <input type="hidden" name={name} value={selectedId} />
      {createField && <input type="hidden" name={createField} value={createValue} />}

      {/* Selection / create chip — gives the operator a "you've picked X" cue
          + a one-click clear. Sits below the input so it doesn't shift layout. */}
      {(selectedId || createValue) && (
        <div className="absolute right-1 top-1.5 flex items-center gap-1 text-xs">
          {createValue && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">+ new</span>}
          {selectedId && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">✓</span>}
          <button
            type="button"
            onClick={clear}
            className="rounded px-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Clear selection"
            title="Clear"
          >
            ×
          </button>
        </div>
      )}

      {open && (filtered.length > 0 || showCreate) && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg"
          role="listbox"
        >
          {filtered.map((o, i) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex w-full flex-col items-start px-2 py-1.5 text-left text-sm transition-colors ${
                i === activeIdx ? "bg-amber-50 text-amber-900" : "text-neutral-700 hover:bg-neutral-50"
              }`}
              role="option"
              aria-selected={i === activeIdx}
            >
              <span>{o.label}</span>
              {o.sublabel && <span className="text-xs text-neutral-500">{o.sublabel}</span>}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={chooseCreate}
              onMouseEnter={() => setActiveIdx(filtered.length)}
              className={`flex w-full items-center gap-2 border-t border-neutral-100 px-2 py-1.5 text-left text-sm transition-colors ${
                activeIdx === filtered.length ? "bg-emerald-50 text-emerald-900" : "text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              <span className="font-medium">+ {createLabel}:</span>
              <span className="truncate">&ldquo;{text.trim()}&rdquo;</span>
            </button>
          )}
        </div>
      )}

      {/* The "— none —" clear-selection shortcut is below the field so the
          operator can pick "nothing" without keyboard-emptying the input. */}
      {!required && (defaultValue || selectedId) && !text && (
        <button type="button" onClick={clear} className="mt-1 text-xs text-neutral-500 hover:underline">
          {emptyLabel}
        </button>
      )}
    </div>
  );
}
