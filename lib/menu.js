const path = require('path');
const {
  Menu, app, Tray, shell, nativeImage, BrowserWindow, nativeTheme,
} = require('electron');
const setContextMenu = require('electron-context-menu');
const installRootCAFile = require('whistle/bin/ca');
const { version } = require('../package.json');
const {
  isEnabled, enableProxy, disableProxy, setEnabled, getTitle,
} = require('./proxy');
const { showMessageBox } = require('./dialog');
const {
  getJson, getString, requireW2, LOCALHOST, TRAY_ICON,
  sudoPrompt,
  getDownloadUrl,
  PKG_URL,
  CHANGELOG_URL,
  REPO_URL,
  isMac,
  isWin,
  canHideToTray,
} = require('./util');
const { getOptions, sendMsg, getWin } = require('./context');
const { restart, showWindow } = require('./window');
const { showSettings, getSettings } = require('./settings');
const storage = require('./storage');
const {
  isModernUI, setVariant, MODERN, LEGACY,
} = require('./theme');

const { getServerProxy } = requireW2('set-global-proxy');

let updateTrayMenus;
let rulesConfig;
let isSettingProxy;
let updateCheckbox;
const INTERVAL = 5000;
let tray; // 防止被 GC https://github.com/amhoho/electron-cn-docs/blob/master/faq.md
const APP_NAME = 'Whistle';
const ICON_SIZE = { width: 15 };
const SEPARATOR_MENU = { type: 'separator' };
let firstShow = isWin && storage.getProperty('hideToTray');
const showRepo = () => {
  shell.openExternal(REPO_URL);
};
const PATH_SEP_RE = /[\\/]/;
const getTheme = () => (nativeTheme.shouldUseDarkColors ? 'dark/' : '');
let theme = getTheme();
const iconCache = {};
const getIcon = (name) => {
  if (!PATH_SEP_RE.test(name)) {
    name = path.join(__dirname, `../public/${theme}${name}`);
  }
  let icon = iconCache[name];
  if (!icon) {
    icon = nativeImage.createFromPath(name).resize(ICON_SIZE);
    iconCache[name] = icon;
  }
  return icon;
};
const createIcons = () => ({
  settings: getIcon('settings.png'),
  uncheck: getIcon('uncheck.png'),
  checked: getIcon('checked.png'),
  cert: getIcon('cert.png'),
  update: getIcon('update.png'),
  network: getIcon('network.png'),
  rules: getIcon('rules.png'),
  values: getIcon('values.png'),
  plugins: getIcon('plugins.png'),
});
let icons = createIcons();

const showWinX = (name) => {
  showWindow(name);
  if (firstShow) {
    firstShow = false;
    setTimeout(showWindow, 100);
  }
};

const RESTART_MENU = {
  label: 'Restart',
  accelerator: 'CommandOrControl+Shift+R',
  click: restart,
};
const QUIT_MENU = {
  label: 'Quit',
  accelerator: 'CmdOrCtrl+Q',
  role: 'quit',
};
const EDIT_MENU = {
  label: 'Edit',
  submenu: [
    {
      label: 'Undo',
      accelerator: 'CmdOrCtrl+Z',
      role: 'undo',
    },
    {
      label: 'Redo',
      accelerator: 'Shift+CmdOrCtrl+Z',
      role: 'redo',
    },
    SEPARATOR_MENU,
    {
      label: 'Cut',
      accelerator: 'CmdOrCtrl+X',
      role: 'cut',
    },
    {
      label: 'Copy',
      accelerator: 'CmdOrCtrl+C',
      role: 'copy',
    },
    {
      label: 'Paste',
      accelerator: 'CmdOrCtrl+V',
      role: 'paste',
    },
    {
      label: 'Select All',
      accelerator: 'CmdOrCtrl+A',
      click(_, win) {
        // The modern UI scopes the selection to the pane being read; selecting
        // the whole document there hands back the entire chrome as text.
        if (isModernUI() && win && !win.isDestroyed()) {
          return win.webContents.send('ui-select-all');
        }
        return win && win.webContents.selectAll();
      },
    },
    SEPARATOR_MENU,
    {
      label: 'Help',
      click: showRepo,
    },
  ],
};

setContextMenu({
  showSelectAll: true,
  showSaveImageAs: true,
  showLookUpSelection: false,
  showSearchWithGoogle: false,
  showLearnSpelling: false,
  showCopyLink: false,
  showInspectElement: false,
});
Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
    label: APP_NAME,
    submenu: [RESTART_MENU, QUIT_MENU],
  },
  EDIT_MENU,
]));

let curTitle;
const getEnabledRules = () => {
  if (!rulesConfig) {
    return '';
  }
  const list = rulesConfig.list.filter(rule => rule.selected);
  const result = [
    '',
    `Plugins: ${rulesConfig.pluginsDisabled ? 'OFF' : 'ON'}`,
    `Rules: ${rulesConfig.disabled ? 'OFF' : `ON (${list.length})`}`,
  ];
  list.forEach((item) => {
    result.push(`✅ ${item.name}`);
  });
  return `${result.join('\n')}`;
};

const updateTitle = (force) => {
  let title = getTitle();
  if (!force && title === curTitle) {
    return;
  }
  curTitle = title;
  title = `${title}${getEnabledRules()}`;
  const win = getWin();
  try {
    if (win) {
      win.setTitle(title);
    }
    if (tray) {
      tray.setToolTip(title);
    }
  } catch (e) {}
};

const setStartAtLogin = (startAtLogin) => {
  if (!app.isPackaged) {
    return;
  }
  startAtLogin = !!startAtLogin;
  try {
    app.setLoginItemSettings({ openAtLogin: startAtLogin });
  } catch (e) {}
};

const setAllWindowsVisible = (visible) => {
  try {
    BrowserWindow.getAllWindows().forEach(win => {
      try {
        if (visible) {
          win.show();
        } else {
          win.hide();
        }
      } catch (e) {}
    });
  } catch (e) {}
};

const hideToTrayMenu = {
  label: 'Hide To Tray',
  type: 'checkbox',
  click() {
    setHideToTray(!storage.getProperty('hideToTray')); // eslint-disable-line
  },
};

const modernUiMenu = {
  label: 'Modern UI',
  type: 'checkbox',
  click() {
    setModernUi(!isModernUI()); // eslint-disable-line
  },
};

const hideDockMenu = {
  label: 'Hide In Dock',
  type: 'checkbox',
  click() {
    setHideInDock(!storage.getProperty('hideFromDock')); // eslint-disable-line
  },
};

const setHideToTray = (hide) => {
  if (!canHideToTray) {
    return;
  }
  if (hide === undefined) {
    hide = storage.getProperty('hideToTray');
  }
  if (hide) {
    setAllWindowsVisible(false);
  } else {
    showWinX();
  }
  if (updateCheckbox) {
    updateCheckbox(hideToTrayMenu, hide);
    storage.setProperty('hideToTray', hide);
  }
};

const setModernUi = (enabled) => {
  if (enabled === undefined) {
    enabled = isModernUI();
  } else {
    enabled = !!enabled;
    setVariant(enabled ? MODERN : LEGACY);
    const win = getWin();
    if (win && !win.isDestroyed()) {
      win.webContents.send('ui-variant', enabled ? MODERN : LEGACY);
      const url = win.webContents.getURL();
      const next = enabled
        ? url.replace(/^(https?:\/\/[^/]+)\/(?!pm\/)/, '$1/pm/')
        : url.replace(/^(https?:\/\/[^/]+)\/pm\//, '$1/');
      win.loadURL(next);
    }
  }
  if (updateCheckbox) {
    updateCheckbox(modernUiMenu, enabled);
  }
};

const setHideInDock = (hide) => {
  if (!isMac || !app.dock) {
    return;
  }
  if (hide === undefined) {
    hide = storage.getProperty('hideFromDock');
  }
  hide = !!hide;
  if (hide) {
    app.dock.hide();
  } else {
    app.dock.show();
  }
  if (updateCheckbox) {
    updateCheckbox(hideDockMenu, hide);
    storage.setProperty('hideFromDock', hide);
  }
};

setHideToTray();
// Info.plist no longer marks the app as LSUIElement, so "Hide In Dock" is the
// only thing deciding whether the Dock icon shows, rather than the two of them
// disagreeing. It has to wait for the Dock to exist: menu.js is required from
// fork.js long before the app is ready.
app.whenReady().then(setHideInDock);

exports.create = async () => {
  let trayRulesMenu = [];

  updateTrayMenus = () => {
    if (rulesConfig) {
      trayRulesMenu = [];
      const { disabled, pluginsDisabled } = rulesConfig;
      trayRulesMenu.push(
        SEPARATOR_MENU,
        {
          label: 'All Plugins',
          icon: pluginsDisabled ? icons.uncheck : icons.checked,
          click: () => {
            sendMsg({ type: pluginsDisabled ? 'enableAllPlugins' : 'disableAllPlugins' });
          },
        },
        SEPARATOR_MENU,
        {
          label: 'All Rules',
          icon: disabled ? icons.uncheck : icons.checked,
          click: () => {
            sendMsg({ type: disabled ? 'enableAllRules' : 'disableAllRules' });
          },
        },
      );
      if (!disabled) {
        rulesConfig.list.forEach((rule) => {
          trayRulesMenu.push({
            label: rule.name,
            icon: rule.selected ? icons.checked : icons.uncheck,
            click: () => {
              sendMsg({
                type: rule.selected ? 'unselectRules' : 'selectRules',
                name: rule.name,
              });
            },
          });
        });
        if (trayRulesMenu.length) {
          trayRulesMenu.splice(4, 0, SEPARATOR_MENU);
        }
      }
    }
    const menus = Menu.buildFromTemplate(trayMenus.concat(trayRulesMenu).concat(EXIT_MENUS));  // eslint-disable-line
    tray.setContextMenu(menus);
    return menus;
  };
  updateCheckbox = (menu, checked) => {
    // Use native checkbox menu items. Bitmap checkboxes looked foreign and do
    // not follow the current macOS appearance, spacing, or accessibility.
    menu.type = 'checkbox';
    menu.checked = !!checked;
    Menu.setApplicationMenu(Menu.buildFromTemplate(menus)); // eslint-disable-line
    updateTrayMenus();
  };
  const updateProxyStatus = () => {
    updateCheckbox(proxyMenu, isEnabled()); // eslint-disable-line
    storage.setProperty('autoSetProxy', isEnabled());
  };
  const enableSystemProxy = async () => {
    isSettingProxy = true;
    try {
      await enableProxy(getSettings());
      updateProxyStatus();
    } catch (e) {}
    isSettingProxy = false;
    updateTitle();
  };

  const disableSystemProxy = async () => {
    try {
      await disableProxy();
      updateProxyStatus();
    } catch (e) {}
    updateTitle();
  };

  const switchSystemProxy = () => {
    if (isEnabled()) {
      disableSystemProxy();
    } else {
      enableSystemProxy();
    }
  };

  const updateStartAtLogin = (startAtLogin) => {
    if (startAtLogin === undefined) {
      startAtLogin = storage.getProperty('startAtLogin');
    }
    startAtLogin = !!startAtLogin;
    setStartAtLogin(startAtLogin);
    updateCheckbox(startMenu, startAtLogin); // eslint-disable-line
    storage.setProperty('startAtLogin', startAtLogin);
  };

  const switchStartAtLogin = () => {
    updateStartAtLogin(!storage.getProperty('startAtLogin'));
  };

  const installRootCA = async () => {
    try {
      const useExceFunc = await installRootCAFile(getOptions().rootCAFile, (cmd) => {
        sudoPrompt(cmd, (err) => {
          if (!err) {
            sendMsg({ type: 'enableCapture' });
          }
        });
      });
      if (!useExceFunc) {
        sendMsg({ type: 'enableCapture' });
      }
    } catch (e) {}
  };

  let checking;
  const checkUpdate = async () => {
    if (checking) {
      return;
    }
    checking = true;
    try {
      const pkg = await getJson(PKG_URL);
      const newVersion = getString(pkg && pkg.version);
      if (!newVersion) {
        return showMessageBox('Network Error', checkUpdate);
      }
      if (version === newVersion) {
        return showMessageBox('Whistle Client is up to date', {
          title: '',
          type: 'info',
        });
      }
      return showMessageBox(`Whistle Client has new version ${newVersion}`, {
        type: 'info',
        title: '',
        buttons: ['Download', 'View CHANGELOG', 'Cancel'],
        callback() {
          shell.openExternal(getDownloadUrl(newVersion));
        },
        showSettings() {
          shell.openExternal(CHANGELOG_URL);
        },
        handleCancel() {},
      });
    } catch (e) {
      showMessageBox(e, checkUpdate);
    } finally {
      checking = false;
    }
  };

  app.on('checkUpdateClient', checkUpdate);

  const proxyMenu = {
    label: 'Set As System Proxy',
    type: 'checkbox',
    accelerator: 'CmdOrCtrl+R',
    click: switchSystemProxy,
  };
  const startMenu = {
    label: 'Start At Login',
    type: 'checkbox',
    click: switchStartAtLogin,
  };
  const createSystemMenus = () => {
    const menus = [
      {
        label: 'Proxy Settings',
        accelerator: 'CommandOrControl+,',
        click: showSettings,
      },
      {
        label: 'Install Root CA',
        click: installRootCA,
      },
      {
        label: 'Check Update',
        click: checkUpdate,
      },
      SEPARATOR_MENU,
      proxyMenu,
      startMenu,
      modernUiMenu,
    ];
    if (canHideToTray) {
      menus.push(hideToTrayMenu);
    }
    if (isMac) {
      menus.push(hideDockMenu);
    }
    return menus;
  };
  const createAppMenus = () => ([
    {
      label: APP_NAME,
      submenu: [
        ...createSystemMenus(),
        SEPARATOR_MENU,
        RESTART_MENU,
        QUIT_MENU,
      ],
    },
    EDIT_MENU,
  ]);
  const createTrayMenus = () => ([
    {
      label: 'Show Main Window',
      click: showWinX,
    },
    {
      label: 'Hide All Windows',
      click() {
        setAllWindowsVisible(false);
      },
    },
    {
      label: 'Show All Windows',
      click() {
        setAllWindowsVisible(true);
      },
    },
    SEPARATOR_MENU,
    {
      label: 'Network',
      icon: icons.network,
      click() {
        showWinX('Network');
      },
    },
    {
      label: 'Rules',
      icon: icons.rules,
      click() {
        showWinX('Rules');
      },
    },
    {
      label: 'Values',
      icon: icons.values,
      click() {
        showWinX('Values');
      },
    },
    {
      label: 'Plugins',
      icon: icons.plugins,
      click() {
        showWinX('Plugins');
      },
    },
    SEPARATOR_MENU,
    ...createSystemMenus(),
  ]);
  const EXIT_MENUS = [
    SEPARATOR_MENU,
    RESTART_MENU,
    QUIT_MENU,
  ];
  let menus = createAppMenus();
  let trayMenus = createTrayMenus();
  const trayIcon = getIcon(TRAY_ICON);
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  if (isWin) {
    tray.on('click', () => {
      tray.popUpContextMenu(updateTrayMenus());
    });
  }
  updateStartAtLogin();
  setHideToTray();
  setHideInDock();
  setModernUi();

  let autoSet = storage.getProperty('autoSetProxy');
  const detectProxy = () => {
    if (isSettingProxy || !isEnabled()) {
      autoSet = false;
      updateTitle();
      return setTimeout(detectProxy, INTERVAL);
    }
    getServerProxy(async (_, proxy) => {
      if (!isSettingProxy && proxy) {
        const settings = getSettings();
        const { http, https } = proxy;
        const { port } = settings;
        const host = settings.host || LOCALHOST;
        if (!http.enabled || !https.enabled || http.host !== host
          || https.host !== host || http.port !== port || https.port !== port) {
          if (autoSet) {
            await enableSystemProxy();
          } else {
            setEnabled(false);
            updateProxyStatus();
          }
        } else {
          autoSet = false;
        }
      } else if (autoSet) {
        await enableSystemProxy();
      }
      updateTitle();
      setTimeout(detectProxy, INTERVAL);
    });
  };
  if (autoSet) {
    setTimeout(async () => {
      await enableSystemProxy();
      setTimeout(detectProxy, 200);
    }, 1000);
  } else {
    setEnabled(false);
    setTimeout(detectProxy, INTERVAL);
  }
  updateTitle();
  nativeTheme.on('updated', () => {
    const curTheme = getTheme();
    if (theme === curTheme) {
      return;
    }
    theme = curTheme;
    icons = createIcons();
    menus = createAppMenus();
    trayMenus = createTrayMenus();
    updateStartAtLogin();
    setHideToTray();
    setHideInDock();
    setModernUi();
    updateProxyStatus();
    updateTrayMenus();
  });
};
exports.updateRules = (rulesConf) => {
  if (rulesConfig && rulesConf && JSON.stringify(rulesConfig) === JSON.stringify(rulesConf)) {
    return;
  }
  rulesConfig = rulesConf;
  updateTitle(true);
  if (updateTrayMenus) {
    updateTrayMenus();
  }
};
