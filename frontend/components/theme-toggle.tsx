'use client';

import { useEffect, useState } from "react";

const STORAGE_KEY = "subsarr-theme";

function readIsLight() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("light");
}

export function ThemeToggle() {
  const [light, setLight] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLight(readIsLight());
    setMounted(true);
  }, []);

  const toggle = () => {
    const nextLight = !document.documentElement.classList.contains("light");
    document.documentElement.classList.toggle("light", nextLight);
    try {
      localStorage.setItem(STORAGE_KEY, nextLight ? "light" : "dark");
    } catch {
      /* ignore */
    }
    setLight(nextLight);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost btn-icon text-on-surface-variant hover:text-on-surface"
      aria-label={light ? "Activar tema oscuro" : "Activar tema claro"}
      title={light ? "Tema oscuro" : "Tema claro"}
    >
      <span className="material-symbols-outlined text-[20px]">
        {mounted && light ? "dark_mode" : "light_mode"}
      </span>
    </button>
  );
}
