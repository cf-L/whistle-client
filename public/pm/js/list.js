import {
  $, el, parseUrl, formatSize, formatTime, formatClock, contentType, statusOf, isError,
  clientOf, statusText,
} from './util.js';
import * as store from './store.js';
import * as rules from './rules.js';
import * as ctxmenu from './ctxmenu.js';

// Column set mirrors Proxyman's request table.
const COLUMNS = [
  { key: 'state', label: '', width: 26 },
  { key: 'index', label: 'ID', width: 52 },
  { key: 'url', label: 'URL', width: 0 },
  { key: 'client', label: 'Client', width: 150 },
  { key: 'method', label: 'Method', width: 88 },
  { key: 'status', label: 'Status', width: 92 },
  { key: 'code', label: 'Code', width: 62 },
  { key: 'time', label: 'Time', width: 108 },
  { key: 'duration', label: 'Duration', width: 84 },
  { key: 'size', label: 'Size', width: 82 },
];

const ROW_HEIGHT = 26;
const OVERSCAN = 12;

let scrollEl;
let rowsEl;
let sizerEl;
let headEl;
let stickToBottom = true;
let lastItems = [];

const cellValue = (item, key, index) => {
  switch (key) {
    case 'state': return '';
    case 'index': return String(index + 1);
    case 'url': return item.url || '';
    case 'client': return clientOf(item);
    case 'method': return (item.req && item.req.method) || '';
    case 'status': return statusText(item);
    case 'code': {
      const code = item.res && item.res.statusCode;
      return code ? String(code) : (item.endTime ? '-' : '');
    }
    case 'type': return contentType(item);
    case 'size': return formatSize((item.res && item.res.size) || 0);
    case 'duration': {
      const d = item.endTime && item.startTime ? item.endTime - item.startTime : null;
      return d == null ? '' : formatTime(d);
    }
    case 'time': return formatClock(item.startTime);
    default: return '';
  }
};

const stateClass = (item) => {
  if (!item.endTime) {
    return 'pendingdot';
  }
  if (isError(item)) {
    return 'errdot';
  }
  return 'okdot';
};

const rowClass = (item) => {
  const classes = ['row'];
  if (store.state.pinned.has(item.id)) {
    classes.push('pinned');
  }
  if (item.id === store.state.selectedId) {
    classes.push('selected');
  }
  if (isError(item)) {
    classes.push('error');
  }
  if (!item.endTime) {
    classes.push('pending');
  }
  if ((item.req && item.req.method) === 'CONNECT') {
    classes.push('tunnel');
  }
  return classes.join(' ');
};

const buildRow = (item, index) => {
  const row = el('div', { class: rowClass(item), dataset: { id: item.id } });
  COLUMNS.forEach((col) => {
    let cell;
    if (col.key === 'state') {
      cell = el('div', { class: 'cell cell-state' }, el('span', { class: `dot ${stateClass(item)}` }));
    } else if (col.key === 'url') {
      // Splitting host / path / query lets the eye land on the endpoint rather
      // than reading one undifferentiated run of text. Tunnels arrive as bare
      // "host:443" with nothing to split, so they stay as they are.
      const raw = item.url || '';
      const url = parseUrl(raw);
      cell = el('div', { class: 'cell cell-url', title: raw });
      // The URL lives in its own box so every row starts at the same x; badges
      // are pushed to the trailing edge instead of shifting the text right.
      const text = el('div', { class: 'u-text' });
      if (url.protocol && url.pathname.startsWith('/')) {
        text.appendChild(el('span', { class: 'u-host', text: `${url.protocol}://${url.host}` }));
        text.appendChild(el('span', { class: 'u-path', text: url.pathname }));
        if (url.search) {
          text.appendChild(el('span', { class: 'u-query', text: url.search }));
        }
      } else {
        text.textContent = raw;
      }
      cell.appendChild(text);
      // Badge whatever the enabled rules do to this request (map, block, ...).
      rules.matches(raw).forEach((tag) => cell.appendChild(el('span', {
        class: `rule-tag rule-${tag.kind}`,
        text: tag.label,
        title: tag.line,
      })));
    } else {
      cell = el('div', { class: `cell cell-${col.key}`, text: cellValue(item, col.key, index) });
    }
    if (col.width) {
      cell.style.flex = `0 0 ${col.width}px`;
    } else {
      cell.style.flex = '1 1 auto';
    }
    row.appendChild(cell);
  });
  row.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
  return row;
};

export const sortState = { key: null, dir: 1 };

export const renderHead = () => {
  headEl.textContent = '';
  COLUMNS.forEach((col) => {
    const arrow = sortState.key === col.key ? (sortState.dir > 0 ? ' ▲' : ' ▼') : '';
    const cell = el('div', {
      class: `cell head-cell cell-${col.key}${sortState.key === col.key ? ' sorted' : ''}`,
      text: `${col.label}${arrow}`,
      onclick: () => {
        if (sortState.key === col.key) {
          sortState.dir = -sortState.dir;
        } else {
          sortState.key = col.key;
          sortState.dir = 1;
        }
        renderHead();
        render();
      },
    });
    if (col.width) {
      cell.style.flex = `0 0 ${col.width}px`;
    } else {
      cell.style.flex = '1 1 auto';
    }
    headEl.appendChild(cell);
  });
};

const paint = () => {
  const items = lastItems;
  sizerEl.style.height = `${items.length * ROW_HEIGHT}px`;
  const scrollTop = scrollEl.scrollTop;
  const height = scrollEl.clientHeight;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const frag = document.createDocumentFragment();
  for (let i = first; i < last; i += 1) {
    frag.appendChild(buildRow(items[i], i));
  }
  rowsEl.textContent = '';
  rowsEl.appendChild(frag);
  $('#list-empty').classList.toggle('hidden', items.length > 0);
};

const sortItems = (items) => {
  const { key, dir } = sortState;
  if (!key || key === 'index') {
    return items;
  }
  const numeric = { status: 1, size: 1, time: 1, started: 1 };
  return items.slice().sort((a, b) => {
    let av;
    let bv;
    if (numeric[key]) {
      const pick = (item) => {
        if (key === 'code') return +((item.res && item.res.statusCode) || 0);
        if (key === 'size') return +((item.res && item.res.size) || 0);
        if (key === 'duration') return (item.endTime || 0) - (item.startTime || 0);
        return item.startTime || 0;
      };
      av = pick(a);
      bv = pick(b);
    } else {
      av = String(cellValue(a, key, 0)).toLowerCase();
      bv = String(cellValue(b, key, 0)).toLowerCase();
    }
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });
};

export const visible = () => lastItems;

export const render = () => {
  lastItems = sortItems(store.visibleItems());
  paint();
  if (stickToBottom) {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }
};

export const scrollToSelected = () => {
  const idx = lastItems.findIndex((i) => i.id === store.state.selectedId);
  if (idx < 0) {
    return;
  }
  const top = idx * ROW_HEIGHT;
  if (top < scrollEl.scrollTop || top + ROW_HEIGHT > scrollEl.scrollTop + scrollEl.clientHeight) {
    scrollEl.scrollTop = top - (scrollEl.clientHeight / 2);
  }
};

export const moveSelection = (delta) => {
  if (!lastItems.length) {
    return;
  }
  const idx = lastItems.findIndex((i) => i.id === store.state.selectedId);
  const next = Math.min(lastItems.length - 1, Math.max(0, (idx < 0 ? 0 : idx + delta)));
  stickToBottom = false;
  store.select(lastItems[next].id);
  scrollToSelected();
};

export const init = () => {
  scrollEl = $('#list-scroll');
  rowsEl = $('#list-rows');
  sizerEl = $('#list-sizer');
  headEl = $('#list-head');
  renderHead();
  scrollEl.addEventListener('scroll', () => {
    const atBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < ROW_HEIGHT;
    stickToBottom = atBottom;
    paint();
  });
  rowsEl.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) {
      return;
    }
    store.select(row.dataset.id);
    ctxmenu.open(e, store.state.sessions.get(row.dataset.id));
  });
  rowsEl.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) {
      return;
    }
    stickToBottom = false;
    store.select(row.dataset.id);
  });
  window.addEventListener('resize', paint);
};
