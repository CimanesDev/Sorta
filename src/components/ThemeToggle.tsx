"use client";
import { useSyncExternalStore } from "react";

type Mode = "light" | "dark";
const KEY = "post-sorter-theme";

// Runs before the page paints (inlined in <head>) so there's no flash of the wrong theme. Light by default.
export const themeScript = `(function(){try{document.documentElement.dataset.theme=localStorage.getItem("${KEY}")==="dark"?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;

// The saved choice lives in localStorage; read it as an external store.
const EVENT = "post-sorter-theme-change";
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}
function savedMode(): Mode {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

// One icon button that switches between light and dark.
export function ThemeToggle() {
  const mode = useSyncExternalStore<Mode>(subscribe, savedMode, () => "light");

  function toggle() {
    const next: Mode = mode === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  }

  const label = mode === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button type="button" className="icon-btn theme" onClick={toggle} title={label} aria-label={label}>
      {mode === "dark" ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1z" />
        </svg>
      )}
    </button>
  );
}
