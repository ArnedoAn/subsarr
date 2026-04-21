'use client';

import { useState, useMemo } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { PathBrowser } from '@/components/path-browser';
import { appStrings } from '@/lib/app-strings';

interface RenameVariation {
  id: string;
  label: string;
  newPath: string;
}

interface RenamePreviewItem {
  originalPath: string;
  originalName: string;
  variations: RenameVariation[];
}

export default function RenamePage() {
  const [directory, setDirectory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Data retrieved from backend preview
  const [items, setItems] = useState<RenamePreviewItem[]>([]);
  
  // User selections
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedVariations, setSelectedVariations] = useState<Record<string, string>>({}); // path => variation.newPath
  
  // Global variation selector (to sync all rows if possible)
  const [globalVariationId, setGlobalVariationId] = useState<string>('');

  const loadPreview = async () => {
    if (!directory) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<RenamePreviewItem[]>(`/rename/preview?dir=${encodeURIComponent(directory)}`);
      setItems(data);
      
      // Auto-select all and pick the first variation for each
      const newSelected = new Set<string>();
      const newVariations = { ...selectedVariations };
      
      data.forEach(item => {
        newSelected.add(item.originalPath);
        if (item.variations.length > 0 && !newVariations[item.originalPath]) {
          newVariations[item.originalPath] = item.variations[0].newPath;
        }
      });
      
      setSelectedItems(newSelected);
      setSelectedVariations(newVariations);
    } catch (err: any) {
      setError(err.message || 'Error loading preview');
    } finally {
      setLoading(false);
    }
  };

  const handleGlobalVariationChange = (id: string) => {
    setGlobalVariationId(id);
    if (!id) return;
    
    // Apply this variation id to all items that have a variation with this id
    const newVariations = { ...selectedVariations };
    items.forEach(item => {
      const match = item.variations.find(v => v.id === id);
      if (match) {
        newVariations[item.originalPath] = match.newPath;
      }
    });
    setSelectedVariations(newVariations);
  };

  const handleItemVariationChange = (originalPath: string, newPath: string) => {
    setSelectedVariations(prev => ({ ...prev, [originalPath]: newPath }));
  };

  const toggleSelection = (originalPath: string) => {
    const next = new Set(selectedItems);
    if (next.has(originalPath)) next.delete(originalPath);
    else next.add(originalPath);
    setSelectedItems(next);
  };

  const toggleAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(i => i.originalPath)));
    }
  };

  const executeRename = async () => {
    if (selectedItems.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const operations = Array.from(selectedItems).map(path => {
        const item = items.find(i => i.originalPath === path);
        return {
          originalPath: path,
          newPath: selectedVariations[path] || path,
        };
      }).filter(op => op.newPath && op.originalPath !== op.newPath);

      if (operations.length === 0) {
        setLoading(false);
        return;
      }

      const result = await apiPost<{success: number, failed: number, errors: any[]}>('/rename/execute', { operations });
      
      // Reload preview after successful rename
      await loadPreview();
      
      if (result.failed > 0) {
        setError(`${result.failed} renames failed. First error: ${result.errors[0]?.error}`);
      }
    } catch (err: any) {
      setError(err.message || 'Error executing rename');
    } finally {
      setLoading(false);
    }
  };

  // Collect all unique variation labels to populate global drop down
  const allGlobalVariations = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(item => {
      item.variations.forEach(v => {
         if (!map.has(v.id)) map.set(v.id, v.label);
      });
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [items]);

  return (
    <div className="flex flex-col gap-6 fade-in max-w-7xl mx-auto">
      <header>
         <h1 className="text-2xl font-bold tracking-tight text-primary">
            {appStrings.nav.rename}
         </h1>
         <p className="text-sm text-on-surface-variant flex items-center gap-2 mt-1">
            <span className="material-symbols-outlined text-[18px]">info</span>
            Renombra masivamente archivos de video y subtítulos para mejorar la compatibilidad (e.g. Jellyfin).
         </p>
      </header>

      {error && (
         <div className="bg-error/10 border border-error/20 text-error px-4 py-3 rounded flex items-center gap-2 text-sm">
            <span className="material-symbols-outlined flex-shrink-0 text-[18px]">error</span>
            {error}
         </div>
      )}

      {/* Control Panel */}
      <section className="bg-surface-container rounded-xl p-4 md:p-6 border border-outline-variant/30 flex flex-col gap-4">
        <label className="text-sm font-medium text-on-surface">Directorio Base</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <PathBrowser value={directory} onChange={setDirectory} placeholder="Selecciona la carpeta..." />
          </div>
          <button 
             onClick={loadPreview} 
             disabled={loading || !directory}
             className="btn btn-primary sm:w-auto w-full whitespace-nowrap"
          >
             <span className="material-symbols-outlined text-[18px]">{loading ? 'sync' : 'preview'}</span>
             Previsualizar
          </button>
        </div>
      </section>

      {/* Results Table */}
      {items.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
             <div className="flex items-center gap-4 w-full sm:w-auto">
                <span className="text-sm font-medium whitespace-nowrap">{items.length} archivos detectados</span>
                <select
                  value={globalVariationId}
                  onChange={e => handleGlobalVariationChange(e.target.value)}
                  className="engraved-input rounded px-3 py-1.5 text-sm w-full sm:w-auto"
                >
                  <option value="">-- Patrón Global --</option>
                  {allGlobalVariations.map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
             </div>
             
             <button
               onClick={executeRename}
               disabled={loading || selectedItems.size === 0}
               className="btn btn-primary sm:w-auto w-full"
             >
               <span className="material-symbols-outlined text-[18px]">drive_file_rename_outline</span>
               Renombrar Seleccionados ({selectedItems.size})
             </button>
          </div>

          <div className="overflow-x-auto max-h-[60vh] custom-scrollbar border border-outline-variant/20 rounded-xl">
             <table className="data-table min-w-[800px]">
                <thead className="sticky top-0 bg-surface-container z-10">
                   <tr>
                      <th className="w-[40px] px-4">
                        <input
                          type="checkbox"
                          className="accent-primary w-4 h-4 cursor-pointer align-middle"
                          checked={selectedItems.size === items.length && items.length > 0}
                          onChange={toggleAll}
                        />
                      </th>
                      <th className="text-left font-medium">Archivo Original</th>
                      <th className="text-left font-medium w-[40%]">Nuevo Nombre</th>
                   </tr>
                </thead>
                <tbody className="bg-surface-container-low divide-y divide-outline-variant/10 text-sm">
                   {items.map(item => {
                     const isSelected = selectedItems.has(item.originalPath);
                     const originalName = item.originalName;
                     
                     // Get the filename of the newPath selected
                     const selectedPath = selectedVariations[item.originalPath] || item.originalPath;
                     // Extract just filename from newPath to show in UI
                     const newPathFileName = selectedPath.split(/[/\\]/).pop() || selectedPath;

                     return (
                       <tr key={item.originalPath} className={`${isSelected ? '' : 'opacity-60'} hover:bg-surface-container-high transition-colors`}>
                         <td className="px-4 py-3 text-center">
                           <input
                             type="checkbox"
                             className="accent-primary w-4 h-4 cursor-pointer align-middle"
                             checked={isSelected}
                             onChange={() => toggleSelection(item.originalPath)}
                           />
                         </td>
                         <td className="px-4 py-3 font-mono text-xs text-on-surface-variant break-all">
                           {originalName}
                         </td>
                         <td className="px-4 py-3">
                           {item.variations.length > 0 ? (
                             <select
                               className="engraved-input w-full px-2 py-1 flex-1 text-xs font-mono rounded"
                               value={selectedPath}
                               onChange={(e) => handleItemVariationChange(item.originalPath, e.target.value)}
                             >
                               {item.variations.map((v, i) => (
                                 <option key={i} value={v.newPath}>
                                   {v.newPath.split(/[/\\]/).pop()}
                                 </option>
                               ))}
                             </select>
                           ) : (
                             <span className="text-error text-xs italic">No match</span>
                           )}
                         </td>
                       </tr>
                     );
                   })}
                </tbody>
             </table>
          </div>
        </section>
      )}

      {items.length === 0 && !loading && directory && (
         <div className="bg-surface-container-high rounded p-8 text-center text-on-surface-variant flex flex-col items-center gap-2">
            <span className="material-symbols-outlined text-4xl opacity-50">search_off</span>
            <p>No se encontraron archivos multimedia para renombrar en este directorio.</p>
         </div>
      )}
    </div>
  );
}
