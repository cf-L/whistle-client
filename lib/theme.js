const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const { getWin } = require('./context');

const THEME_KEY = 'uiTheme';
const UI_KEY = 'uiVariant';
const MODERN = 'modern';
const LEGACY = 'legacy';
const PROXYMAN = 'proxyman';
const CLASSIC = 'classic';
const CSS_FILE = path.join(__dirname, '../public/theme/proxyman.css');

let css;
let bound;

const getCss = () => {
  if (css == null) {
    try {
      css = fs.readFileSync(CSS_FILE, 'utf8');
    } catch (e) {
      css = '';
    }
  }
  return css;
};

const getTheme = () => (storage.getProperty(THEME_KEY) === CLASSIC ? CLASSIC : PROXYMAN);

const isProxymanTheme = () => getTheme() === PROXYMAN;

const getVariant = () => (storage.getProperty(UI_KEY) === LEGACY ? LEGACY : MODERN);

const isModernUI = () => getVariant() === MODERN;

const getContents = () => {
  const win = getWin();
  if (!win || win.isDestroyed()) {
    return null;
  }
  return win.webContents;
};

const STYLE_ID = 'whistle-proxyman-theme';

// whistle's own stylesheets are appended by style-loader when the bundle runs,
// so the skin has to be appended *after* that to win same-specificity ties.
const applyTheme = async () => {
  const contents = getContents();
  if (!contents) {
    return;
  }
  const style = isProxymanTheme() && !isModernUI() ? getCss() : '';
  const code = `(function(id, css) {
    var el = document.getElementById(id);
    if (!css) {
      if (el) { el.parentNode.removeChild(el); }
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      el.type = 'text/css';
    }
    el.textContent = css;
    document.head.appendChild(el);
  })(${JSON.stringify(STYLE_ID)}, ${JSON.stringify(style)});`;
  try {
    await contents.executeJavaScript(code);
  } catch (e) {}
};

// The style tag is dropped on every navigation/reload, so re-apply it each time
// the whistle page finishes loading.
const bind = () => {
  const contents = getContents();
  if (!contents || bound === contents) {
    return;
  }
  bound = contents;
  contents.on('did-finish-load', applyTheme);
};

// The modern UI is served by lib/ui-middleware.js through whistle's own web
// server, so it shares an origin (and therefore a session) with /cgi-bin.
const getStartUrl = ({ authorization, dockToBottom, version }) => {
  const base = 'http://local.whistlejs.com';
  if (isModernUI()) {
    const frameless = process.platform === 'darwin' ? '&frameless=1' : '';
    return `${base}/pm/?authorization=${authorization}&mode=client&v=${version}${frameless}`;
  }
  return `${base}/?authorization=${authorization}${dockToBottom}&mode=client&v=${version}`;
};

exports.UI_KEY = UI_KEY;
exports.MODERN = MODERN;
exports.LEGACY = LEGACY;
exports.isModernUI = isModernUI;
exports.getStartUrl = getStartUrl;

exports.setVariant = (name) => {
  storage.setProperty(UI_KEY, name === LEGACY ? LEGACY : MODERN);
};

exports.THEME_KEY = THEME_KEY;
exports.PROXYMAN = PROXYMAN;
exports.CLASSIC = CLASSIC;
exports.isProxymanTheme = isProxymanTheme;
exports.bind = bind;
exports.applyTheme = applyTheme;

exports.setTheme = (name) => {
  storage.setProperty(THEME_KEY, name === CLASSIC ? CLASSIC : PROXYMAN);
  return applyTheme();
};

exports.toggleTheme = () => exports.setTheme(isProxymanTheme() ? CLASSIC : PROXYMAN);
