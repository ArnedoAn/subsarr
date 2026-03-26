const fs = require('fs');

let content = fs.readFileSync('frontend/app/page.tsx', 'utf8');

// 1. Add new state variables
content = content.replace(
  'const [error, setError] = useState<string | null>(null);',
  `const [error, setError] = useState<string | null>(null);
  const [folderFilter, setFolderFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);`
);

// 2. Extract folders
content = content.replace(
  'const load = useCallback(async () => {',
  `const folders = useMemo(() => {
    const dirs = new Set<string>();
    items.forEach(item => {
      const dir = item.path.substring(0, item.path.lastIndexOf('/'));
      if (dir) dirs.add(dir);
    });
    return Array.from(dirs).sort();
  }, [items]);

  const load = useCallback(async () => {`
);

// 3. Update filtered logic
const oldFilterLogic = `const filtered = useMemo(() => {
    return items
      .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
      .filter((item) => {
        const hasSource = item.subtitleTracks.length > 0;
        const status = item.ruleStatus?.skip ? 'skipped' : hasSource ? 'ready' : 'no-source';
        return statusFilter === 'all' ? true : status === statusFilter;
      })
      .filter((item) => {
        if (!missingTargetOnly) {
          return true;
        }

        const target = targetLanguageFilter.toLowerCase();
        const embedded = item.subtitleTracks.some((track) => track.language === target);
        const external = item.externalSubtitles.some((subtitle) => subtitle.language === target);
        return !embedded && !external;
      });
  }, [items, missingTargetOnly, query, statusFilter, targetLanguageFilter]);`;

const newFilterLogic = `const filtered = useMemo(() => {
    return items
      .filter((item) => {
        const searchLower = query.toLowerCase();
        return item.name.toLowerCase().includes(searchLower) || item.path.toLowerCase().includes(searchLower);
      })
      .filter((item) => {
        if (folderFilter !== 'all') {
          return item.path.startsWith(folderFilter);
        }
        return true;
      })
      .filter((item) => {
        const hasSource = item.subtitleTracks.length > 0;
        const status = item.ruleStatus?.skip ? 'skipped' : hasSource ? 'ready' : 'no-source';
        return statusFilter === 'all' ? true : status === statusFilter;
      })
      .filter((item) => {
        if (!missingTargetOnly) {
          return true;
        }

        const target = targetLanguageFilter.toLowerCase();
        const embedded = item.subtitleTracks.some((track) => track.language === target);
        const external = item.externalSubtitles.some((subtitle) => subtitle.language === target);
        return !embedded && !external;
      });
  }, [items, missingTargetOnly, query, folderFilter, statusFilter, targetLanguageFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [filtered.length, itemsPerPage, totalPages, currentPage]);

  const paginatedItems = filtered.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );`;

content = content.replace(oldFilterLogic, newFilterLogic);

// 4. Add Folder Dropdown
content = content.replace(
  '<input\n              value={query}',
  `<div className="relative col-span-1 sm:col-span-2 lg:col-span-1">
              <select
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
                className="w-full engraved-input rounded-lg px-4 py-3 pr-10 text-sm text-on-surface appearance-none bg-surface-container-lowest cursor-pointer transition-all duration-200"
              >
                <option value="all">All Folders</option>
                {folders.map(folder => (
                  <option key={folder} value={folder}>{folder}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">
                folder
              </span>
            </div>
            <input
              value={query}`
);
content = content.replace('lg:col-span-4', 'lg:col-span-5');

// 5. Responsive table wrapper
content = content.replace(
  '<div className="bg-surface-container rounded-xl overflow-hidden">\n        <table',
  '<div className="bg-surface-container rounded-xl overflow-hidden">\n        <div className="overflow-x-auto">\n        <table min-w-full'
);
content = content.replace('</table>\n      </div>', '</table>\n        </div>');

// 6. Pagination UI
const paginationUI = `
        {/* Pagination Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-cyan-400/15 bg-surface-container-low gap-4">
          <div className="flex items-center gap-4 text-xs text-on-surface-variant">
            <span>
              Showing {filtered.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length} entries
            </span>
            <div className="relative">
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="engraved-input rounded-lg px-2 py-1.5 pr-8 text-xs text-on-surface appearance-none bg-surface-container-lowest cursor-pointer"
              >
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
              <span className="material-symbols-outlined absolute right-1.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-[16px]">
                expand_more
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded text-xs font-bold bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-variant transition-colors text-on-surface"
            >
              PREV
            </button>
            <span className="text-xs font-mono text-on-surface-variant px-2">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 rounded text-xs font-bold bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-variant transition-colors text-on-surface"
            >
              NEXT
            </button>
          </div>
        </div>
`;
content = content.replace('</table>\n        </div>\n      </div>', '</table>\n        </div>\n' + paginationUI + '      </div>');

// 7. Update to paginatedItems mapping
content = content.replace('{filtered.map((item, index) => {', '{paginatedItems.map((item, index) => {');

// 8. Truncate subtitle tracks
const oldTracks = `<div className="flex flex-wrap gap-2">
                      {item.subtitleTracks.map((track) => (
                        <span
                          key={\`\${item.id}-\${track.index}\`}
                          className="bg-surface-container-high px-3 py-1.5 rounded-md text-[10px] font-mono text-on-surface-variant"
                        >
                          {track.language} · {track.codec}
                        </span>
                      ))}
                    </div>`;

const newTracks = `<div className="flex flex-wrap gap-2">
                      {item.subtitleTracks.slice(0, 2).map((track) => (
        
