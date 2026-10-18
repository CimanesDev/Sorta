"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { setCategories } from "@/app/actions";
import { CATEGORIES, category, type CategoryId } from "@/lib/categories";

// The category pill on each row. Click to change; the change saves straight away.
export function CategoryPicker({ id, value, also }: { id: number; value: CategoryId | null; also: CategoryId[] }) {
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<CategoryId | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const shown = optimistic ?? value;
  const cat = category(shown);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function choose(c: CategoryId) {
    setOpen(false);
    if (c === shown) return;
    setOptimistic(c);
    start(async () => {
      await setCategories(id, c, also);
      setOptimistic(null);
    });
  }

  return (
    <div className="picker" ref={ref}>
      <button
        type="button"
        className={`pill${cat ? "" : " empty"}`}
        data-cat={cat?.id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span className="dot" />
        {cat ? cat.label : "Choose category"}
        {pending ? <span className="spinner tiny" /> : <span className="chev" aria-hidden="true" />}
      </button>
      {open && (
        <ul className="menu" role="listbox" aria-label="Category">
          {CATEGORIES.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === shown}
                data-cat={c.id}
                onClick={(e) => {
                  e.stopPropagation();
                  choose(c.id);
                }}
              >
                <span className="dot" />
                {c.label}
                {c.id === shown && <span className="check" aria-hidden="true">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
