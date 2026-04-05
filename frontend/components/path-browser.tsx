"use client";

import { useState, useEffect, useRef } from "react";

interface PathBrowserProps {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
}

interface FileSystemEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

// Mock API function
const fetchDirectory = async (currentPath: string): Promise<FileSystemEntry[]> => {
  try {
    const response = await fetch(`/api/system/directory?path=${encodeURIComponent(currentPath)}`);
    if (!response.ok) {
      throw new Error('Failed to fetch directory');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching directory:', error);
    
    // Fallback Mock data
    const base = currentPath === "" || currentPath === "/" ? "/" : currentPath.replace(/\/$/, "") + "/";
    
    if (base === "/") {
      return [
        { name: "data", isDirectory: true, path: "/data" },
        { name: "media", isDirectory: true, path: "/media" },
        { name: "mnt", isDirectory: true, path: "/mnt" },
      ];
    }
    return [];
  }
};

export function PathBrowser({ value, onChange, placeholder = "Select path..." }: PathBrowserProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [entries, setEntries] = useState<FileSystemEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(value || "/");
  const [inputValue, setInputValue] = useState(value || "");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    try {
      const data = await fetchDirectory(path);
      setEntries(data);
      setCurrentPath(path);
    } catch (error) {
      console.error("Failed to load directory", error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (entries.length === 0 || currentPath !== inputValue) {
      loadDirectory(inputValue || "/");
    }
  };

  const handleNavigate = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    loadDirectory(path);
  };

  const handleSelect = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setInputValue(path);
    onChange(path);
    setIsOpen(false);
  };

  const handleNavigateUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentPath === "/" || currentPath === "") return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const parentPath = "/" + parts.join("/");
    loadDirectory(parentPath);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    onChange(e.target.value);
  };

  const directories = entries.filter((e) => e.isDirectory);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleOpen}
          placeholder={placeholder}
          className="w-full engraved-input text-sm px-3 py-2.5 pr-10 text-on-surface"
        />
        <span
          className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant cursor-pointer"
          onClick={() => (isOpen ? setIsOpen(false) : handleOpen())}
        >
          folder_open
        </span>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-[var(--surface-container-high)] rounded-lg shadow-xl border-none overflow-hidden transition-all duration-200 ease-out">
          {/* Current path + select button */}
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--surface-container-highest)] border-b border-[var(--surface-variant)]">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant flex-shrink-0">folder</span>
            <span className="truncate flex-1 font-mono text-xs text-on-surface-variant">{currentPath}</span>
            {loading && (
              <span className="material-symbols-outlined animate-spin text-[16px] text-on-surface-variant">sync</span>
            )}
            <button
              type="button"
              onClick={() => handleSelect(currentPath)}
              className="flex-shrink-0 flex items-center gap-1 text-xs font-medium px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              title="Seleccionar esta carpeta"
            >
              <span className="material-symbols-outlined text-[14px]">check</span>
              Seleccionar
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            {/* Navigate up */}
            {currentPath !== "/" && currentPath !== "" && (
              <div
                className="flex items-center gap-3 p-3 hover:bg-[var(--surface-variant)] cursor-pointer transition-colors duration-200"
                onClick={handleNavigateUp}
              >
                <span className="material-symbols-outlined text-lg text-on-surface-variant">arrow_upward</span>
                <span className="text-sm text-on-surface-variant">.. (Subir un nivel)</span>
              </div>
            )}

            {/* Only directories */}
            {directories.map((entry) => (
              <div
                key={entry.path}
                className="flex items-center gap-3 p-3 hover:bg-[var(--surface-variant)] group cursor-pointer transition-colors duration-200"
                onClick={(e) => handleNavigate(entry.path, e)}
              >
                <span className="material-symbols-outlined text-lg text-primary">folder</span>
                <span className="text-sm flex-1 truncate text-on-surface group-hover:text-primary">
                  {entry.name}
                </span>
                {/* Enter icon */}
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity">
                  chevron_right
                </span>
              </div>
            ))}

            {!loading && directories.length === 0 && (
              <div className="p-4 text-center text-sm text-on-surface-variant">
                Carpeta vacía
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-[var(--surface-variant)] text-[11px] text-on-surface-variant bg-[var(--surface-container-highest)]">
            Haz clic en una carpeta para entrar · pulsa <strong>Seleccionar</strong> para usar la carpeta actual
          </div>
        </div>
      )}
    </div>
  );
}
