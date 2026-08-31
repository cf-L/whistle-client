import { el } from './util.js';
import * as api from './api.js';
import { openModal } from './tools.js';
import { toast } from './ui.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const headersToText = (item) => {
  const headers = (item && item.req && item.req.headers) || {};
  const names = (item && item.req && item.req.rawHeaderNames) || {};
  return Object.keys(headers)
    .filter((k) => !/^(content-length|proxy-authorization)$/.test(k))
    .map((k) => `${names[k] || k}: ${Array.isArray(headers[k]) ? headers[k].join(', ') : headers[k]}`)
    .join('\n');
};

const textToHeaders = (text) => {
  const out = {};
  (text || '').split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  });
  return out;
};

export const open = (item) => {
  const state = {
    method: (item && item.req && item.req.method) || 'GET',
    url: (item && item.url) || 'https://',
    headers: headersToText(item),
    body: (item && item.req && item.req.body) || '',
  };

  const methodSel = el('select', {
    class: 'tool-input',
    onchange: (e) => { state.method = e.target.value; },
  }, METHODS.map((m) => el('option', { value: m, selected: m === state.method ? 'selected' : null, text: m })));

  const urlInput = el('input', {
    class: 'tool-input grow',
    value: state.url,
    spellcheck: 'false',
    oninput: (e) => { state.url = e.target.value; },
  });

  const headerBox = el('textarea', { class: 'editor mono short', spellcheck: 'false', oninput: (e) => { state.headers = e.target.value; } });
  headerBox.value = state.headers;
  const bodyBox = el('textarea', { class: 'editor mono short', spellcheck: 'false', oninput: (e) => { state.body = e.target.value; } });
  bodyBox.value = state.body;

  const node = el('div', { class: 'composer' }, [
    el('div', { class: 'composer-row' }, [methodSel, urlInput]),
    el('div', { class: 'field-label', text: 'Headers' }),
    headerBox,
    el('div', { class: 'field-label', text: 'Body' }),
    bodyBox,
  ]);

  openModal(item ? 'Replay Request' : 'Compose Request', node, async () => {
    try {
      await api.compose({
        url: state.url,
        method: state.method,
        headers: JSON.stringify(textToHeaders(state.headers)),
        body: state.body || '',
      });
      toast('Request sent');
    } catch (e) {
      toast(`Send failed: ${e.message}`);
    }
  }, 'Sent through whistle so the replayed request is captured like any other.');
};
