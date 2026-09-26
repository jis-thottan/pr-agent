"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button onClick={toggle} className="rounded-md px-2 py-1 text-muted hover:bg-panel-2 hover:text-fg" title="Toggle theme" aria-label="Toggle theme">
      {dark === null ? "◐" : dark ? "☾" : "☀"}
    </button>
  );
}

/** Inline script to apply the saved/system theme before first paint (avoids a flash). */
export const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;
