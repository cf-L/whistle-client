import { $, el, copyText } from './util.js';
import * as api from './api.js';
import { toast } from './ui.js';
import { toSvg } from './qrcode.js';
import { icon } from './icons.js';
import * as store from './store.js';

// The desktop shell exposes a native picker over IPC; in a plain browser the
// field stays a normal text input.
const pickLocalPath = async (directory) => {
  try {
    // eslint-disable-next-line global-require
    const { ipcRenderer } = require('electron');
    return await ipcRenderer.invoke('pick-local-file', { directory });
  } catch (e) {
    return null;
  }
};

// Every GUI tool owns one delimited block inside a single whistle rule file, so
// the generated rules stay readable and hand edits outside the markers survive.
const RULE_NAME = 'Modern UI Tools';
const BEGIN = (id) => `# >>> ${id} (managed by Modern UI, do not edit) >>>`;
const END = (id) => `# <<< ${id} <<<`;

let ruleText = '';

const loadRule = async () => {
  try {
    const res = await api.get('rules/value', { name: RULE_NAME });
    ruleText = (res && res.value && res.value.value) || '';
  } catch (e) {
    ruleText = '';
  }
  return ruleText;
};

const readBlock = (id) => {
  const begin = ruleText.indexOf(BEGIN(id));
  const end = ruleText.indexOf(END(id));
  if (begin < 0 || end < 0) {
    return '';
  }
  return ruleText.slice(begin + BEGIN(id).length, end).trim();
};

const writeBlock = async (id, content) => {
  const begin = ruleText.indexOf(BEGIN(id));
  const end = ruleText.indexOf(END(id));
  const block = `${BEGIN(id)}\n${content.trim()}\n${END(id)}`;
  if (begin >= 0 && end >= 0) {
    ruleText = `${ruleText.slice(0, begin)}${block}${ruleText.slice(end + END(id).length)}`;
  } else {
    ruleText = `${ruleText.trim()}\n\n${block}`.trim();
  }
  await api.rulesAdd({ name: RULE_NAME, value: ruleText, selected: true });
  toast('Rules updated');
};

// A row the user unticked stays in the block as a comment so the entry is
// remembered, while whistle (and the list badges) ignore it like any comment.
const OFF = '#off ';

const parseRows = (id, fields) => readBlock(id).split('\n')
  .map((line) => line.trim())
  .filter((line) => line && (!line.startsWith('#') || line.startsWith(OFF)))
  .map((raw) => {
    const enabled = !raw.startsWith(OFF);
    const parts = (enabled ? raw : raw.slice(OFF.length).trim()).split(/\s+/);
    const row = { enabled };
    fields.forEach((f, i) => {
      row[f] = parts[i] || '';
    });
    row.rest = parts.slice(fields.length).join(' ');
    return row;
  });

const tableEditor = ({
  id, columns, rows, toLine, placeholderRow, validate,
}) => {
  const data = rows.length ? rows.slice() : [placeholderRow()];
  const table = el('div', { class: 'tool-table' });

  const draw = () => {
    table.textContent = '';
    table.appendChild(el('div', { class: 'tool-tr tool-head' }, [
      el('div', { class: 'tool-td tool-on', text: 'On' }),
      ...columns.map((c) => el('div', { class: 'tool-td', text: c.label })),
      el('div', { class: 'tool-td tool-op' }),
    ]));
    data.forEach((row, index) => {
      const cellFor = (c) => {
        const input = el('input', {
          class: `tool-input${c.mono ? ' mono' : ''}`,
          value: row[c.key] || '',
          placeholder: c.placeholder || '',
          spellcheck: 'false',
          oninput: (e) => { row[c.key] = e.target.value; },
        });
        if (!c.pick) {
          return el('div', { class: 'tool-td' }, input);
        }
        return el('div', { class: 'tool-td tool-td-pick' }, [
          input,
          el('button', {
            class: 'pick-btn',
            title: 'Choose local file…',
            onclick: async () => {
              const picked = await pickLocalPath(false);
              if (picked) {
                row[c.key] = picked;
                input.value = picked;
              }
            },
          }, icon('folder')),
        ]);
      };
      const toggle = el('input', {
        class: 'tool-check',
        type: 'checkbox',
        title: 'Enable this rule',
        onchange: (e) => {
          row.enabled = e.target.checked;
          e.target.closest('.tool-tr').classList.toggle('off', !row.enabled);
        },
      });
      toggle.checked = row.enabled !== false;
      table.appendChild(el('div', { class: `tool-tr${row.enabled === false ? ' off' : ''}` }, [
        el('div', { class: 'tool-td tool-on' }, toggle),
        ...columns.map(cellFor),
        el('div', { class: 'tool-td tool-op' }, el('button', {
          class: 'link-btn danger',
          text: '✕',
          onclick: () => {
            data.splice(index, 1);
            if (!data.length) {
              data.push(placeholderRow());
            }
            draw();
          },
        })),
      ]));
    });
    table.appendChild(el('button', {
      class: 'link-btn',
      text: '+ Add row',
      onclick: () => {
        data.push(placeholderRow());
        draw();
      },
    }));
  };
  draw();

  return {
    node: table,
    save: () => {
      if (validate) {
        const problem = data.filter((row) => row.enabled !== false).map(validate).find(Boolean);
        if (problem) {
          toast(problem);
          throw new Error(problem);
        }
      }
      const lines = data.map((row) => {
        const line = toLine(row);
        if (!line) {
          return '';
        }
        return row.enabled === false ? `${OFF}${line}` : line;
      });
      return writeBlock(id, lines.filter(Boolean).join('\n'));
    },
  };
};

const openModal = (title, node, onSave, hint) => {
  const root = $('#modal-root');
  root.textContent = '';
  const close = () => { root.textContent = ''; };
  root.appendChild(el('div', { class: 'modal-mask', onclick: (e) => { if (e.target.classList.contains('modal-mask')) close(); } }, [
    el('div', { class: 'modal' }, [
      el('div', { class: 'modal-head' }, [
        el('span', { text: title }),
        el('button', { class: 'link-btn', text: '✕', onclick: close }),
      ]),
      el('div', { class: 'modal-body' }, [
        hint ? el('div', { class: 'hint', text: hint }) : null,
        node,
      ]),
      el('div', { class: 'modal-foot' }, onSave ? [
        el('button', { class: 'btn', text: 'Cancel', onclick: close }),
        el('button', {
          class: 'btn primary',
          text: 'Save',
          onclick: async () => {
            try {
              await onSave();
            } catch (e) {
              return;
            }
            close();
          },
        }),
      ] : [
        el('button', { class: 'btn primary', text: 'Done', onclick: close }),
      ]),
    ]),
  ]));
};

const mapLocal = async (initialPattern = '') => {
  await loadRule();
  const isBareRegex = (pattern) => pattern.startsWith('.*')
    || pattern.startsWith('^') || pattern.endsWith('.*') || pattern.endsWith('$');
  const normalizePattern = (pattern) => {
    if (!isBareRegex(pattern)) return pattern;
    return `/${pattern.replace(/\//g, '\\/')}/`;
  };
  const validatePattern = (pattern) => {
    let source = pattern;
    let flags = '';
    const wrapped = /^\/(.*)\/([a-z]*)$/.exec(pattern);
    if (wrapped) {
      source = wrapped[1];
      flags = wrapped[2];
    } else if (!isBareRegex(pattern)) {
      return null;
    }
    try {
      RegExp(source, flags);
    } catch (e) {
      return `Invalid regex: ${e.message}`;
    }
    return null;
  };
  const rows = parseRows('map-local', ['pattern', 'file']).map((r) => ({
    enabled: r.enabled,
    pattern: r.pattern,
    file: (r.file || '').replace(/^x?file:\/\//, ''),
  }));
  if (initialPattern && !rows.some((r) => r.pattern === initialPattern)) {
    rows.unshift({ pattern: initialPattern, file: '' });
  }
  const editor = tableEditor({
    id: 'map-local',
    columns: [
      {
        key: 'pattern',
        label: 'URL pattern or regex',
        placeholder: 'https://api.example.com/**  or  .*api/v1/users.*',
        mono: true,
      },
      {
        key: 'file',
        label: 'Local file',
        placeholder: '/Users/me/mock/users.json',
        mono: true,
        pick: true,
      },
    ],
    rows,
    placeholderRow: () => ({ pattern: '', file: '' }),
    toLine: (r) => (r.pattern && r.file ? `${normalizePattern(r.pattern)} file://${r.file}` : ''),
    validate: (r) => validatePattern(r.pattern),
  });
  openModal('Map Local', editor.node, editor.save,
    'Supports URLs, wildcard patterns, /regex/ syntax, and Proxyman-style bare regex such as .*api/v1/users.*.');
};

const mapRemote = async () => {
  await loadRule();
  const editor = tableEditor({
    id: 'map-remote',
    columns: [
      { key: 'pattern', label: 'Match', placeholder: 'https://api.example.com/**' },
      { key: 'target', label: 'Forward to', placeholder: 'http://127.0.0.1:3000' },
    ],
    rows: parseRows('map-remote', ['pattern', 'target']),
    placeholderRow: () => ({ pattern: '', target: '' }),
    toLine: (r) => (r.pattern && r.target ? `${r.pattern} ${r.target}` : ''),
  });
  openModal('Map Remote', editor.node, editor.save,
    'Rewrites the matched request to another origin or URL.');
};

// Presets mirror Apple's Network Link Conditioner profiles (Kbps in/out,
// one-way delay in ms, packet loss %). whistle has no loss primitive, so the
// loss column is surfaced as a hint rather than silently dropped.
const NETWORK_PRESETS = [
  {
    name: 'Custom', down: '', up: '', delay: '', loss: 0,
  },
  {
    name: 'Wi-Fi', down: 5120, up: 4096, delay: 1, loss: 0,
  },
  {
    name: 'Wi-Fi 802.11ac', down: 12800, up: 12800, delay: 1, loss: 0,
  },
  {
    name: 'LTE', down: 6400, up: 2560, delay: 25, loss: 0,
  },
  {
    name: '3G', down: 96, up: 40, delay: 100, loss: 0,
  },
  {
    name: 'DSL', down: 256, up: 128, delay: 5, loss: 0,
  },
  {
    name: 'Edge', down: 30, up: 25, delay: 440, loss: 0,
  },
  {
    name: 'High Latency DNS', down: 5120, up: 4096, delay: 500, loss: 0,
  },
  {
    name: 'Very Bad Network', down: 128, up: 128, delay: 500, loss: 5,
  },
  {
    name: '100% Loss', down: 0, up: 0, delay: 0, loss: 100,
  },
];

const throttle = async () => {
  await loadRule();
  const rows = parseRows('throttle', ['pattern']).map((r) => {
    const opts = {};
    r.rest.split(/\s+/).forEach((token) => {
      const m = /^(reqSpeed|resSpeed|reqDelay|resDelay|statusCode):\/\/(.+)$/.exec(token);
      if (m) {
        opts[m[1]] = m[2];
      }
    });
    return {
      enabled: r.enabled,
      pattern: r.pattern,
      up: opts.reqSpeed || '',
      down: opts.resSpeed || '',
      delay: opts.resDelay || '',
      blocked: opts.statusCode === '502' ? '1' : '',
    };
  });

  const editor = tableEditor({
    id: 'throttle',
    columns: [
      { key: 'pattern', label: 'Match', placeholder: '*', mono: true },
      { key: 'down', label: 'Down KB/s', placeholder: '640' },
      { key: 'up', label: 'Up KB/s', placeholder: '320' },
      { key: 'delay', label: 'Delay ms', placeholder: '25' },
    ],
    rows,
    placeholderRow: () => ({ pattern: '*' }),
    toLine: (r) => {
      if (!r.pattern) {
        return '';
      }
      if (r.blocked === '1') {
        return `${r.pattern} statusCode://502`;
      }
      const ops = [];
      if (r.up) {
        ops.push(`reqSpeed://${r.up}`);
      }
      if (r.down) {
        ops.push(`resSpeed://${r.down}`);
      }
      if (r.delay) {
        ops.push(`reqDelay://${r.delay}`, `resDelay://${r.delay}`);
      }
      return ops.length ? `${r.pattern} ${ops.join(' ')}` : '';
    },
  });

  // Applying a preset rewrites the first row and re-renders the table.
  const applyPreset = (preset) => {
    const inputs = editor.node.querySelectorAll('.tool-tr:not(.tool-head) .tool-input');
    if (inputs.length < 4) {
      return;
    }
    const set = (input, value) => {
      input.value = value === '' ? '' : String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (preset.name === '100% Loss') {
      set(inputs[1], '');
      set(inputs[2], '');
      set(inputs[3], '');
      toast('100% Loss maps to a 502 response for matched requests');
      editor.node.dataset.blocked = '1';
    } else {
      // Kbps in the Apple profile, KB/s in whistle: divide by 8.
      set(inputs[1], preset.down ? Math.max(1, Math.round(preset.down / 8)) : '');
      set(inputs[2], preset.up ? Math.max(1, Math.round(preset.up / 8)) : '');
      set(inputs[3], preset.delay || '');
      editor.node.dataset.blocked = '';
    }
    if (preset.loss) {
      toast(`${preset.name}: ${preset.loss}% packet loss cannot be simulated by whistle`);
    }
  };

  const presetRow = el('div', { class: 'preset-row' }, [
    el('span', { class: 'field-label inline', text: 'Preset' }),
    el('select', {
      class: 'tool-input preset-select',
      onchange: (e) => {
        const preset = NETWORK_PRESETS.find((x) => x.name === e.target.value);
        if (preset && preset.name !== 'Custom') {
          applyPreset(preset);
        }
      },
    }, NETWORK_PRESETS.map((p) => el('option', { value: p.name, text: p.name }))),
  ]);

  openModal('Throttle', el('div', {}, [presetRow, editor.node]), () => {
    if (editor.node.dataset.blocked === '1') {
      const first = editor.node.querySelector('.tool-tr:not(.tool-head) .tool-input');
      return writeBlock('throttle', `${(first && first.value) || '*'} statusCode://502`);
    }
    return editor.save();
  }, 'Presets follow Apple\'s Network Link Conditioner profiles; speeds are converted from Kbps to KB/s.');
};

const block = async () => {
  await loadRule();
  const editor = tableEditor({
    id: 'block',
    columns: [
      { key: 'pattern', label: 'Match', placeholder: 'https://ads.example.com/**' },
      { key: 'status', label: 'Status code', placeholder: '403' },
    ],
    rows: parseRows('block', ['pattern', 'status']).map((r) => ({
      enabled: r.enabled,
      pattern: r.pattern,
      status: (r.status || '').replace('statusCode://', ''),
    })),
    placeholderRow: () => ({ pattern: '', status: '403' }),
    toLine: (r) => (r.pattern ? `${r.pattern} statusCode://${r.status || '403'}` : ''),
  });
  openModal('Block List', editor.node, editor.save,
    'Matched requests are answered locally with the given status code instead of hitting the network.');
};

const ssl = async () => {
  await loadRule();
  const state = { intercept: false };
  try {
    const data = await api.getData({ startTime: -1, count: 0 });
    state.intercept = !!(data && data.interceptHttpsConnects);
  } catch (e) { /* default off */ }

  const toggle = el('label', { class: 'switch' }, [
    el('input', {
      type: 'checkbox',
      checked: state.intercept ? 'checked' : null,
      onchange: async (e) => {
        try {
          await api.setInterceptHttps(e.target.checked ? 1 : 0);
          toast(e.target.checked ? 'HTTPS interception on' : 'HTTPS interception off');
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      },
    }),
    el('span', { text: 'Decrypt HTTPS traffic (install the root certificate first)' }),
  ]);

  const editor = tableEditor({
    id: 'ssl',
    columns: [{ key: 'pattern', label: 'Exclude host from decryption', placeholder: 'accounts.google.com' }],
    rows: parseRows('ssl', ['pattern']),
    placeholderRow: () => ({ pattern: '' }),
    toLine: (r) => (r.pattern ? `${r.pattern} disable://capture` : ''),
  });

  openModal('SSL Proxying', el('div', {}, [
    toggle,
    el('div', { class: 'spacer' }),
    editor.node,
    el('div', { class: 'hint' }, el('a', { href: api.rootCAUrl, text: 'Download root certificate', target: '_blank' })),
  ]), editor.save, 'Hosts listed here keep their tunnel encrypted and are not decrypted.');
};

const breakpoint = async () => {
  await loadRule();
  const editor = tableEditor({
    id: 'breakpoint',
    columns: [
      { key: 'pattern', label: 'Match', placeholder: 'https://api.example.com/checkout' },
      { key: 'ms', label: 'Hold request (ms)', placeholder: '5000' },
    ],
    rows: parseRows('breakpoint', ['pattern', 'ms']).map((r) => ({
      enabled: r.enabled,
      pattern: r.pattern,
      ms: (r.ms || '').replace('reqDelay://', ''),
    })),
    placeholderRow: () => ({ pattern: '', ms: '5000' }),
    toLine: (r) => (r.pattern ? `${r.pattern} reqDelay://${r.ms || '5000'}` : ''),
  });
  openModal('Breakpoints', editor.node, editor.save,
    'whistle has no interactive breakpoint API, so this holds matched requests for a fixed delay — '
    + 'enough to inspect or abort them from the request list, but not to edit them in flight.');
};


// Everything a phone or tablet needs to have its HTTPS decrypted: the proxy
// address to point at, the certificate URL behind a QR code, and the per-OS
// trust step people forget. The desktop's own certificate is installed from the
// app menu, which this dialog links to rather than duplicates.
const certificate = async () => {
  const server = store.state.server || {};
  const port = server.port;
  // A phone needs a routable LAN address, so real IPv4 comes first and the
  // machine hostname (which the device usually cannot resolve) comes last.
  const lan = (server.ipv4 || []).filter((ip) => !/^169\.254\./.test(ip) && ip !== '127.0.0.1');
  const hosts = [...new Set([...lan, ...(server.ipv4 || []), server.host].filter(Boolean))];
  const state = { host: hosts[0] || '127.0.0.1', intercept: false };
  try {
    const data = await api.getData({ startTime: -1, count: 0 });
    state.intercept = !!(data && data.interceptHttpsConnects);
  } catch (e) { /* default off */ }

  const certUrl = () => `http://${state.host}:${port}${api.rootCAUrl}`;
  const proxyAddr = () => `${state.host}:${port}`;

  const qrBox = el('div', { class: 'qr-box' });
  const urlText = el('code', { class: 'cert-url' });
  const proxyText = el('code', { class: 'cert-url' });
  const refresh = () => {
    const svg = toSvg(certUrl(), 176);
    qrBox.innerHTML = svg || '';
    urlText.textContent = certUrl();
    proxyText.textContent = proxyAddr();
  };

  const hostPicker = el('select', {
    class: 'filter-select',
    onchange: (e) => {
      state.host = e.target.value;
      refresh();
    },
  }, hosts.map((h) => el('option', { value: h, text: h, selected: h === state.host ? 'selected' : null })));

  const copyBtn = (getText, label) => el('button', {
    class: 'link-btn',
    text: label,
    onclick: async () => {
      await copyText(getText());
      toast(`${label.replace('Copy ', '')} copied`);
    },
  });

  const toggle = el('label', { class: 'switch' }, [
    el('input', {
      type: 'checkbox',
      checked: state.intercept ? 'checked' : null,
      onchange: async (e) => {
        try {
          await api.setInterceptHttps(e.target.checked ? 1 : 0);
          toast(e.target.checked ? 'HTTPS interception on' : 'HTTPS interception off');
        } catch (err) {
          toast(`Failed: ${err.message}`);
        }
      },
    }),
    el('span', { text: 'Decrypt HTTPS traffic' }),
  ]);

  const step = (n, title, body) => el('div', { class: 'cert-step' }, [
    el('span', { class: 'cert-step-no', text: String(n) }),
    el('div', { class: 'cert-step-body' }, [
      el('div', { class: 'cert-step-title', text: title }),
      body,
    ]),
  ]);

  const body = el('div', { class: 'cert-pane' }, [
    toggle,
    el('div', { class: 'field-label', text: 'This computer' }),
    el('div', { class: 'cert-row' }, [
      el('a', { class: 'btn', href: api.rootCAUrl, target: '_blank', text: 'Download root certificate' }),
      el('span', { class: 'hint', text: 'Or use the Whistle menu → Install Root CA to install and trust it in one step.' }),
    ]),
    el('div', { class: 'field-label', text: 'Phone, tablet or another computer' }),
    el('div', { class: 'cert-mobile' }, [
      el('div', { class: 'cert-steps' }, [
        step(1, 'Put the device on this network and set its HTTP proxy to', el('div', { class: 'cert-row' }, [
          hosts.length > 1 ? hostPicker : null,
          proxyText,
          copyBtn(proxyAddr, 'Copy address'),
        ])),
        step(2, 'Open this URL on the device, or scan the code', el('div', { class: 'cert-row' }, [
          urlText,
          copyBtn(certUrl, 'Copy URL'),
        ])),
        step(3, 'Trust the certificate', el('div', { class: 'hint' }, [
          el('div', { text: 'iOS: Settings → General → VPN & Device Management → install the profile, then Settings → General → About → Certificate Trust Settings → turn it on.' }),
          el('div', { text: 'Android: install it under Settings → Security → Encryption & credentials → Install a certificate → CA certificate.' }),
        ])),
      ]),
      qrBox,
    ]),
  ]);

  refresh();
  openModal('HTTPS Certificate', body, null,
    'HTTPS is only decrypted on devices that trust this root certificate. The link '
    + 'below carries this session\'s access token, so only hand it to your own devices.');
};

// Wi-Fi is not always an option: a corporate access point with client isolation
// will not let a phone reach this machine at all. Over USB, adb forwards a port
// on the phone back to whistle here, so the phone proxies to its own localhost
// and never touches the network. The shell owns the adb calls.
const androidUsb = async () => {
  const call = async (action, serial) => {
    try {
      // eslint-disable-next-line global-require
      const { ipcRenderer } = require('electron');
      return await ipcRenderer.invoke('android-usb', { action, serial });
    } catch (e) {
      return { error: 'Only available in the desktop app' };
    }
  };

  let state = {};
  const rows = el('div', { class: 'usb-status' });
  const actions = el('div', { class: 'cert-row' });
  const picker = el('select', { class: 'filter-select' });

  const line = (label, value, ok) => el('div', { class: 'usb-line' }, [
    el('span', { class: 'usb-dot' + (ok === undefined ? '' : (ok ? ' on' : ' off')) }),
    el('span', { class: 'usb-label', text: label }),
    el('code', { class: 'usb-value', text: value }),
  ]);

  const render = () => {
    const list = state.devices || [];
    const ready = list.filter((d) => d.state === 'device');
    const on = !!(state.reverse && state.proxy);

    picker.textContent = '';
    list.forEach((d) => picker.appendChild(el('option', {
      value: d.serial,
      text: `${d.model || d.serial}${d.state === 'device' ? '' : ` (${d.state})`}`,
      selected: d.serial === state.serial ? 'selected' : null,
    })));

    rows.textContent = '';
    if (state.error) {
      rows.appendChild(el('div', { class: 'hint', text: state.error }));
    }
    if (state.proxyError) {
      rows.appendChild(el('div', { class: 'usb-warn' }, [
        el('div', { text: state.proxyError }),
        state.manualProxy ? el('code', { class: 'usb-value', text: state.manualProxy }) : null,
      ]));
    }
    if (state.stale) {
      rows.appendChild(el('div', { class: 'usb-warn' }, el('div', {
        text: 'The device still points at this proxy but nothing is forwarding it, '
          + 'so it has no working network. Plug it back in and turn this on again, or turn it off.',
      })));
    }
    rows.appendChild(line('Device', ready.length
      ? `${(ready.find((d) => d.serial === state.serial) || ready[0]).model || state.serial}`
      : 'none connected', !!ready.length));
    rows.appendChild(line('Port forward', state.reverse
      ? `tcp:${state.port} → whistle` : 'off', !!state.reverse));
    rows.appendChild(line('Proxy on device',
      state.proxy ? `${state.proxy}${state.proxySource === 'Wi-Fi' ? '  (set on the Wi-Fi network)' : ''}` : 'off',
      !!state.proxy));
    rows.appendChild(line('Certificate', state.certPath || '', undefined));

    actions.textContent = '';
    actions.appendChild(el('button', {
      class: 'btn primary',
      text: on ? 'Re-apply' : 'Turn on',
      onclick: () => step('enable'),
    }));
    actions.appendChild(el('button', {
      class: 'btn',
      text: 'Turn off',
      onclick: () => step('disable'),
    }));
    actions.appendChild(el('button', {
      class: 'link-btn',
      text: 'Open certificate settings on device',
      onclick: () => step('openCertSettings'),
    }));
    actions.appendChild(el('button', { class: 'link-btn', text: 'Refresh', onclick: () => step('status') }));
  };

  const step = async (action) => {
    const res = await call(action, picker.value || state.serial);
    if (res.error) {
      toast(res.error);
    } else if (action === 'enable') {
      toast('USB capture on — turn it off before unplugging the phone');
    } else if (action === 'disable') {
      toast('USB capture off');
    }
    const previous = state;
    state = res.state || state;
    // A plain refresh must not silently drop a warning the last action raised.
    if (action === 'status' && !state.proxyError && previous.proxyError && !state.proxy) {
      state.proxyError = previous.proxyError;
      state.manualProxy = previous.manualProxy;
    }
    render();
  };

  picker.addEventListener('change', () => step('status'));
  await step('status');

  openModal('Android over USB', el('div', { class: 'cert-pane' }, [
    rows,
    (state.devices || []).length > 1 ? el('div', { class: 'cert-row' }, [
      el('span', { class: 'field-label inline', text: 'Device' }), picker,
    ]) : null,
    actions,
    el('div', { class: 'field-label', text: 'After turning it on' }),
    el('div', { class: 'hint' }, [
      el('div', { text: 'The root certificate is copied to the device\'s Download folder. Install it there: Settings → Security → Encryption & credentials → Install a certificate → CA certificate.' }),
      el('div', { text: 'Android 9 and later: apps ignore user-installed CAs unless they ship a networkSecurityConfig or you use a debug build. The system browser is unaffected.' }),
      el('div', { text: 'Turn it off before unplugging. The proxy setting stays on the phone while the forward dies with the cable, which leaves the phone without a network until one or the other is put back.' }),
      el('div', { text: 'While this is on, the forward is restored automatically a few seconds after the phone is plugged back in, and the setting is cleared if the app quits.' }),
    ]),
  ]), null,
  'Needs USB debugging on the phone and adb on this machine. Turning it off clears '
    + 'both the port forward and the proxy setting on the device.');
};

const TOOLS = {
  cert: certificate,
  android: androidUsb,
  'map-local': mapLocal,
  'map-remote': mapRemote,
  throttle,
  block,
  ssl,
  breakpoint,
};

export const open = (name, ...args) => {
  const fn = TOOLS[name];
  if (fn) {
    fn(...args);
  }
};

export { openModal, RULE_NAME };
