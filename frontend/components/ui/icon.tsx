'use client';

import { useEffect } from 'react';

const paths: Record<string, string> = {
  menu:'M4 6h16M4 12h16M4 18h16', more_horiz:'M4 12h1m6 0h1m6 0h1', close:'m6 6 12 12M6 18 18 6', check:'m4 12 5 5L20 6', check_circle:'M9 12l2 2 4-4M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', cancel:'m8 8 8 8m-8 0 8-8M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', search_off:'m3 3 18 18M18 10a8 8 0 1 1-8-8', expand_more:'m6 9 6 6 6-6', expand_less:'m6 15 6-6 6 6', chevron_right:'m9 6 6 6-6 6', chevron_left:'m15 6-6 6 6 6', first_page:'M5 5v14m13-13-6 6 6 6', last_page:'M19 5v14M6 6l6 6-6 6', arrow_forward:'M3 12h18m-6-6 6 6-6 6', arrow_upward:'M12 21V3m-6 6 6-6 6 6', open_in_new:'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7', refresh:'M20 7a9 9 0 1 0 1 9M20 2v6h-6', progress_activity:'M21 12a9 9 0 1 1-9-9', sync:'M4 7h14l-4-4M20 17H6l4 4M4 7v5m16 5v-5', info:'M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', error:'M12 7v6m0 3v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', warning:'M12 3 1 21h22L12 3Zm0 6v5m0 3v1', folder:'M2 5h8l2 3h10v13H2V5Z', folder_open:'M2 5h8l2 3h10v4H6L2 21V5Zm0 16h17l3-9', video_library:'M3 3h18v18H3V3Zm6 4 8 5-8 5V7Z', movie:'M3 3h18v18H3V3Zm0 5h18M7 3l4 5m3-5 4 5', tv_gen:'M3 6h18v15H3V6Zm5-5 4 5 4-5', subtitles:'M2 5h20v14H2V5Zm3 6h4m2 0h8M5 15h8m2 0h4', translate:'M2 5h12M8 2v3m-4 3c1 5 5 8 9 9M12 5c0 6-4 10-9 13m11 3 4-11 4 11m-7-3h6', dashboard:'M3 3h7v7H3V3Zm11 0h7v11h-7V3ZM3 14h7v7H3v-7Zm11 4h7v3h-7v-3Z', settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-6h4l1 3 3 1 3 3-2 3 1 3-3 4-3-1-2 4-3-2-1-3-4-1-2-4 3-2V6l3-1 2-3Z', work_history:'M3 5h18v16H3V5Zm5 0V2h8v3m-4 4v5l3 2', terminal:'M2 4h20v16H2V4Zm4 4 4 4-4 4m7 0h5', drive_file_rename_outline:'m4 15-1 6 6-1L21 8l-5-5L4 15Zm10-10 5 5', delete:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7', notifications:'M4 18h16l-2-4V8a6 6 0 0 0-12 0v6l-2 4Zm6 3h4', storage:'M3 3h18v6H3V3Zm0 12h18v6H3v-6Zm3-9h1m-1 12h1', schedule:'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', filter_list:'M3 5h18M6 12h12m-9 7h6', tune:'M3 6h18M3 18h18M7 3v6m10 6v6', playlist_add:'M3 5h12M3 10h12M3 15h7m7-2v8m-4-4h8', dark_mode:'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z', light_mode:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0', play_arrow:'m7 3 14 9-14 9V3Z', pause:'M7 3v18M17 3v18', stop:'M4 4h16v16H4V4Z', download:'M12 3v12m-5-5 5 5 5-5M3 17v4h18v-4', upload:'M12 17V3m-5 5 5-5 5 5M3 17v4h18v-4', add:'M12 3v18M3 12h18', description:'M4 2h10l6 6v14H4V2Zm10 0v7h6M8 13h8m-8 4h8', help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 3v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
};
const aliases: Record<string,string> = { video_file:'movie', file_present:'description', file_copy:'description', content_copy:'description', restart_alt:'refresh', replay:'refresh', history:'schedule', pending:'schedule', language:'translate', auto_awesome:'translate', smart_toy:'translate', bolt:'translate', done:'check', done_all:'check', save:'download', download_done:'download', cloud_upload:'upload', upload_file:'upload', expand_content:'open_in_new', keyboard_arrow_down:'expand_more', keyboard_arrow_up:'expand_less', keyboard_arrow_right:'chevron_right', keyboard_arrow_left:'chevron_left', visibility:'search', visibility_off:'search_off', sort:'filter_list', swap_horiz:'sync', arrow_back:'chevron_left', arrow_downward:'download', skip_next:'last_page', play_circle:'play_arrow', pause_circle:'pause', cancel_presentation:'cancel', inventory_2:'storage', database:'storage', list:'menu', queue:'playlist_add', more_vert:'more_horiz', edit:'drive_file_rename_outline', edit_note:'drive_file_rename_outline', terminal:'terminal', memory:'settings', construction:'settings', science:'settings', account_tree:'folder', closed_caption:'subtitles' };
function iconPath(name: string) { return paths[aliases[name] ?? name] ?? paths.help; }
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <svg className={`inline-block shrink-0 ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPath(name)} /></svg>;
}
/** Adapts existing ligature labels without network fonts or modifying page markup. */
export function LocalIconCompatibility() {
  useEffect(() => {
    const update = (element: Element) => {
      const icon = element as HTMLElement;
      const name = icon.textContent?.trim() ?? '';
      if (icon.dataset.localIcon === name) return;
      if (!icon.dataset.localIcon) icon.style.setProperty('--icon-size', getComputedStyle(icon).fontSize);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPath(name)}"/></svg>`;
      icon.style.setProperty('--local-icon', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
      icon.dataset.localIcon = name;
      if (icon.tagName === 'SPAN') icon.setAttribute('aria-hidden', 'true');
    };
    const scan = (root: Element) => { if (root.matches('.material-symbols-outlined')) update(root); root.querySelectorAll('.material-symbols-outlined').forEach(update); };
    scan(document.body);
    const observer = new MutationObserver(records => { for (const record of records) { if (record.type === 'characterData') { const parent = record.target.parentElement; if (parent?.matches('.material-symbols-outlined')) update(parent); } else if (record.target instanceof Element) scan(record.target); } });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
