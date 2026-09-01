import {
  el, parseUrl, copyText, decodeBody,
} from './util.js';
import * as api from './api.js';
import * as store from './store.js';
import * as composer from './composer.js';
import * as tools from './tools.js';
import { toast } from './ui.js';

let node;

export const close = () => {
  if (node) {
    node.remove();
    node = null;
  }
};

export const isOpen = () => !!node;

document.addEventListener('click', close);

export const toCurl = (item) => {
  const headers = (item.req && item.req.headers) || {};
  const names = (item.req && item.req.rawHeaderNames) || {};
  const parts = [`curl -X ${(item.req && item.req.method) || 'GET'} '${item.url}'`];
  Object.keys(headers).forEach((k) => {
    if (/^(content-length|proxy-authorization)$/.test(k)) {
      return;
    }
    const value = Array.isArray(headers[k]) ? headers[k].join(', ') : headers[k];
    parts.push(`  -H '${names[k] || k}: ${String(value).replace(/'/g, "'\\''")}'`);
  });
  if (item.req && item.req.body) {
    parts.push(`  --data-raw '${String(item.req.body).replace(/'/g, "'\\''")}'`);
  }
  return parts.join(' \\\n');
};

// Tools own delimited blocks in the shared rule file; appending from the
// context menu reuses the exact same format.
const appendToolRule = async (id, line) => {
  const BEGIN = `# >>> ${id} (managed by Modern UI, do not edit) >>>`;
  const END = `# <<< ${id} <<<`;
  let text = '';
  try {
    const res = await api.get('rules/value', { name: 'Modern UI Tools' });
    text = (res && res.value && res.value.value) || '';
  } catch (e) { /* new file */ }
  const b = text.indexOf(BEGIN);
  const e2 = text.indexOf(END);
  if (b >= 0 && e2 >= 0) {
    const body = text.slice(b + BEGIN.length, e2).trim();
    text = `${text.slice(0, b)}${BEGIN}\n${body}\n${line}\n${END}${text.slice(e2 + END.length)}`;
  } else {
    text = `${text.trim()}\n\n${BEGIN}\n${line}\n${END}`.trim();
  }
  await api.rulesAdd({ name: 'Modern UI Tools', value: text, selected: true });
  toast('Rule added');
};

const copy = async (text) => {
  toast(await copyText(text) ? 'Copied' : 'Copy failed');
};

const copyResponseBody = async (item) => {
  let response = item.res || {};
  try {
    const result = await api.getSession([item.id], [item.id]);
    const session = result && (result[item.id] || (result.data && result.data[item.id]));
    response = (session && session.res) || response;
  } catch (e) { /* use the body already present in the session list */ }
  return copy(decodeBody(response.body, response.base64));
};

// Generic menu, used where there is no session behind the click (a body pane).
export const openMenu = (event, actions) => {
  event.preventDefault();
  close();
  node = el('div', { class: 'ctx-menu' }, actions.map(([label, fn]) => (label === '-'
    ? el('div', { class: 'ctx-sep' })
    : el('div', {
      class: 'ctx-item',
      text: label,
      onclick: () => {
        close();
        fn();
      },
    }))));
  document.body.appendChild(node);
  const box = node.getBoundingClientRect();
  node.style.left = `${Math.min(event.clientX, window.innerWidth - box.width - 8)}px`;
  node.style.top = `${Math.min(event.clientY, window.innerHeight - box.height - 8)}px`;
};

export const open = (event, item) => {
  event.preventDefault();
  close();
  const url = parseUrl(item.url);
  const actions = [
    ['Copy URL', () => copy(item.url)],
    ['Copy as cURL', () => copy(toCurl(item))],
    ['Copy Response Body', () => copyResponseBody(item)],
    ['-'],
    [store.state.pinned.has(item.id) ? 'Unpin' : 'Pin', () => store.togglePin(item.id)],
    [store.state.saved.has(item.id) ? 'Remove from Saved' : 'Save', () => store.toggleSaved(item.id)],
    ['-'],
    ['Replay', () => composer.open(item)],
    ['Abort', async () => {
      try {
        await api.abort(item.id);
        toast('Abort sent');
      } catch (e) {
        toast(`Abort failed: ${e.message}`);
      }
    }],
    ['-'],
    ['Filter by this host', () => store.setHostFilter(url.host)],
    ['Block this URL', () => appendToolRule('block', `${item.url} statusCode://403`)],
    ['Map Local…', () => tools.open('map-local', item.url)],
    ['Throttle this host', () => appendToolRule('throttle', `${url.host} resSpeed://200`)],
  ];

  node = el('div', { class: 'ctx-menu' }, actions.map(([label, fn]) => (label === '-'
    ? el('div', { class: 'ctx-sep' })
    : el('div', {
      class: 'ctx-item',
      text: label,
      onclick: () => {
        close();
        fn();
      },
    }))));
  node.style.left = `${Math.min(event.clientX, window.innerWidth - 220)}px`;
  node.style.top = `${Math.min(event.clientY, window.innerHeight - 320)}px`;
  document.body.appendChild(node);
};
