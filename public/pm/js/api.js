// Thin wrapper over whistle's /cgi-bin API. Credentials arrive through the
// query string the desktop shell navigates to and are replayed as a Basic
// Authorization header on every call.
const params = new URLSearchParams(location.search);
const authorization = params.get('authorization') || '';

const headers = () => {
  const h = { Accept: 'application/json' };
  if (authorization) {
    h.Authorization = `Basic ${authorization}`;
  }
  return h;
};

const qs = (obj) => {
  const sp = new URLSearchParams();
  Object.keys(obj || {}).forEach((k) => {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') {
      sp.set(k, v);
    }
  });
  const str = sp.toString();
  return str ? `?${str}` : '';
};

export const get = async (path, query, extraHeaders) => {
  const res = await fetch(`/cgi-bin/${path}${qs(query)}`, {
    headers: { ...headers(), ...(extraHeaders || {}) },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
};

export const post = async (path, body, opts) => {
  const isForm = body instanceof FormData;
  const res = await fetch(`/cgi-bin/${path}`, {
    method: 'POST',
    headers: {
      ...headers(),
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...((opts && opts.headers) || {}),
    },
    credentials: 'same-origin',
    body: isForm ? body : JSON.stringify(body || {}),
  });
  if (!res.ok) {
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
};

export const authQuery = authorization ? `authorization=${encodeURIComponent(authorization)}` : '';

// --- traffic -------------------------------------------------------------
export const getData = (query, filter) => {
  const extra = {};
  if (filter && filter.key && filter.value) {
    extra['x-whistle-filter-key'] = filter.key;
    extra['x-whistle-filter-value'] = encodeURIComponent(filter.value);
  }
  return get('get-data', query, extra);
};

export const getSession = (reqList, resList) => get('get-session', {
  reqList: JSON.stringify(reqList || []),
  resList: JSON.stringify(resList || []),
});

export const getFrames = (query) => get('get-frames', query);
export const abort = (id) => post('abort', { id });
export const compose = (data) => post('composer', data);

// --- rules / values ------------------------------------------------------
export const rulesList = () => get('rules/list');
export const rulesAdd = (data) => post('rules/add', data);
export const rulesRemove = (name) => post('rules/remove', { name });
export const rulesRename = (name, newName) => post('rules/rename', { name, newName });
export const rulesSelect = (name) => post('rules/select', { name });
export const rulesUnselect = (name) => post('rules/unselect', { name });
export const rulesEnableDefault = () => post('rules/enable-default', {});
export const rulesDisableDefault = () => post('rules/disable-default', {});
export const rulesDisableAll = (disabledAllRules) => post('rules/disable-all-rules', { disabledAllRules });

export const valuesList = () => get('values/list');
export const valuesAdd = (data) => post('values/add', data);
export const valuesRemove = (name) => post('values/remove', { name });
export const valuesRename = (name, newName) => post('values/rename', { name, newName });

// --- plugins -------------------------------------------------------------
export const pluginsDisable = (name, disabled) => post('plugins/disable-plugin', { name, disabled });
export const pluginsDisableAll = (disabledAllPlugins) => post('plugins/disable-all-plugins', { disabledAllPlugins });

// --- https / capture -----------------------------------------------------
export const setInterceptHttps = (interceptHttpsConnects) => post('intercept-https-connects', { interceptHttpsConnects });
export const rootCAUrl = `/cgi-bin/rootca${authQuery ? `?${authQuery}` : ''}`;
