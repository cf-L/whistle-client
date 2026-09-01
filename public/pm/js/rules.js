import * as api from './api.js';

// whistle reports which rules matched only in a session's detail payload, which
// is too expensive to fetch per row. The enabled rule text is small and changes
// rarely, so it is parsed here and matched against each URL locally to badge
// the list.

const PROTOCOL = /^([a-zA-Z][\w.+-]*):\/\//;

// operator -> the badge it earns. Only the ones worth calling out are listed;
// anything else matched still shows as a generic rule.
const KINDS = [
  [/^x?(file|tpl|rawfile)$/, 'map', 'Map Local'],
  [/^(statusCode|resStatus)$/, 'block', 'Blocked'],
  [/^(resSpeed|reqSpeed|resDelay|reqDelay)$/, 'slow', 'Throttled'],
  [/^(proxy|xproxy|socks|xsocks|http-proxy|https-proxy|internal-proxy)$/, 'proxy', 'Proxy'],
  [/^(host|xhost)$/, 'host', 'Host'],
  [/^(disable|ignore|filter|enable)$/, 'off', 'Disabled'],
  [/^(replace|resBody|reqBody|resHeaders|reqHeaders|resReplace|reqReplace|resMerge|reqMerge)$/, 'edit', 'Modified'],
];

let entries = [];

const kindOf = (protocol) => {
  const hit = KINDS.find(([re]) => re.test(protocol));
  return hit ? { kind: hit[1], label: hit[2] } : { kind: 'rule', label: protocol };
};

// A pattern is whatever token is not an operator; whistle accepts either order.
const parseLine = (line) => {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }
  const ops = [];
  let pattern = '';
  tokens.forEach((token) => {
    const protocol = PROTOCOL.exec(token);
    if (protocol && !/^(https?|ws|wss)$/i.test(protocol[1])) {
      ops.push(protocol[1]);
    } else if (!pattern) {
      pattern = token;
    }
  });
  if (!pattern || !ops.length) {
    return null;
  }
  return { pattern, ops, line };
};

const toMatcher = (pattern) => {
  const wrapped = /^\/(.*)\/([a-z]*)$/.exec(pattern);
  if (wrapped) {
    try {
      const re = new RegExp(wrapped[1], wrapped[2]);
      return (url) => re.test(url);
    } catch (e) {
      return () => false;
    }
  }
  if (pattern.includes('*')) {
    const source = pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    try {
      const re = new RegExp(source);
      return (url) => re.test(url);
    } catch (e) {
      return () => false;
    }
  }
  // Bare patterns match by prefix, with or without the protocol.
  const bare = pattern.replace(PROTOCOL, '');
  return (url) => url.startsWith(pattern) || url.replace(PROTOCOL, '').startsWith(bare);
};

export const parse = (list) => {
  entries = [];
  (list || []).forEach((rule) => {
    if (!rule || !rule.selected || !rule.data) {
      return;
    }
    rule.data.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) {
        return;
      }
      const parsed = parseLine(line);
      if (parsed) {
        entries.push({ ...parsed, match: toMatcher(parsed.pattern), rule: rule.name });
      }
    });
  });
  return entries;
};

// Returns [{ kind, label, line }] for the badges a URL earns, deduped by kind.
export const matches = (url) => {
  if (!url || !entries.length) {
    return [];
  }
  const seen = new Set();
  const out = [];
  entries.forEach((entry) => {
    if (!entry.match(url)) {
      return;
    }
    entry.ops.forEach((op) => {
      const { kind, label } = kindOf(op);
      if (seen.has(kind)) {
        return;
      }
      seen.add(kind);
      out.push({ kind, label, line: entry.line });
    });
  });
  return out;
};

export const refresh = async () => {
  try {
    const res = await api.rulesList();
    parse(res && res.list);
  } catch (e) { /* keep the previous set */ }
};
