export const $ = (sel, ctx) => (ctx || document).querySelector(sel);
export const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

export const el = (tag, attrs, children) => {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) {
      return;
    }
    if (k === 'class') {
      node.className = v;
    } else if (k === 'text') {
      node.textContent = v;
    } else if (k === 'html') {
      node.innerHTML = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else {
      node.setAttribute(k, v);
    }
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === undefined || c === null || c === false) {
      return;
    }
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
};

export const escapeHtml = (str) => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const parseUrl = (url) => {
  try {
    const u = new URL(url);
    return {
      protocol: u.protocol.replace(':', ''),
      host: u.host,
      hostname: u.hostname,
      path: `${u.pathname}${u.search}` || '/',
      pathname: u.pathname,
      search: u.search,
    };
  } catch (e) {
    const m = /^(\w+):\/\/([^/]+)(\/.*)?$/.exec(url || '');
    if (m) {
      return {
        protocol: m[1], host: m[2], hostname: m[2].split(':')[0], path: m[3] || '/', pathname: m[3] || '/', search: '',
      };
    }
    return {
      protocol: '', host: url || '', hostname: url || '', path: '', pathname: '', search: '',
    };
  }
};

export const formatSize = (n) => {
  if (n == null || Number.isNaN(+n)) {
    return '';
  }
  const size = +n;
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

export const formatTime = (ms) => {
  if (ms == null || Number.isNaN(+ms)) {
    return '';
  }
  return +ms < 1000 ? `${Math.round(+ms)} ms` : `${(+ms / 1000).toFixed(2)} s`;
};

export const formatClock = (ts) => {
  if (!ts) {
    return '';
  }
  const d = new Date(+ts);
  const p = (v, n = 2) => String(v).padStart(n, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const TYPE_MAP = [
  [/json/i, 'JSON'],
  [/javascript|ecmascript/i, 'JS'],
  [/css/i, 'CSS'],
  [/html/i, 'HTML'],
  [/xml/i, 'XML'],
  [/image\//i, 'Image'],
  [/font|woff|ttf/i, 'Font'],
  [/audio|video/i, 'Media'],
  [/protobuf|grpc/i, 'gRPC'],
  [/text\//i, 'Text'],
];

export const contentType = (item) => {
  const headers = (item.res && item.res.headers) || {};
  const raw = headers['content-type'] || '';
  if (!raw) {
    if (item.req && item.req.method === 'CONNECT') {
      return 'Tunnel';
    }
    return '';
  }
  const found = TYPE_MAP.find(([re]) => re.test(raw));
  return found ? found[1] : raw.split(';')[0];
};

// Best-effort client app name: whistle only sees the request, so fall back
// from an explicit client header to the User-Agent product token, then to IP.
const UA_PRODUCT = /^([A-Za-z][\w .+-]*?)[/ ]\d/;
const KNOWN_UA = [
  [/electron/i, 'Electron'],
  [/chrome\//i, 'Chrome'],
  [/firefox\//i, 'Firefox'],
  [/safari\//i, 'Safari'],
  [/curl\//i, 'curl'],
  [/wget/i, 'Wget'],
  [/python-requests/i, 'Python'],
  [/okhttp/i, 'OkHttp'],
  [/postman/i, 'Postman'],
  [/node(?:js)?[/ ]/i, 'Node.js'],
  [/cfnetwork|darwin/i, 'CFNetwork'],
];

export const clientOf = (item) => {
  const headers = (item.req && item.req.headers) || {};
  const explicit = Object.keys(headers).find((k) => k.startsWith('x-whistle-client-info'));
  if (explicit && headers[explicit]) {
    const raw = String(headers[explicit]).split('|')[0].trim();
    // Whistle's private client-info header normally contains a network tuple
    // (client IP/port and remote IP/port), not an application name. Treating
    // that tuple as a name masks useful identifiers such as lazyaudio in UA.
    const networkTuple = raw.split(',');
    const isInternalTuple = networkTuple.length >= 2
      && networkTuple.every((part, index) => (index % 2 ? /^\d*$/.test(part.trim()) : true));
    if (raw && !isInternalTuple) {
      return raw;
    }
  }
  const ua = headers['user-agent'] || '';
  if (ua) {
    const m = UA_PRODUCT.exec(ua.trim());
    if (m && !/^mozilla$/i.test(m[1])) {
      return m[1];
    }
    const known = KNOWN_UA.find(([re]) => re.test(ua));
    if (known) {
      return known[1];
    }
  }
  return (item.req && item.req.ip) || 'Unknown';
};

export const statusText = (item) => {
  if (!item.endTime) {
    return 'Pending';
  }
  const code = item.res && item.res.statusCode;
  if (!code) {
    return 'Failed';
  }
  return 'Completed';
};

export const statusOf = (item) => {
  const code = item.res && item.res.statusCode;
  if (code) {
    return code;
  }
  if (item.res && item.res.statusCode === 0) {
    return 'aborted';
  }
  return item.endTime ? 'error' : 'pending';
};

export const durationOf = (item) => {
  if (item.endTime && item.startTime) {
    return item.endTime - item.startTime;
  }
  return null;
};

export const isError = (item) => {
  const code = +statusOf(item);
  return code >= 400 || statusOf(item) === 'error';
};

export const debounce = (fn, wait) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

export const copyText = async (text) => {
  const value = String(text == null ? '' : text);
  try {
    // The modern UI runs with Node integration inside Electron. Its native
    // clipboard is reliable even though the page itself is served over HTTP.
    // eslint-disable-next-line global-require
    const { clipboard } = require('electron');
    clipboard.writeText(value);
    return true;
  } catch (e) { /* plain browser */ }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (e) { /* use legacy browser fallback */ }
  try {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    return copied;
  } catch (e) { return false; }
};

export const decodeBody = (body, base64) => {
  if (base64) {
    try {
      const bin = atob(base64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (e) { /* fall through */ }
  }
  return typeof body === 'string' ? body : '';
};

export const toHex = (base64) => {
  if (!base64) {
    return '';
  }
  let bytes;
  try {
    const bin = atob(base64);
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch (e) {
    return '';
  }
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, (b) => ((b >= 32 && b < 127) ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`);
  }
  return lines.join('\n');
};
