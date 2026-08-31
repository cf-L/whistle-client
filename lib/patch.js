const { globalShortcut, BrowserWindow } = require('electron');

const FIND_KEY = 'CommandOrControl+F';

const callbacks = {};

// find-bar registers a global Escape whenever the main window is focused, which
// swallows the key before the page ever sees it. The modern UI needs Escape for
// its own filter bar, so hand the key to the renderer while it is showing.
const routeEscapeToModernUI = () => {
  let modern = false;
  try {
    modern = require('./theme').isModernUI(); // eslint-disable-line global-require
  } catch (e) {
    return false;
  }
  if (!modern) {
    return false;
  }
  const win = BrowserWindow.getFocusedWindow();
  // The settings window and the find bar keep owning Escape themselves.
  /* eslint-disable-next-line no-underscore-dangle */
  if (!win || win.isDestroyed() || win.isSettingsWin || win._isFindBar) {
    return false;
  }
  win.webContents.send('ui-escape');
  return true;
};

const { register, unregister } = globalShortcut;

globalShortcut.register = function (name, callback) {
  if (typeof callback !== 'function') {
    return;
  }
  // find-bar claims CommandOrControl+F globally, which would swallow the modern
  // UI's own filter shortcut. Route the key to whichever UI is showing.
  if (name === FIND_KEY) {
    return register.call(this, name, function (...args) {
      let modern = false;
      try {
        modern = require('./theme').isModernUI(); // eslint-disable-line global-require
      } catch (e) {}
      if (!modern) {
        return callback.apply(this, args);
      }
      const win = BrowserWindow.getFocusedWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('open-filter');
      }
      return undefined;
    });
  }
  if (name !== 'ESC') {
    return register.call(this, name, callback);
  }
  const list = callbacks[name] || (callbacks[name] = []);
  const index = list.indexOf(callback);
  if (index === -1) {
    list.push(callback);
    register.call(this, name, function (...args) {
      if (routeEscapeToModernUI()) {
        return;
      }
      const cb = list.pop();
      if (cb) {
        cb.apply(this, args);
      }
    });
  } else {
    list.splice(index, 1);
    list.push(callback);
  }
};

globalShortcut.unregister = function (name, callback) {
  if (name !== 'ESC') {
    return unregister.call(this, name);
  }
  const list = callbacks[name];
  if (list) {
    const index = list.indexOf(callback);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }
  if (!list || !list.length) {
    unregister.call(this, name);
    delete callbacks[name];
  }
};
