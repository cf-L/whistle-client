const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { app, ipcMain } = require('electron');
const { getOptions } = require('./context');
const { authorization } = require('./settings');
const { LOCALHOST, isWin } = require('./util');

// Capturing from an Android phone over Wi-Fi needs the phone to reach this
// machine, which a corporate access point with client isolation will not allow.
// USB sidesteps the network entirely: `adb reverse` forwards a port on the
// phone back to whistle here, and the phone proxies to its own localhost.

const CERT_ON_DEVICE = '/sdcard/Download/whistle-rootca.crt';
const LOOPBACK = '127.0.0.1';

const CANDIDATES = () => {
  const home = os.homedir();
  const exe = isWin ? 'adb.exe' : 'adb';
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(home, 'Library/Android/sdk'),
    path.join(home, 'Android/Sdk'),
    path.join(home, 'AppData/Local/Android/Sdk'),
  ].filter(Boolean);
  return [
    ...roots.map((root) => path.join(root, 'platform-tools', exe)),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    '/usr/bin/adb',
  ];
};

let adbPath;

const findAdb = () => {
  if (adbPath) {
    return adbPath;
  }
  adbPath = CANDIDATES().find((file) => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return true;
    } catch (e) {
      return false;
    }
  }) || (isWin ? 'adb.exe' : 'adb'); // fall back to PATH
  return adbPath;
};

const run = (args) => new Promise((resolve) => {
  execFile(findAdb(), args, { timeout: 20000 }, (err, stdout, stderr) => {
    resolve({
      ok: !err,
      stdout: (stdout || '').trim(),
      stderr: ((stderr || '') + (err && !stderr ? err.message : '')).trim(),
    });
  });
});

const forDevice = (serial, args) => (serial ? ['-s', serial, ...args] : args);

// `adb shell` does not always report a failing command through the exit code:
// a denied `settings put` prints a Java stack trace and can still exit 0.
const failed = (res) => !res.ok
  || /exception|permission denial|error:/i.test(`${res.stdout} ${res.stderr}`);

// MIUI/HyperOS withhold WRITE_SECURE_SETTINGS from adb unless the separate
// "USB debugging (Security settings)" switch is on, which is what makes the
// global proxy write fail on those phones.
const DENIED = /permission denial|WRITE_SECURE_SETTINGS/i;
const SECURE_SETTINGS_HINT = 'The phone refused the proxy setting: adb has no WRITE_SECURE_SETTINGS. '
  + 'On Xiaomi (MIUI / HyperOS) turn on Developer options → "USB debugging (Security settings)" '
  + 'and try again, or set the proxy by hand: Wi-Fi → Modify network → Proxy → Manual';

// `adb devices -l` lists one device per line after a header; unauthorised and
// offline devices are reported too, and are worth showing rather than hiding.
const devices = async () => {
  const res = await run(['devices', '-l']);
  if (!res.ok) {
    return { error: res.stderr || 'adb not found', list: [] };
  }
  const list = res.stdout.split(/\r?\n/).slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      const model = /model:(\S+)/.exec(line);
      return { serial, state, model: model ? model[1].replace(/_/g, ' ') : '' };
    });
  return { list };
};

const port = () => {
  const options = getOptions() || {};
  return options.uiport || options.port;
};

// The certificate is read back from the running whistle rather than from disk,
// so it always matches the instance the phone is about to trust.
const fetchRootCA = () => new Promise((resolve, reject) => {
  const req = http.get({
    host: LOCALHOST,
    port: port(),
    path: '/cgi-bin/rootca',
    headers: { authorization: `Basic ${authorization}` },
  }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      reject(new Error(`whistle returned ${res.statusCode} for the root certificate`));
      return;
    }
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks)));
  });
  req.on('error', reject);
  req.setTimeout(10000, () => req.destroy(new Error('whistle did not answer')));
});

const pushCert = async (serial) => {
  const cert = await fetchRootCA();
  const local = path.join(os.tmpdir(), 'whistle-rootca.crt');
  fs.writeFileSync(local, cert);
  const res = await run(forDevice(serial, ['push', local, CERT_ON_DEVICE]));
  fs.unlink(local, () => {});
  if (!res.ok) {
    throw new Error(res.stderr || 'could not copy the certificate to the device');
  }
};

const status = async (serial) => {
  const found = await devices();
  const target = serial || (found.list.find((d) => d.state === 'device') || {}).serial;
  const state = {
    adb: findAdb(),
    port: port(),
    certPath: CERT_ON_DEVICE,
    devices: found.list,
    error: found.error,
    serial: target || '',
    reverse: false,
    proxy: '',
  };
  if (!target) {
    return state;
  }
  const [rev, proxy, network] = await Promise.all([
    run(forDevice(target, ['reverse', '--list'])),
    run(forDevice(target, ['shell', 'settings', 'get', 'global', 'http_proxy'])),
    // A phone that will not take the global setting can still be proxied
    // per-network from its Wi-Fi editor, and that is where MIUI users end up.
    // The active network's proxy is readable without any extra permission.
    run(forDevice(target, ['shell', "dumpsys connectivity | grep -m1 -o 'HttpProxy: \\[[^]]*\\] [0-9]*'"])),
  ]);
  state.reverse = rev.ok && rev.stdout.includes(`tcp:${state.port} tcp:${state.port}`);
  // A cleared proxy reads back as "null" or ":0" depending on the build.
  const value = proxy.ok ? proxy.stdout : '';
  const global = value && value !== 'null' && value !== ':0' ? value : '';
  const onNetwork = /HttpProxy: \[([^\]]+)\] (\d+)/.exec(network.stdout || '');
  const fromNetwork = onNetwork ? `${onNetwork[1]}:${onNetwork[2]}` : '';
  state.proxy = global || fromNetwork;
  state.proxySource = '';
  if (global) {
    state.proxySource = 'global';
  } else if (fromNetwork) {
    state.proxySource = 'Wi-Fi';
  }
  // Proxy set but nothing forwarding it: the phone has no network until the
  // forward is back or the setting is cleared.
  state.stale = !!state.proxy && !state.reverse && state.proxy === `${LOOPBACK}:${state.port}`;
  return state;
};

// The phone keeps the proxy setting after the cable is pulled, but the forward
// it points at dies with the USB connection, which leaves the phone with no
// working network at all. Nothing can be run on the device once it is gone, so
// the two things that can be done are done: restore the forward the moment the
// device is back, and clear the setting when the app quits.
let armed = null;
let watcher;

const restore = async () => {
  if (!armed) {
    return;
  }
  const state = await status(armed.serial);
  if (state.serial === armed.serial && state.proxy && !state.reverse) {
    await run(forDevice(armed.serial, ['reverse', `tcp:${armed.port}`, `tcp:${armed.port}`]));
  }
};

const watch = (serial, p) => {
  armed = { serial, port: p };
  if (!watcher) {
    watcher = setInterval(() => { restore().catch(() => {}); }, 5000);
    if (watcher.unref) {
      watcher.unref();
    }
  }
};

const unwatch = () => {
  armed = null;
  if (watcher) {
    clearInterval(watcher);
    watcher = null;
  }
};

// Best effort: the device is usually still attached when the app is quit.
app.on('will-quit', () => {
  if (!armed) {
    return;
  }
  const { serial, port: p } = armed;
  unwatch();
  try {
    execFileSync(findAdb(), forDevice(serial, ['shell', 'settings', 'put', 'global', 'http_proxy', ':0']), { timeout: 4000, stdio: 'ignore' });
    execFileSync(findAdb(), forDevice(serial, ['reverse', '--remove', `tcp:${p}`]), { timeout: 4000, stdio: 'ignore' });
  } catch (e) { /* the phone may already be unplugged */ }
});

const enable = async (serial) => {
  const current = await status(serial);
  if (!current.serial) {
    throw new Error(current.error || 'No device is connected. Plug the phone in and turn on USB debugging.');
  }
  const target = current.serial;
  const p = current.port;
  const reverse = await run(forDevice(target, ['reverse', `tcp:${p}`, `tcp:${p}`]));
  if (!reverse.ok) {
    throw new Error(reverse.stderr || 'adb reverse failed');
  }
  await pushCert(target);
  // The per-network proxy field in Android's Wi-Fi editor rejects a loopback
  // address on some builds; the global setting takes it and outlives a network
  // switch, which is what a USB session wants.
  const proxy = await run(forDevice(target, ['shell', 'settings', 'put', 'global', 'http_proxy', `${LOOPBACK}:${p}`]));
  const state = await status(target);
  if (!state.proxy) {
    // The forward and the certificate are in place either way, so report what
    // is missing rather than failing the whole thing.
    const output = `${proxy.stdout} ${proxy.stderr}`;
    state.proxyError = DENIED.test(output) || failed(proxy)
      ? SECURE_SETTINGS_HINT
      : (proxy.stderr || 'could not set the proxy on the device');
    state.manualProxy = `${LOOPBACK}:${p}`;
  } else {
    watch(target, p);
  }
  return state;
};

const disable = async (serial) => {
  const current = await status(serial);
  const target = current.serial;
  if (!target) {
    throw new Error(current.error || 'No device is connected.');
  }
  // ":0" is Android's own way of clearing the global proxy; an empty string is
  // rejected on some builds.
  unwatch();
  const cleared = await run(forDevice(target, ['shell', 'settings', 'put', 'global', 'http_proxy', ':0']));
  await run(forDevice(target, ['reverse', '--remove', `tcp:${current.port}`]));
  const state = await status(target);
  if (state.proxy) {
    const byHand = 'Clear it by hand: Wi-Fi → Modify network → Proxy → None';
    if (state.proxySource === 'Wi-Fi') {
      state.proxyError = `The proxy is set on the Wi-Fi network itself, which adb cannot change. ${byHand}`;
    } else if (DENIED.test(`${cleared.stdout} ${cleared.stderr}`)) {
      state.proxyError = `The phone refused to clear the proxy. ${byHand}`;
    } else {
      state.proxyError = cleared.stderr || 'could not clear the proxy on the device';
    }
  }
  return state;
};

const openCertSettings = async (serial) => {
  const current = await status(serial);
  if (!current.serial) {
    throw new Error('No device is connected.');
  }
  await run(forDevice(current.serial, ['shell', 'am', 'start', '-a', 'android.settings.SECURITY_SETTINGS']));
  return current;
};

const ACTIONS = {
  status, enable, disable, openCertSettings,
};

ipcMain.handle('android-usb', async (_, data) => {
  const action = ACTIONS[(data && data.action) || 'status'];
  if (!action) {
    return { error: 'Unknown action' };
  }
  try {
    return { state: await action(data && data.serial) };
  } catch (e) {
    return { error: e.message };
  }
});

module.exports = {
  status, enable, disable, openCertSettings,
};
