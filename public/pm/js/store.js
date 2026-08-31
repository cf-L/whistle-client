import * as api from './api.js';
import {
  parseUrl, contentType, isError, clientOf,
} from './util.js';

const listeners = new Set();

export const state = {
  sessions: new Map(),
  order: [],
  endId: '',
  selectedId: null,
  recording: true,
  search: '',
  searchScope: 'url',
  filters: [],
  filterMode: 'AND',
  typeFilter: 'all',
  hostFilter: null,
  appFilter: null,
  scope: 'all',
  pinned: new Set(),
  saved: new Map(),
  sidebarQuery: '',
  collapsedHosts: new Set(),
  page: 'network',
  server: null,
  plugins: {},
  disabledPlugins: {},
  rules: { list: [], enabledCount: 0, defaultRulesIsDisabled: false },
  interceptHttpsConnects: false,
  error: null,
};

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Coalesce updates on a timer rather than rAF: the desktop window is often
// occluded (tray mode, background) and rAF stops firing there.
let scheduled;
export const emit = () => {
  if (scheduled) {
    return;
  }
  scheduled = setTimeout(() => {
    scheduled = null;
    listeners.forEach((fn) => fn(state));
  }, 16);
};

const POLL_INTERVAL = 360;
const MAX_SESSIONS = 20000;

const pendingIds = () => state.order
  .slice(-60)
  .filter((id) => {
    const item = state.sessions.get(id);
    return item && !item.endTime;
  });

const ingest = (payload) => {
  const data = payload && payload.data;
  if (!data) {
    return;
  }
  const { newIds = [], data: items = {} } = data;
  Object.keys(items).forEach((id) => {
    const item = items[id];
    if (!item || typeof item !== 'object') {
      return;
    }
    const prev = state.sessions.get(id);
    state.sessions.set(id, prev ? { ...prev, ...item } : item);
  });
  newIds.forEach((id) => {
    if (items[id] && !state.order.includes(id)) {
      state.order.push(id);
    }
  });
  // Track the last id we actually ingested: whistle returns ids *after*
  // `startTime`, so advancing past an id we never stored would drop it.
  const lastIngested = state.order[state.order.length - 1];
  if (lastIngested) {
    state.endId = lastIngested;
  }
  if (state.order.length > MAX_SESSIONS) {
    const drop = state.order.splice(0, state.order.length - MAX_SESSIONS);
    drop.forEach((id) => state.sessions.delete(id));
  }
};

let timer;
let polling = false;
let clearing = false;
let dataEpoch = 0;

export const poll = async () => {
  if (polling) {
    return;
  }
  if (clearing) {
    clearTimeout(timer);
    timer = setTimeout(poll, POLL_INTERVAL);
    return;
  }
  polling = true;
  const pollEpoch = dataEpoch;
  try {
    const query = {
      startTime: state.recording ? (state.endId || undefined) : -1,
      count: 1000,
      ids: pendingIds().join(','),
    };
    const payload = await api.getData(query);
    // A Clear may complete while this request is in flight. Never allow a
    // response from the previous capture generation to repopulate the list.
    if (pollEpoch !== dataEpoch || clearing) {
      return;
    }
    state.error = null;
    if (payload) {
      ingest(payload);
      state.server = payload.server || state.server;
      state.plugins = payload.plugins || state.plugins;
      state.disabledPlugins = payload.disabledPlugins || {};
      state.interceptHttpsConnects = !!payload.interceptHttpsConnects;
      state.rules = {
        list: payload.list || [],
        enabledCount: payload.enabledCount,
        defaultRulesIsDisabled: payload.defaultRulesIsDisabled,
      };
      state.version = payload.version;
    }
  } catch (e) {
    state.error = e.message;
  } finally {
    polling = false;
    emit();
    timer = setTimeout(poll, POLL_INTERVAL);
  }
};

export const startPolling = () => {
  clearTimeout(timer);
  poll();
};

export const clearSessions = async () => {
  clearing = true;
  dataEpoch += 1;
  state.sessions.clear();
  state.order = [];
  state.selectedId = null;
  state.endId = '';
  emit();
  let clearCursor = '';
  try {
    const payload = await api.getData({ startTime: -2, count: 0 });
    const data = payload && payload.data;
    // Whistle does not delete its ring buffer here. It returns the current
    // tail id, which is the cursor the UI must continue from after Clear.
    clearCursor = data && (data.lastId || data.endId) || '';
  } catch (e) { /* server-side buffer reset is best effort */ }
  // Clear once more in case any synchronous UI action added imported data
  // while the server request was running, then resume from a fresh cursor.
  state.sessions.clear();
  state.order = [];
  state.selectedId = null;
  state.endId = clearCursor;
  clearing = false;
  dataEpoch += 1;
  emit();
  if (!polling) {
    clearTimeout(timer);
    timer = setTimeout(poll, 0);
  }
};

export const setRecording = (on) => {
  state.recording = on;
  emit();
};

export const select = (id) => {
  state.selectedId = id;
  emit();
};

export const setSearch = (text, scope) => {
  state.search = text;
  if (scope) {
    state.searchScope = scope;
  }
  emit();
};

export const addFilter = (filter) => {
  state.filters.push({ enabled: true, ...filter });
  emit();
};

export const removeFilter = (index) => {
  state.filters.splice(index, 1);
  emit();
};

export const toggleFilter = (index) => {
  const f = state.filters[index];
  if (f) {
    f.enabled = f.enabled === false;
    emit();
  }
};

export const clearFilters = () => {
  state.filters = [];
  emit();
};

export const setFilterMode = (mode) => {
  state.filterMode = mode === 'OR' ? 'OR' : 'AND';
  emit();
};

export const setTypeFilter = (type) => {
  state.typeFilter = type;
  emit();
};

export const setHostFilter = (host) => {
  state.hostFilter = host;
  state.appFilter = null;
  state.scope = 'all';
  state.selectedId = null;
  emit();
};

export const setAppFilter = (app) => {
  state.appFilter = app;
  state.hostFilter = null;
  state.scope = 'all';
  state.selectedId = null;
  emit();
};

export const setScope = (scope) => {
  state.scope = scope;
  state.hostFilter = null;
  state.appFilter = null;
  state.selectedId = null;
  emit();
};

export const setSidebarQuery = (text) => {
  state.sidebarQuery = text;
  emit();
};

export const togglePin = (id) => {
  if (state.pinned.has(id)) {
    state.pinned.delete(id);
  } else {
    state.pinned.add(id);
  }
  persistMarks();
  emit();
};

// Saved sessions survive Clear and app restarts; pins are just ids.
export const toggleSaved = (id) => {
  if (state.saved.has(id)) {
    state.saved.delete(id);
  } else {
    const item = state.sessions.get(id);
    if (item) {
      state.saved.set(id, item);
    }
  }
  persistMarks();
  emit();
};

const MARKS_KEY = 'pm-marks';

function persistMarks() {
  try {
    localStorage.setItem(MARKS_KEY, JSON.stringify({
      pinned: Array.from(state.pinned),
      saved: Array.from(state.saved.entries()),
    }));
  } catch (e) { /* private mode */ }
}

export const restoreMarks = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(MARKS_KEY) || '{}');
    (raw.pinned || []).forEach((id) => state.pinned.add(id));
    (raw.saved || []).forEach(([id, item]) => {
      state.saved.set(id, item);
      if (!state.sessions.has(id)) {
        state.sessions.set(id, item);
      }
    });
  } catch (e) { /* ignore malformed storage */ }
};

export const toggleHost = (host) => {
  if (state.collapsedHosts.has(host)) {
    state.collapsedHosts.delete(host);
  } else {
    state.collapsedHosts.add(host);
  }
  emit();
};

export const setPage = (page) => {
  state.page = page;
  emit();
};

const matchesSearch = (item) => {
  const text = state.search.trim().toLowerCase();
  if (!text) {
    return true;
  }
  const negate = text.startsWith('-');
  const needle = negate ? text.slice(1) : text;
  let hay = '';
  switch (state.searchScope) {
    case 'host':
      hay = parseUrl(item.url).host;
      break;
    case 'headers':
      hay = JSON.stringify([(item.req || {}).headers, (item.res || {}).headers]);
      break;
    case 'body':
      hay = `${(item.req || {}).body || ''}${(item.res || {}).body || ''}`;
      break;
    default:
      hay = item.url || '';
  }
  const hit = hay.toLowerCase().includes(needle);
  return negate ? !hit : hit;
};

const fieldValue = (item, field) => {
  const url = parseUrl(item.url);
  switch (field) {
    case 'host': return url.host;
    case 'path': return url.path;
    case 'method': return (item.req && item.req.method) || '';
    case 'status': return String((item.res && item.res.statusCode) || '');
    case 'type': return contentType(item);
    case 'headers': return JSON.stringify([(item.req || {}).headers, (item.res || {}).headers]);
    case 'body': return `${(item.req || {}).body || ''}${(item.res || {}).body || ''}`;
    default: return item.url || '';
  }
};

const matchesOne = (item, filter) => {
  const hay = String(fieldValue(item, filter.field));
  const needle = filter.value;
  switch (filter.op) {
    case 'equals':
      return hay.toLowerCase() === needle.toLowerCase();
    case 'not':
      return !hay.toLowerCase().includes(needle.toLowerCase());
    case 'regex':
      try {
        return new RegExp(needle, 'i').test(hay);
      } catch (e) {
        return false;
      }
    default:
      return hay.toLowerCase().includes(needle.toLowerCase());
  }
};

// Proxyman-style stacked filters: every active rule combined with AND or OR.
const matchesFilters = (item) => {
  // The editor deliberately keeps a blank row at the bottom. It is an input
  // affordance, not a condition: in OR mode `contains('')` would otherwise
  // make every request match.
  const active = state.filters.filter((f) => f.enabled !== false && f.value.trim());
  if (!active.length) {
    return true;
  }
  return state.filterMode === 'OR'
    ? active.some((f) => matchesOne(item, f))
    : active.every((f) => matchesOne(item, f));
};

const TYPE_MATCHERS = {
  http: (item) => parseUrl(item.url).protocol === 'http',
  https: (item) => /^(https|wss)$/.test(parseUrl(item.url).protocol)
    || (item.req && item.req.method) === 'CONNECT',
  ws: (item) => /^wss?$/.test(parseUrl(item.url).protocol),
  json: (item) => contentType(item) === 'JSON',
  form: (item) => /form-urlencoded|multipart/i.test(
    ((item.req && item.req.headers) || {})['content-type'] || '',
  ),
  xml: (item) => contentType(item) === 'XML',
  js: (item) => contentType(item) === 'JS',
  css: (item) => contentType(item) === 'CSS',
  html: (item) => ['HTML', 'Text', 'XML'].includes(contentType(item)),
  image: (item) => ['Image', 'Media', 'Font'].includes(contentType(item)),
  errors: (item) => isError(item),
  slow: (item) => (item.endTime - item.startTime) > 1000,
};

const matchesType = (item) => {
  const filter = state.typeFilter;
  if (filter === 'all') {
    return true;
  }
  const fn = TYPE_MATCHERS[filter];
  return fn ? !!fn(item) : true;
};

const matchesHost = (item) => !state.hostFilter || parseUrl(item.url).host === state.hostFilter;

const matchesApp = (item) => !state.appFilter || clientOf(item) === state.appFilter;

const matchesScope = (item) => {
  if (state.scope === 'pinned') {
    return state.pinned.has(item.id);
  }
  if (state.scope === 'saved') {
    return state.saved.has(item.id);
  }
  return true;
};

export const visibleItems = () => state.order
  .map((id) => state.sessions.get(id))
  .filter((item) => item && matchesScope(item) && matchesHost(item) && matchesApp(item)
    && matchesType(item) && matchesSearch(item) && matchesFilters(item));

// Sidebar facets describe the captured traffic set. Text/stacked filters only
// narrow the request table; applying them to the facets can make a known app
// disappear and leave only a tunnel/IP fallback.
const passesSidebarBase = (item) => item && matchesScope(item);

export const appTree = () => {
  const map = new Map();
  state.order.forEach((id) => {
    const item = state.sessions.get(id);
    if (!passesSidebarBase(item)) {
      return;
    }
    const name = clientOf(item);
    let node = map.get(name);
    if (!node) {
      node = {
        name, count: 0, errors: 0, hosts: new Set(),
      };
      map.set(name, node);
    }
    node.count += 1;
    node.hosts.add(parseUrl(item.url).host);
    if (isError(item)) {
      node.errors += 1;
    }
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
};

export const hostTree = () => {
  const map = new Map();
  state.order.forEach((id) => {
    const item = state.sessions.get(id);
    if (!passesSidebarBase(item)) {
      return;
    }
    const { host } = parseUrl(item.url);
    let node = map.get(host);
    if (!node) {
      node = {
        host, count: 0, errors: 0, bytes: 0, items: [],
      };
      map.set(host, node);
    }
    node.count += 1;
    if (isError(item)) {
      node.errors += 1;
    }
    node.bytes += ((item.res && item.res.size) || 0);
    node.items.push(item);
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
};

export const selected = () => (state.selectedId ? state.sessions.get(state.selectedId) : null);
