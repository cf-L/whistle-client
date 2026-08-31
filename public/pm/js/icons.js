// Inline stroke icons (24x24 grid, 1.6 stroke) so the toolbar has no bitmap or
// glyph-font dependency and inherits currentColor in both themes.
const svg = (paths, opts = {}) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="${opts.w || 1.6}" stroke-linecap="round" stroke-linejoin="round"
  width="${opts.size || 16}" height="${opts.size || 16}" aria-hidden="true">${paths}</svg>`;

export const icons = {
  record: svg('<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="8" y="6" width="3" height="12" rx="1.2"/><rect x="13" y="6" width="3" height="12" rx="1.2"/>'),
  clear: svg('<path d="M4 7h16"/><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7"/>'),
  replay: svg('<path d="M20 11a8 8 0 1 0-2.3 6.4"/><path d="M20 5v6h-6"/>'),
  compose: svg('<path d="M4 20h16"/><path d="M14.5 4.5a2.1 2.1 0 0 1 3 3L8.6 16.4 4.8 17.6l1.2-3.8z"/>'),
  export: svg('<path d="M12 15V4"/><path d="M8.5 7.5L12 4l3.5 3.5"/><path d="M4.5 14v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4"/>'),
  import: svg('<path d="M12 4v11"/><path d="M8.5 11.5L12 15l3.5-3.5"/><path d="M4.5 14v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4"/>'),
  search: svg('<circle cx="11" cy="11" r="6.2"/><path d="M15.6 15.6L20 20"/>'),
  filterPlus: svg('<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>'),
  theme: svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5v15" /><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" stroke="none"/>'),
  close: svg('<path d="M6 6l12 12"/><path d="M18 6L6 18"/>', { size: 14 }),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>', { size: 14 }),
  chevron: svg('<path d="M9 6l6 6-6 6"/>', { size: 12 }),
  network: svg('<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a13 13 0 0 1 0 16a13 13 0 0 1 0-16"/>'),
  rules: svg('<path d="M4 7h16"/><path d="M4 12h10"/><path d="M4 17h13"/>'),
  values: svg('<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 10h16"/><path d="M10 10v9"/>'),
  plugins: svg('<path d="M9 4v3"/><path d="M15 4v3"/><path d="M6 7h12v5a6 6 0 0 1-12 0z"/><path d="M12 18v2"/>'),
  classic: svg('<path d="M9 5L4 12l5 7"/><path d="M4 12h16"/>'),
  mapLocal: svg('<path d="M12 4v9"/><path d="M8.5 9.5L12 13l3.5-3.5"/><path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>'),
  mapRemote: svg('<path d="M4 9h13"/><path d="M14 6l3 3-3 3"/><path d="M20 15H7"/><path d="M10 18l-3-3 3-3"/>'),
  throttle: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>'),
  block: svg('<circle cx="12" cy="12" r="8"/><path d="M6.4 6.4l11.2 11.2"/>'),
  ssl: svg('<rect x="5" y="10.5" width="14" height="9" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
  breakpoint: svg('<circle cx="12" cy="12" r="8"/><rect x="9.5" y="9" width="2" height="6" rx=".8" fill="currentColor" stroke="none"/><rect x="12.5" y="9" width="2" height="6" rx=".8" fill="currentColor" stroke="none"/>'),
  sidebar: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>'),
  pin: svg('<path d="M9 4h6l-.8 5.2 3.3 3.3H6.5l3.3-3.3z"/><path d="M12 12.5V20"/>'),
  save: svg('<path d="M5.5 5.5A1.5 1.5 0 0 1 7 4h8.5L19 7.5V18a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18z"/><path d="M8.5 4v5h6V4"/><rect x="8.5" y="13" width="7" height="6.5"/>'),
  filter: svg('<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>', { size: 14 }),
  layoutH: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 13h17"/>'),
  layoutV: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M12 4.5v15"/>'),
  online: svg('<path d="M4 19h16"/><rect x="5" y="12" width="3.4" height="6" rx="1"/><rect x="10.3" y="8" width="3.4" height="10" rx="1"/><rect x="15.6" y="4.5" width="3.4" height="13.5" rx="1"/>'),
  folder: svg('<path d="M4 8.5A2 2 0 0 1 6 6.5h3.6l1.6 2H18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>', { size: 14 }),
};

export const icon = (name, cls) => {
  const span = document.createElement('span');
  span.className = `icn${cls ? ` ${cls}` : ''}`;
  span.innerHTML = icons[name] || '';
  return span;
};
