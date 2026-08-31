import {
  $, el, parseUrl, formatSize, formatTime, formatClock, contentType, statusOf, decodeBody, toHex, copyText,
} from './util.js';
import * as store from './store.js';
import * as api from './api.js';
import { toast } from './ui.js';

const REQ_TABS = ['Header', 'Query', 'Body', 'Raw', 'Summary'];
const RES_TABS = ['Header', 'JSON Text', 'JSON View', 'Raw', 'Hex', 'Preview', 'Timeline', 'Rules', 'Frames'];
const sideTab = { request: 'Header', response: 'Header' };
const bodyView = { request: 'pretty', response: 'pretty' };
let layout = 'split';
let scrollContext = '';
let lastRenderedItem;
let lastRenderContext = '';
let renderRevision = 0;

export const setLayout = (mode) => {
  layout = mode;
  render();
};
// Where the user dragged the divider between the request and response panes.
// Switching a viewer tab re-renders the whole inspector, so the ratio has to
// live outside the DOM or every tab click would snap the panes back to 50/50.
const splitRatio = { split: 0.5, stack: 0.5 };

const applySplitRatio = (left, mode) => {
  left.style.flex = `0 0 ${splitRatio[mode] * 100}%`;
};

const fullBodies = new Map();
let framesCache = { id: null, list: [] };
const jsonTreeState = new Map();

const treeStateFor = (item, which, mode) => {
  const id = `${item.id}|${which}|${mode}`;
  let state = jsonTreeState.get(id);
  if (!state) {
    state = new Set();
    jsonTreeState.set(id, state);
    // Bound state retained during long capture sessions.
    if (jsonTreeState.size > 200) {
      jsonTreeState.delete(jsonTreeState.keys().next().value);
    }
  }
  return state;
};

const kv = (rows) => {
  const table = el('div', { class: 'kv' });
  rows.forEach(([k, v, cls]) => {
    if (v === undefined || v === null || v === '') {
      return;
    }
    table.appendChild(el('div', { class: `kv-row${cls ? ` ${cls}` : ''}` }, [
      el('div', { class: 'kv-key', text: k }),
      el('div', { class: 'kv-val', text: String(v) }),
    ]));
  });
  return table;
};

// Sections collapse on click so a long header list never buries the body.
const collapsed = new Set(['Inspector:Headers']);

const section = (title, node, actions, key) => {
  const id = key || title;
  const isClosed = collapsed.has(id);
  const bodyWrap = el('div', { class: `section-body${isClosed ? ' closed' : ''}` }, node);
  const caret = el('span', { class: 'section-caret', text: isClosed ? '\u25B8' : '\u25BE' });
  const head = el('div', { class: 'section-title' }, [
    el('span', { class: 'section-label' }, [caret, el('span', { text: title })]),
    actions || null,
  ]);
  head.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) {
      return;
    }
    const nowClosed = bodyWrap.classList.toggle('closed');
    caret.textContent = nowClosed ? '\u25B8' : '\u25BE';
    if (nowClosed) {
      collapsed.add(id);
    } else {
      collapsed.delete(id);
    }
  });
  return el('div', { class: 'section' }, [head, bodyWrap]);
};

const headersOf = (side) => {
  const raw = (side && side.headers) || {};
  const names = (side && side.rawHeaderNames) || {};
  return Object.keys(raw).sort().map((k) => [names[k] || k, Array.isArray(raw[k]) ? raw[k].join('\n') : raw[k]]);
};

const prettyJson = (text) => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (e) {
    return null;
  }
};

const jsonTextView = (text) => {
  const formatted = prettyJson(text) || text;
  const view = el('div', { class: 'json-text-view mono' });
  const tokenRe = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
  formatted.split('\n').forEach((line, index) => {
    const code = el('span', { class: 'json-line-code' });
    let offset = 0;
    let match;
    tokenRe.lastIndex = 0;
    while ((match = tokenRe.exec(line))) {
      code.appendChild(document.createTextNode(line.slice(offset, match.index)));
      const token = match[0];
      const rest = line.slice(match.index + token.length);
      let kind = 'number';
      if (token[0] === '"') {
        kind = /^\s*:/.test(rest) ? 'key' : 'string';
      } else if (token === 'null') {
        kind = 'null';
      } else if (token === 'true' || token === 'false') {
        kind = 'boolean';
      }
      code.appendChild(el('span', { class: `json-token json-${kind}`, text: token }));
      offset = match.index + token.length;
    }
    code.appendChild(document.createTextNode(line.slice(offset)));
    view.appendChild(el('div', { class: 'json-line' }, [
      el('span', { class: 'json-line-no', text: index + 1 }),
      code,
    ]));
  });
  return view;
};

const bodyBlock = (item, which, showModeBar = true) => {
  const side = which === 'request' ? item.req : item.res;
  const full = fullBodies.get(item.id) || {};
  const sideFull = which === 'request' ? full.req : full.res;
  const base64 = (sideFull && sideFull.base64) || (side && side.base64);
  const raw = decodeBody((sideFull && sideFull.body) || (side && side.body), base64);
  const mode = bodyView[which];
  const wrap = el('div', { class: 'body-block' });

  const modes = which === 'response'
    ? [['pretty', 'JSON Text'], ['tree', 'JSON View'], ['raw', 'Raw'], ['hex', 'Hex'], ['preview', 'Preview']]
    : [['pretty', 'Pretty'], ['raw', 'Raw'], ['hex', 'Hex']];
  const bar = el('div', { class: 'seg' }, modes.map(([m, label]) => el('button', {
    class: `seg-btn${mode === m ? ' active' : ''}`,
    text: label,
    onclick: () => {
      bodyView[which] = m;
      render();
    },
  })));
  if (showModeBar) {
    wrap.appendChild(bar);
  }

  if (!raw && !base64) {
    wrap.appendChild(el('div', { class: 'placeholder', text: side && side.size ? 'Body not loaded yet' : 'No body' }));
    return wrap;
  }

  if (mode === 'hex') {
    wrap.appendChild(el('pre', { class: 'code mono', text: toHex(base64) || 'Binary payload unavailable' }));
    return wrap;
  }
  if (mode === 'tree') {
    try {
      wrap.appendChild(jsonTreePanel(JSON.parse(raw), treeStateFor(item, which, mode)));
    } catch (e) {
      wrap.appendChild(el('div', { class: 'placeholder', text: 'Body is not valid JSON' }));
    }
    return wrap;
  }
  if (mode === 'preview') {
    const type = ((side && side.headers && side.headers['content-type']) || '');
    if (/image\//.test(type) && base64) {
      wrap.appendChild(el('img', { class: 'preview-img', src: `data:${type.split(';')[0]};base64,${base64}` }));
      return wrap;
    }
    const pretty = prettyJson(raw);
    if (pretty) {
      wrap.appendChild(jsonTreePanel(JSON.parse(raw), treeStateFor(item, which, mode)));
      return wrap;
    }
    if (/html|xhtml/i.test(type)) {
      wrap.appendChild(el('iframe', {
        class: 'preview-frame',
        sandbox: '',
        srcdoc: raw,
        title: 'Response preview',
      }));
      return wrap;
    }
    if (/^text\//i.test(type) || /xml|javascript/i.test(type)) {
      wrap.appendChild(el('pre', { class: 'code mono preview-text', text: raw }));
      return wrap;
    }
    wrap.appendChild(el('div', { class: 'placeholder', text: 'No preview for this content type' }));
    return wrap;
  }
  if (mode === 'pretty') {
    wrap.appendChild(jsonTextView(raw));
    return wrap;
  }
  wrap.appendChild(el('pre', { class: 'code mono', text: raw }));
  return wrap;
};

const CHEVRON = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

const typeOf = (value) => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
};

// A short stand-in for a folded object, so a collapsed row still says what it
// holds instead of only how many entries it has.
const summarize = (value, entries) => {
  if (Array.isArray(value)) {
    return `[ ${entries.length} ${entries.length === 1 ? 'item' : 'items'} ]`;
  }
  const keys = entries.slice(0, 3).map(([k]) => k).join(', ');
  const more = entries.length > 3 ? ', …' : '';
  return entries.length ? `{ ${keys}${more} }` : '{ }';
};

const leafValue = (value) => {
  const kind = typeOf(value);
  if (kind === 'string') {
    return el('span', { class: 'jt-val jt-string' }, [
      el('span', { class: 'jt-quote', text: '"' }),
      el('span', { text: value }),
      el('span', { class: 'jt-quote', text: '"' }),
    ]);
  }
  return el('span', { class: `jt-val jt-${kind}`, text: String(value) });
};

const jsonTree = (value, key, path = '$', collapsedPaths = new Set()) => {
  const node = el('div', { class: 'jt-node', dataset: { path } });
  const kind = typeOf(value);
  const keyPart = key !== undefined
    ? [el('span', { class: 'jt-key', text: String(key) }), el('span', { class: 'jt-colon', text: ':' })]
    : [];

  if (kind !== 'object' && kind !== 'array') {
    const row = el('div', { class: 'jt-row jt-leaf' }, [
      el('span', { class: 'jt-caret-space' }),
      ...keyPart,
      leafValue(value),
    ]);
    node.appendChild(row);
    node.dataset.text = `${key === undefined ? '' : key} ${String(value)}`.toLowerCase();
    return node;
  }

  const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  const caret = el('span', { class: 'jt-caret', html: CHEVRON });
  const summary = el('span', { class: 'jt-summary', text: summarize(value, entries) });
  const head = el('div', { class: 'jt-row jt-head' }, [
    caret,
    ...keyPart,
    el('span', { class: `jt-badge jt-badge-${kind}`, text: kind === 'array' ? `[${entries.length}]` : `{${entries.length}}` }),
    summary,
  ]);
  const children = el('div', { class: 'jt-children' });
  entries.forEach(([k, v]) => children.appendChild(jsonTree(
    v,
    k,
    `${path}/${encodeURIComponent(String(k))}`,
    collapsedPaths,
  )));

  const setCollapsed = (collapsed) => {
    node.classList.toggle('collapsed', collapsed);
    if (collapsed) {
      collapsedPaths.add(path);
    } else {
      collapsedPaths.delete(path);
    }
  };
  setCollapsed(collapsedPaths.has(path));
  head.addEventListener('click', () => setCollapsed(!node.classList.contains('collapsed')));

  node.appendChild(head);
  node.appendChild(children);
  node.dataset.text = `${key === undefined ? '' : key}`.toLowerCase();
  return node;
};

// Depth-first: a node survives the filter when it matches itself or holds a
// descendant that does, and every surviving branch is expanded so the hit is
// actually on screen.
const filterTree = (node, query) => {
  const own = !query || (node.dataset.text || '').includes(query);
  const kids = [...node.querySelectorAll(':scope > .jt-children > .jt-node')];
  let hit = own;
  kids.forEach((kid) => {
    if (filterTree(kid, query)) {
      hit = true;
    }
  });
  node.classList.toggle('filtered-out', !!query && !hit);
  if (query && hit && kids.length) {
    node.classList.remove('collapsed');
  }
  return hit;
};

const jsonTreePanel = (value, collapsedPaths) => {
  const tree = el('div', { class: 'json-tree' }, jsonTree(value, undefined, '$', collapsedPaths));
  const setCollapsed = (collapsed) => {
    tree.querySelectorAll('.jt-node').forEach((node) => {
      if (!node.querySelector(':scope > .jt-children')) {
        return;
      }
      node.classList.toggle('collapsed', collapsed);
      if (collapsed) {
        collapsedPaths.add(node.dataset.path);
      } else {
        collapsedPaths.delete(node.dataset.path);
      }
    });
  };
  const search = el('input', {
    class: 'viewer-search',
    type: 'search',
    placeholder: 'Filter keys and values',
    spellcheck: 'false',
    oninput: (e) => {
      const query = e.target.value.trim().toLowerCase();
      tree.querySelectorAll(':scope > .jt-node').forEach((node) => filterTree(node, query));
      tree.classList.toggle('filtering', !!query);
    },
  });
  return el('div', { class: 'json-tree-panel' }, [
    el('div', { class: 'viewer-tools' }, [
      el('button', { class: 'viewer-tool', text: 'Expand all', onclick: () => setCollapsed(false) }),
      el('button', { class: 'viewer-tool', text: 'Collapse all', onclick: () => setCollapsed(true) }),
      el('button', {
        class: 'viewer-tool',
        text: 'Copy',
        onclick: async () => {
          const ok = await copyText(JSON.stringify(value, null, 2));
          toast(ok ? 'JSON copied' : 'Could not copy');
        },
      }),
      search,
    ]),
    tree,
  ]);
};

const timelineBlock = (item) => {
  const start = item.startTime;
  const end = item.endTime || Date.now();
  const total = Math.max(1, end - start);
  const phases = [
    ['DNS', item.startTime, item.dnsTime],
    ['Connect', item.dnsTime, item.connectTime],
    ['Request', item.connectTime, item.requestTime],
    ['Waiting', item.requestTime, item.responseTime],
    ['Download', item.responseTime, item.endTime],
  ].filter(([, a, b]) => a && b && b >= a);

  const wrap = el('div', { class: 'timeline' });
  phases.forEach(([name, a, b]) => {
    const left = ((a - start) / total) * 100;
    const width = Math.max(0.5, ((b - a) / total) * 100);
    const bar = el('div', { class: 'tl-bar' });
    const fill = el('div', { class: `tl-fill tl-${name.toLowerCase()}` });
    fill.style.left = `${left}%`;
    fill.style.width = `${width}%`;
    bar.appendChild(fill);
    wrap.appendChild(el('div', { class: 'tl-row' }, [
      el('div', { class: 'tl-name', text: name }),
      bar,
      el('div', { class: 'tl-ms', text: formatTime(b - a) }),
    ]));
  });
  wrap.appendChild(el('div', { class: 'tl-row tl-total' }, [
    el('div', { class: 'tl-name', text: 'Total' }),
    el('div', { class: 'tl-bar' }),
    el('div', { class: 'tl-ms', text: formatTime(end - start) }),
  ]));
  return wrap;
};

const rulesBlock = (item) => {
  const rules = item.rules || {};
  const keys = Object.keys(rules).filter((k) => rules[k]);
  if (!keys.length) {
    return el('div', { class: 'placeholder', text: 'No rule matched this request' });
  }
  return kv(keys.map((k) => {
    const rule = rules[k];
    const text = typeof rule === 'string' ? rule : (rule.rawPattern ? `${rule.rawPattern} ${rule.matcher || ''}` : JSON.stringify(rule));
    return [k, text];
  }));
};

const framesBlock = (item) => {
  const wrap = el('div', { class: 'frames' });
  if (framesCache.id !== item.id) {
    wrap.appendChild(el('div', { class: 'placeholder', text: 'Loading frames…' }));
    api.getFrames({ curReqId: item.id, lastFrameId: -3 }).then((res) => {
      framesCache = { id: item.id, list: (res && res.frames) || [] };
      renderRevision += 1;
      render();
    }).catch(() => {
      framesCache = { id: item.id, list: [] };
      renderRevision += 1;
      render();
    });
    return wrap;
  }
  if (!framesCache.list.length) {
    wrap.appendChild(el('div', { class: 'placeholder', text: 'No WebSocket/Socket frames' }));
    return wrap;
  }
  framesCache.list.forEach((f) => {
    wrap.appendChild(el('div', { class: `frame ${f.isClient ? 'out' : 'in'}` }, [
      el('span', { class: 'frame-dir', text: f.isClient ? '↑' : '↓' }),
      el('span', { class: 'frame-time', text: formatClock(f.startTime) }),
      el('span', { class: 'frame-size', text: formatSize(f.length || 0) }),
      el('pre', { class: 'frame-body mono', text: decodeBody(f.text || f.body, f.base64).slice(0, 4000) }),
    ]));
  });
  return wrap;
};

const inspector = (item) => {
  const left = el('div', { class: 'pane pane-left' }, [
    el('div', { class: 'pane-head' }, [
      el('span', { class: 'pane-title', text: 'Request' }),
      el('span', { class: 'pane-tag', text: (item.req && item.req.method) || '' }),
    ]),
    el('div', { class: 'pane-scroll' }, [
      section('Headers', kv(headersOf(item.req)), null, 'Inspector:Headers'),
      (() => {
        const query = parseUrl(item.url).search;
        if (!query) {
          return null;
        }
        return section('Query', kv(Array.from(new URLSearchParams(query).entries())));
      })(),
      section('Body', bodyBlock(item, 'request')),
    ]),
  ]);

  const statusCode = statusOf(item);
  const right = el('div', { class: 'pane pane-right' }, [
    el('div', { class: 'pane-head' }, [
      el('span', { class: 'pane-title', text: 'Response' }),
      el('span', {
        class: `pane-tag${String(+statusCode) !== 'NaN' && +statusCode >= 400 ? ' bad' : ''}`,
        text: String(statusCode),
      }),
    ]),
    el('div', { class: 'pane-scroll' }, [
      section('Headers', kv(headersOf(item.res)), null, 'Inspector:Headers'),
      section('Body', bodyBlock(item, 'response')),
    ]),
  ]);

  const splitter = el('div', { class: 'vsplit' });
  const wrap = el('div', { class: 'split' }, [left, splitter, right]);
  applySplitRatio(left, 'split');

  // Drag the divider between the request and response panes.
  splitter.addEventListener('mousedown', (down) => {
    down.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const move = (e) => {
      splitRatio.split = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
      applySplitRatio(left, 'split');
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('dragging');
    };
    document.body.classList.add('dragging');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  return wrap;
};

const overview = (item) => {
  const url = parseUrl(item.url);
  const box = el('div', { class: 'detail-scroll' });
  box.appendChild(section('Summary', kv([
    ['URL', item.url],
    ['Method', item.req && item.req.method],
    ['Status', statusOf(item)],
    ['Protocol', `${url.protocol.toUpperCase()}${item.useH2 ? ' / HTTP2' : ` / ${(item.req && item.req.httpVersion) || ''}`}`],
    ['Content-Type', contentType(item)],
    ['Client', `${(item.req && item.req.ip) || ''}:${(item.req && item.req.port) || ''}`],
    ['Server', `${(item.res && item.res.ip) || ''}:${(item.res && item.res.port) || ''}`],
    ['Request Size', formatSize((item.req && item.req.size) || 0)],
    ['Response Size', formatSize((item.res && item.res.size) || 0)],
    ['Started', formatClock(item.startTime)],
    ['TTFB', item.ttfb ? formatTime(item.ttfb) : ''],
    ['Duration', item.endTime ? formatTime(item.endTime - item.startTime) : 'pending'],
  ]), el('button', {
    class: 'link-btn',
    text: 'Copy URL',
    onclick: (e) => {
      e.stopPropagation();
      copyText(item.url);
    },
  })));
  box.appendChild(section('Timeline', timelineBlock(item)));
  return box;
};

const requestPane = (item) => {
  const box = el('div', { class: 'detail-scroll' });
  box.appendChild(section('Headers', kv(headersOf(item.req))));
  const query = parseUrl(item.url).search;
  if (query) {
    const params = Array.from(new URLSearchParams(query).entries());
    box.appendChild(section('Query', kv(params)));
  }
  box.appendChild(section('Body', bodyBlock(item, 'request')));
  return box;
};

const responsePane = (item) => {
  const box = el('div', { class: 'detail-scroll' });
  box.appendChild(section('Headers', kv(headersOf(item.res))));
  const cookies = (item.res && item.res.headers && item.res.headers['set-cookie']) || null;
  if (cookies) {
    box.appendChild(section('Cookies', kv((Array.isArray(cookies) ? cookies : [cookies]).map((c) => [c.split('=')[0], c]))));
  }
  box.appendChild(section('Body', bodyBlock(item, 'response')));
  return box;
};

export const loadFullBody = async (item) => {
  if (!item || fullBodies.has(item.id)) {
    return;
  }
  fullBodies.set(item.id, {});
  try {
    const res = await api.getSession([item.id], [item.id]);
    const data = res && (res[item.id] || (res.data && res.data[item.id]));
    if (data && typeof data === 'object') {
      fullBodies.set(item.id, data);
      renderRevision += 1;
      render();
    }
  } catch (e) { /* body stays lazy */ }
};

const rawText = (item, which) => {
  const side = which === 'request' ? item.req : item.res;
  const full = fullBodies.get(item.id) || {};
  const sideFull = which === 'request' ? full.req : full.res;
  const base64 = (sideFull && sideFull.base64) || (side && side.base64);
  const body = decodeBody((sideFull && sideFull.body) || (side && side.body), base64);
  const url = parseUrl(item.url);
  const names = (side && side.rawHeaderNames) || {};
  const headers = (side && side.headers) || {};
  const lines = [];
  if (which === 'request') {
    lines.push(`${(item.req && item.req.method) || 'GET'} ${url.path} HTTP/${(item.req && item.req.httpVersion) || '1.1'}`);
  } else {
    lines.push(`HTTP/${(item.req && item.req.httpVersion) || '1.1'} ${statusOf(item)} ${(item.res && item.res.statusMessage) || ''}`.trim());
  }
  Object.keys(headers).forEach((k) => {
    const v = Array.isArray(headers[k]) ? headers[k].join(', ') : headers[k];
    lines.push(`${names[k] || k}: ${v}`);
  });
  return `${lines.join('\n')}\n\n${body}`;
};

const summaryPane = (item) => {
  const url = parseUrl(item.url);
  return kv([
    ['URL', item.url],
    ['Method', item.req && item.req.method],
    ['Status', `${statusOf(item)} ${(item.res && item.res.statusMessage) || ''}`.trim()],
    ['Protocol', `${url.protocol.toUpperCase()}${item.useH2 ? ' / HTTP2' : ` / ${(item.req && item.req.httpVersion) || ''}`}`],
    ['Client', `${(item.req && item.req.ip) || ''}:${(item.req && item.req.port) || ''}`],
    ['Server', `${(item.res && item.res.ip) || ''}:${(item.res && item.res.port) || ''}`],
    ['Content-Type', contentType(item)],
    ['Request Size', formatSize((item.req && item.req.size) || 0)],
    ['Response Size', formatSize((item.res && item.res.size) || 0)],
    ['Started', formatClock(item.startTime)],
    ['TTFB', item.ttfb ? formatTime(item.ttfb) : ''],
    ['Duration', item.endTime ? formatTime(item.endTime - item.startTime) : 'pending'],
  ]);
};

// Each side of the inspector owns its own tab strip, Proxyman-style.
const sidePane = (item, which) => {
  const tabs = which === 'request' ? REQ_TABS : RES_TABS;
  const active = sideTab[which];
  const side = which === 'request' ? item.req : item.res;

  const strip = el('div', { class: 'pane-head' }, [
    el('span', { class: 'pane-title', text: which === 'request' ? 'Request' : 'Response' }),
    el('div', { class: 'pane-tabs' }, tabs.map((tab) => el('button', {
      class: `ptab${active === tab ? ' active' : ''}`,
      text: tab,
      onclick: () => {
        sideTab[which] = tab;
        if (which === 'response') {
          const modes = {
            'JSON Text': 'pretty',
            'JSON View': 'tree',
            Raw: 'raw',
            Hex: 'hex',
            Preview: 'preview',
          };
          bodyView.response = modes[tab] || bodyView.response;
        }
        render();
      },
    }))),
  ]);

  let content;
  switch (active) {
    case 'Query': {
      const query = parseUrl(item.url).search;
      content = query
        ? kv(Array.from(new URLSearchParams(query).entries()))
        : el('div', { class: 'placeholder', text: 'No query parameters' });
      break;
    }
    case 'Body':
      content = bodyBlock(item, which);
      break;
    case 'Raw':
      if (which === 'response') {
        content = bodyBlock(item, 'response', false);
      } else {
        content = el('pre', { class: 'code mono', text: rawText(item, which) });
      }
      break;
    case 'Summary':
      content = summaryPane(item);
      break;
    case 'JSON Text':
      content = bodyBlock(item, 'response', false);
      break;
    case 'JSON View':
      content = bodyBlock(item, 'response', false);
      break;
    case 'Hex':
      content = bodyBlock(item, 'response', false);
      break;
    case 'Preview': {
      content = bodyBlock(item, 'response', false);
      break;
    }
    case 'Timeline':
      content = timelineBlock(item);
      break;
    case 'Rules':
      content = rulesBlock(item);
      break;
    case 'Frames':
      content = framesBlock(item);
      break;
    default:
      content = kv(headersOf(side));
  }

  return el('div', { class: `pane pane-${which}` }, [
    strip,
    el('div', { class: 'pane-scroll' }, [
      ['Header', 'Query'].includes(active) ? el('div', { class: 'kv-head' }, [
        el('div', { class: 'kv-key', text: 'Key' }),
        el('div', { class: 'kv-val', text: 'Value' }),
      ]) : null,
      content,
    ]),
  ]);
};

const renderUrlBar = (item) => {
  const bar = $('#url-bar');
  bar.textContent = '';
  if (!item) {
    return;
  }
  const code = item.res && item.res.statusCode;
  const url = parseUrl(item.url);
  bar.appendChild(el('span', { class: 'method-pill', text: (item.req && item.req.method) || '' }));
  bar.appendChild(el('span', {
    class: `code-pill${code && code >= 400 ? ' bad' : ''}${code ? '' : ' idle'}`,
    text: code ? `${code} ${(item.res && item.res.statusMessage) || ''}`.trim() : 'Pending',
  }));
  bar.appendChild(el('span', { class: 'url-text' }, [
    el('span', { class: 'url-origin', text: `${url.protocol}://` }),
    el('span', { class: 'url-host', text: url.host }),
    el('span', { class: 'url-path', text: url.path }),
  ]));
};

export const render = () => {
  const item = store.selected();
  const body = $('#detail-body');
  const renderContext = item
    ? `${item.id}|${sideTab.request}|${sideTab.response}|${bodyView.request}|${bodyView.response}|${layout}|${renderRevision}`
    : '';
  // Polling rebuilds the request list frequently. Keep the inspector DOM when
  // the selected session and viewer state did not change, preventing JSON
  // text/tree views from flickering as unrelated requests arrive.
  if (item === lastRenderedItem && renderContext === lastRenderContext) {
    return;
  }
  const nextScrollContext = item
    ? `${item.id}|${sideTab.request}|${sideTab.response}|${layout}`
    : '';
  const previousScroll = nextScrollContext === scrollContext
    ? Array.from(body.querySelectorAll('.pane-scroll')).map((node) => ({
      top: node.scrollTop,
      left: node.scrollLeft,
    }))
    : [];
  renderUrlBar(item);
  body.textContent = '';
  if (!item) {
    scrollContext = '';
    lastRenderedItem = item;
    lastRenderContext = renderContext;
    body.appendChild(el('div', { class: 'placeholder', text: 'Select a request' }));
    return;
  }
  loadFullBody(item);

  const left = sidePane(item, 'request');
  const right = sidePane(item, 'response');
  const splitter = el('div', { class: layout === 'split' ? 'vsplit' : 'hsplit-inner' });
  const wrap = el('div', { class: `split ${layout}` }, [left, splitter, right]);
  applySplitRatio(left, layout);

  splitter.addEventListener('mousedown', (down) => {
    down.preventDefault();
    const rect = wrap.getBoundingClientRect();
    const move = (e) => {
      const along = layout === 'split'
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
      splitRatio[layout] = Math.min(0.8, Math.max(0.2, along));
      applySplitRatio(left, layout);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('dragging');
    };
    document.body.classList.add('dragging');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  body.appendChild(wrap);
  Array.from(body.querySelectorAll('.pane-scroll')).forEach((node, index) => {
    const position = previousScroll[index];
    if (position) {
      node.scrollTop = position.top;
      node.scrollLeft = position.left;
    }
  });
  scrollContext = nextScrollContext;
  lastRenderedItem = item;
  lastRenderContext = renderContext;
};
