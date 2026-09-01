import {
  $, $$, el, formatSize, copyText,
} from './util.js';
import * as store from './store.js';
import * as list from './list.js';
import * as detail from './detail.js';
import * as sidebar from './sidebar.js';
import * as tools from './tools.js';
import * as pages from './pages.js';
import * as composer from './composer.js';
import * as sessions from './sessions.js';
import * as filters from './filters.js';
import * as find from './find.js';
import * as online from './online.js';
import * as ctxmenu from './ctxmenu.js';
import * as ruleTags from './rules.js';
import { icons } from './icons.js';
import { toast, initTooltips } from './ui.js';

// Categories follow Proxyman's filter strip.
const TYPE_CHIPS = [
  ['all', 'All'], ['http', 'HTTP'], ['https', 'HTTPS'], ['ws', 'WebSocket'], ['sep', ''],
  ['json', 'JSON'], ['form', 'Form'], ['xml', 'XML'], ['js', 'JS'], ['css', 'CSS'],
  ['html', 'Document'], ['image', 'Media'], ['errors', 'Errors'], ['slow', 'Slow'],
];

const renderChips = () => {
  const wrap = $('#type-chips');
  if (wrap.dataset.built) {
    $$('.chip', wrap).forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.type === store.state.typeFilter);
    });
    return;
  }
  wrap.dataset.built = '1';
  TYPE_CHIPS.forEach(([type, label]) => {
    if (type === 'sep') {
      wrap.appendChild(el('span', { class: 'chip-sep' }));
      return;
    }
    const chip = document.createElement('button');
    chip.className = `chip${type === 'all' ? ' active' : ''}`;
    chip.dataset.type = type;
    chip.textContent = label;
    chip.addEventListener('click', () => store.setTypeFilter(chip.dataset.type));
    wrap.appendChild(chip);
  });
};

const DOCK_KEY = 'pm-dock';

// Clicking the active dock button hides the inspector; clicking either button
// again brings it back in that position.
const setDock = (dock) => {
  const body = document.body;
  const current = body.classList.contains('dock-right') ? 'right' : 'bottom';
  const hidden = body.classList.contains('no-inspector');
  if (!hidden && current === dock) {
    body.classList.add('no-inspector');
  } else {
    body.classList.remove('no-inspector');
    body.classList.toggle('dock-right', dock === 'right');
    // A narrow right dock reads better with request above response.
    detail.setLayout(dock === 'right' ? 'stack' : 'split');
  }
  const active = !body.classList.contains('no-inspector');
  $('#dock-bottom').classList.toggle('on', active && dock === 'bottom');
  $('#dock-right').classList.toggle('on', active && dock === 'right');
  $('#detail').style.width = '';
  $('#detail').style.height = '';
  try {
    localStorage.setItem(DOCK_KEY, active ? dock : 'hidden');
  } catch (e) { /* private mode */ }
  list.render();
};

const SIDEBAR_KEY = 'pm-sidebar-collapsed';
const SIDEBAR_WIDTH_KEY = 'pm-sidebar-width';

const applySidebar = (collapsed) => {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch (e) { /* private mode */ }
};

const toggleSidebar = () => applySidebar(!document.body.classList.contains('sidebar-collapsed'));

const bindSidebarResize = () => {
  const sidebarEl = $('#sidebar');
  const handle = $('#sidebar-resizer');
  const applyWidth = (width) => {
    const value = Math.min(420, Math.max(220, width));
    document.documentElement.style.setProperty('--sidebar-width', `${value}px`);
    return value;
  };
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (saved) applyWidth(saved);
  } catch (e) { /* default width */ }
  let dragging = false;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    document.body.classList.add('resizing-sidebar');
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    applyWidth(e.clientX - sidebarEl.getBoundingClientRect().left);
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing-sidebar');
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarEl.getBoundingClientRect().width)));
    } catch (e) { /* private mode */ }
    list.render();
  });
};

const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('pm-theme', theme);
  } catch (e) { /* private mode */ }
};

const showPage = (page) => {
  store.setPage(page);
  $$('#page-nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  ['network', 'rules', 'values', 'plugins', 'classic'].forEach((name) => {
    $(`#page-${name}`).classList.toggle('hidden', name !== page);
  });
  if (page === 'rules') {
    pages.renderRules(true);
  } else if (page === 'values') {
    pages.renderValues(true);
  } else if (page === 'plugins') {
    pages.renderPlugins();
  } else if (page === 'classic') {
    pages.renderClassic();
  }
};

const renderStatus = () => {
  const { server, error, recording } = store.state;
  const text = $('#listen-text');
  const pill = $('#listen-pill');
  if (error) {
    text.textContent = 'Disconnected';
    pill.classList.add('bad');
  } else {
    const host = (server && server.host) || '127.0.0.1';
    const port = (server && server.port) || '';
    text.textContent = port ? `Whistle | Listening on ${host}:${port}` : 'Whistle | Starting…';
    pill.classList.remove('bad');
  }
  pill.classList.toggle('paused', !recording);
  $('#listen-action').textContent = recording ? 'Pause' : 'Resume';

  const rows = list.visible();
  const selectedIndex = rows.findIndex((i) => i.id === store.state.selectedId);
  $('#sb-count').textContent = `${selectedIndex >= 0 ? selectedIndex + 1 : 0}/${rows.length} rows selected`;
  const bytes = rows.reduce((sum, i) => sum + ((i.res && i.res.size) || 0) + ((i.req && i.req.size) || 0), 0);
  $('#sb-stat').textContent = `· ${formatSize(bytes)}`;
  $('#sb-proxy').textContent = (server && server.port) ? `Proxy :${server.port}` : 'Proxy';
  $('#btn-online').classList.toggle('off', !!error);
};

const bindToolbar = () => {
  $('#btn-record').addEventListener('click', () => {
    store.setRecording(!store.state.recording);
    const on = store.state.recording;
    const btn = $('#btn-record');
    btn.innerHTML = on ? icons.record : icons.pause;
    btn.classList.toggle('paused', !on);
    btn.title = on ? 'Pause recording (⌘R)' : 'Resume recording (⌘R)';
  });
  $('#btn-clear').addEventListener('click', () => store.clearSessions());
  $('#sb-clear').addEventListener('click', () => store.clearSessions());
  $('#sb-filter').addEventListener('click', () => filters.focusInput());
  $('#sb-autoselect').addEventListener('click', () => {
    autoSelect = !autoSelect;
    $('#sb-autoselect').classList.toggle('on', autoSelect);
  });
  $$('.statusbar .toggle').forEach((btn) => {
    btn.addEventListener('click', () => tools.open(btn.dataset.tool));
  });
  $('#listen-action').addEventListener('click', () => $('#btn-record').click());
  $('#dock-bottom').addEventListener('click', () => setDock('bottom'));
  $('#dock-right').addEventListener('click', () => setDock('right'));
  $('#btn-replay').addEventListener('click', () => {
    const item = store.selected();
    if (!item) {
      return toast('Select a request first');
    }
    return composer.open(item);
  });
  $('#btn-compose').addEventListener('click', () => composer.open(null));
  $('#btn-export').addEventListener('click', () => sessions.exportSessions());
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      sessions.importSessions(file);
    }
    e.target.value = '';
  });
  $('#btn-sidebar').addEventListener('click', toggleSidebar);
  $('#btn-online').addEventListener('click', () => online.open());
  $('#btn-sidebar-show').addEventListener('click', toggleSidebar);
  $('#btn-theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  $$('#tool-nav a').forEach((a) => a.addEventListener('click', () => tools.open(a.dataset.tool)));
  $$('#page-nav a').forEach((a) => a.addEventListener('click', () => showPage(a.dataset.page)));
};

// ⌘F acts on the region being worked in: over the inspector it searches the
// open request or response, over the list it opens the URL filter.
const handleFind = () => {
  const inInspector = find.activeRegion() === 'inspector'
    && document.querySelector('#detail-body .pane');
  if (inInspector && find.open(find.findTarget())) {
    return;
  }
  filters.focusInput();
};

// Escape reaches the page either as a key event or, when the shell's global
// Escape shortcut grabbed it first, as an IPC message. Both land here.
const handleEscape = () => {
  if (find.isOpen() && (find.activeRegion() === 'inspector' || !filters.isOpen())) {
    find.close();
    return;
  }
  if (filters.isOpen()) {
    filters.hide();
    return;
  }
  $('#modal-root').textContent = '';
};

// Chromium's own context menu offers a document-wide Select All, which hands
// back the whole chrome as text. Own the menu inside the inspector instead.
const bindInspectorMenu = () => {
  $('#detail-body').addEventListener('contextmenu', (e) => {
    const scope = e.target.closest && e.target.closest('.pane-scroll');
    if (!scope) {
      return;
    }
    const selection = String(window.getSelection() || '');
    ctxmenu.openMenu(e, [
      ['Copy', async () => {
        const ok = await copyText(selection);
        toast(ok ? 'Copied' : 'Nothing selected');
      }],
      ['Select All', () => find.selectAll()],
      ['-'],
      ['Copy this pane', async () => {
        const ok = await copyText(scope.innerText);
        toast(ok ? 'Pane copied' : 'Could not copy');
      }],
    ]);
  });
};

const bindKeys = () => {
  document.addEventListener('keydown', (e) => {
    // Escape dismisses whatever belongs to the region being worked in, so
    // leaving the filter open while reading a body (or vice versa) is fine.
    if ((e.key === 'Escape' || e.keyCode === 27)
      && find.isOpen() && find.activeRegion() === 'inspector') {
      e.preventDefault();
      find.close();
      return;
    }
    if (filters.handleKey(e)) {
      e.preventDefault();
      return;
    }
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      if (e.shiftKey) {
        $('#side-filter-input').focus();
      } else {
        handleFind();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && find.selectAll()) {
      e.preventDefault();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      store.clearSessions();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.key.toLowerCase() === 'b')) {
      e.preventDefault();
      toggleSidebar();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      $('#btn-record').click();
      return;
    }
    if (inField) {
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list.moveSelection(-1);
    } else if (e.key === 'Escape') {
      handleEscape();
    }
  }, true);
};

const bindSplitter = () => {
  const splitter = $('#hsplit');
  const detailPane = $('#detail');
  let dragging = false;
  splitter.addEventListener('mousedown', () => {
    dragging = true;
    document.body.classList.add('dragging');
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) {
      return;
    }
    const rect = $('#work').getBoundingClientRect();
    if (document.body.classList.contains('dock-right')) {
      const width = Math.min(rect.width - 320, Math.max(320, rect.right - e.clientX));
      detailPane.style.width = `${width}px`;
    } else {
      const height = Math.min(rect.height - 120, Math.max(120, rect.bottom - e.clientY));
      detailPane.style.height = `${height}px`;
    }
    list.render();
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.classList.remove('dragging');
  });
};

// The shell only insets the macOS traffic lights when it renders the modern UI,
// and tells the page so through the start URL.
const applyPlatformChrome = () => {
  if (new URLSearchParams(location.search).get('frameless') === '1') {
    document.body.classList.add('frameless-mac');
  }
};

// Fill every [data-icon] placeholder from the generated SVG set.
const paintIcons = () => {
  $$('[data-icon]').forEach((node) => {
    const name = node.dataset.icon;
    if (icons[name]) {
      node.innerHTML = icons[name];
    }
  });
};

let autoSelect = false;
let pointerInteraction = false;
let pendingUiRender = false;
let flushUiTimer;

// Polling can finish between mousedown and mouseup. Replacing the node during
// that interval prevents the browser from dispatching `click`, which made the
// busy capture UI feel completely unresponsive. Hold dynamic paints until the
// current pointer gesture (including its click event) has finished.
const bindInteractionGuard = (renderUi) => {
  document.addEventListener('mousedown', () => {
    pointerInteraction = true;
    clearTimeout(flushUiTimer);
  }, true);
  const release = () => {
    pointerInteraction = false;
    clearTimeout(flushUiTimer);
    flushUiTimer = setTimeout(() => {
      if (pendingUiRender) {
        pendingUiRender = false;
        renderUi();
      }
    }, 0);
  };
  document.addEventListener('mouseup', release, true);
  window.addEventListener('blur', release);
};

// The shell forwards CommandOrControl+F here because find-bar owns it globally.
const bindShellShortcuts = () => {
  try {
    // eslint-disable-next-line global-require
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('open-filter', () => handleFind());
    ipcRenderer.on('ui-escape', () => handleEscape());
    ipcRenderer.on('ui-select-all', () => {
      if (!find.selectAll()) {
        document.execCommand('selectAll');
      }
    });
  } catch (e) { /* plain browser */ }
};

const boot = () => {
  applyPlatformChrome();
  bindShellShortcuts();
  store.restoreMarks();
  try {
    applySidebar(localStorage.getItem(SIDEBAR_KEY) === '1');
  } catch (e) {
    applySidebar(false);
  }
  paintIcons();
  filters.init();
  initTooltips();
  try {
    applyTheme(localStorage.getItem('pm-theme') || 'light');
  } catch (e) {
    applyTheme('light');
  }
  list.init();
  // Rule text is small and rarely changes, so a slow refresh is enough to keep
  // the list badges honest.
  ruleTags.refresh();
  setInterval(() => ruleTags.refresh(), 5000);
  sidebar.init();
  bindSidebarResize();
  bindToolbar();
  bindKeys();
  bindInspectorMenu();
  bindSplitter();
  renderChips();
  // Restore the inspector dock after the list exists: setDock repaints it.
  try {
    const saved = localStorage.getItem(DOCK_KEY);
    if (saved === 'right') {
      setDock('right');
    } else if (saved === 'hidden') {
      setDock('bottom');
      setDock('bottom');
    }
  } catch (e) { /* default bottom dock */ }

  const renderUi = () => {
    if (store.state.page === 'network') {
      list.render();
      if (autoSelect) {
        const rows = list.visible();
        const last = rows[rows.length - 1];
        if (last && last.id !== store.state.selectedId) {
          store.state.selectedId = last.id;
        }
      }
      detail.render();
    }
    sidebar.render();
    renderChips();
    filters.sync();
    renderStatus();
  };
  bindInteractionGuard(renderUi);
  store.subscribe(() => {
    if (pointerInteraction) {
      pendingUiRender = true;
      return;
    }
    renderUi();
  });
  store.startPolling();
};

document.addEventListener('DOMContentLoaded', boot);
