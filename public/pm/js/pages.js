import { $, el, formatSize } from './util.js';
import * as api from './api.js';
import * as store from './store.js';
import { toast, confirmDialog, promptDialog } from './ui.js';

// --- Rules ---------------------------------------------------------------
const rulesState = { list: [], active: null, value: '', dirty: false };

const loadRuleValue = async (name) => {
  const res = await api.get('rules/value', { name });
  const value = res && res.value;
  rulesState.value = (value && value.value) || '';
  rulesState.selected = !!(value && value.selected);
  rulesState.active = name;
  rulesState.dirty = false;
  renderRules();
};

const saveRule = async () => {
  await api.rulesAdd({ name: rulesState.active, value: rulesState.value, selected: rulesState.selected });
  rulesState.dirty = false;
  toast(`Saved ${rulesState.active}`);
  renderRules();
};

export const renderRules = async (reload) => {
  const page = $('#page-rules');
  if (reload || !rulesState.list.length) {
    const res = await api.rulesList();
    rulesState.list = [{ name: 'Default' }].concat(res.list || []);
    rulesState.defaultDisabled = res.defaultRulesIsDisabled;
    if (!rulesState.active) {
      return loadRuleValue('Default');
    }
  }
  page.textContent = '';
  const side = el('div', { class: 'mgr-side' }, [
    el('div', { class: 'mgr-side-head' }, [
      el('span', { text: 'Rule Files' }),
      el('button', {
        class: 'link-btn',
        text: '+',
        title: 'New rule file',
        onclick: async () => {
          const name = promptDialog('New rule file name');
          if (!name) {
            return;
          }
          await api.rulesAdd({ name, value: '', selected: true });
          rulesState.active = name;
          renderRules(true);
        },
      }),
    ]),
    el('div', { class: 'mgr-list' }, rulesState.list.map((r) => el('a', {
      class: `mgr-item${rulesState.active === r.name ? ' active' : ''}${r.selected ? ' enabled' : ''}`,
      onclick: () => loadRuleValue(r.name),
    }, [
      el('input', {
        type: 'checkbox',
        checked: (r.name === 'Default' ? !rulesState.defaultDisabled : r.selected) ? 'checked' : null,
        onclick: async (e) => {
          e.stopPropagation();
          const on = e.target.checked;
          if (r.name === 'Default') {
            await (on ? api.rulesEnableDefault() : api.rulesDisableDefault());
          } else {
            await (on ? api.rulesSelect(r.name) : api.rulesUnselect(r.name));
          }
          renderRules(true);
        },
      }),
      el('span', { class: 'mgr-name', text: r.name }),
      r.name === 'Default' ? null : el('button', {
        class: 'link-btn danger',
        text: '✕',
        onclick: async (e) => {
          e.stopPropagation();
          if (!confirmDialog(`Delete rule file "${r.name}"?`)) {
            return;
          }
          await api.rulesRemove(r.name);
          if (rulesState.active === r.name) {
            rulesState.active = 'Default';
          }
          renderRules(true);
        },
      }),
    ]))),
  ]);

  const editor = el('textarea', {
    class: 'editor mono',
    spellcheck: 'false',
    oninput: (e) => {
      rulesState.value = e.target.value;
      rulesState.dirty = true;
    },
  });
  editor.value = rulesState.value;

  const main = el('div', { class: 'mgr-main' }, [
    el('div', { class: 'mgr-bar' }, [
      el('span', { class: 'mgr-title', text: rulesState.active || 'Default' }),
      rulesState.dirty ? el('span', { class: 'dot-dirty', text: '●' }) : null,
      el('button', { class: 'btn primary', text: 'Save', onclick: saveRule }),
    ]),
    editor,
  ]);
  page.appendChild(el('div', { class: 'mgr' }, [side, main]));
};

// --- Values --------------------------------------------------------------
const valuesState = { list: [], active: null, value: '', dirty: false };

const loadValue = (name) => {
  const found = valuesState.list.find((v) => v.name === name);
  valuesState.value = (found && found.data) || '';
  valuesState.active = name;
  valuesState.dirty = false;
  renderValues();
};

export const renderValues = async (reload) => {
  const page = $('#page-values');
  if (reload || !valuesState.list.length) {
    const res = await api.valuesList();
    valuesState.list = res.list || [];
    if (valuesState.list.length && (!valuesState.active || !valuesState.list.some((v) => v.name === valuesState.active))) {
      return loadValue(valuesState.list[0].name);
    }
  }
  page.textContent = '';
  const names = valuesState.list.map((v) => v.name);
  const side = el('div', { class: 'mgr-side' }, [
    el('div', { class: 'mgr-side-head' }, [
      el('span', { text: 'Values' }),
      el('button', {
        class: 'link-btn',
        text: '+',
        onclick: async () => {
          const name = promptDialog('New value name');
          if (!name) {
            return;
          }
          await api.valuesAdd({ name, value: '' });
          valuesState.active = name;
          renderValues(true);
        },
      }),
    ]),
    el('div', { class: 'mgr-list' }, names.map((name) => el('a', {
      class: `mgr-item${valuesState.active === name ? ' active' : ''}`,
      onclick: () => loadValue(name),
    }, [
      el('span', { class: 'mgr-name', text: name }),
      el('button', {
        class: 'link-btn danger',
        text: '✕',
        onclick: async (e) => {
          e.stopPropagation();
          if (!confirmDialog(`Delete value "${name}"?`)) {
            return;
          }
          await api.valuesRemove(name);
          if (valuesState.active === name) {
            valuesState.active = null;
          }
          renderValues(true);
        },
      }),
    ]))),
  ]);

  const editor = el('textarea', {
    class: 'editor mono',
    spellcheck: 'false',
    oninput: (e) => {
      valuesState.value = e.target.value;
      valuesState.dirty = true;
    },
  });
  editor.value = valuesState.value;

  const main = el('div', { class: 'mgr-main' }, [
    el('div', { class: 'mgr-bar' }, [
      el('span', { class: 'mgr-title', text: valuesState.active || '—' }),
      valuesState.dirty ? el('span', { class: 'dot-dirty', text: '●' }) : null,
      el('button', {
        class: 'btn primary',
        text: 'Save',
        onclick: async () => {
          await api.valuesAdd({ name: valuesState.active, value: valuesState.value });
          valuesState.dirty = false;
          toast(`Saved ${valuesState.active}`);
          renderValues();
        },
      }),
    ]),
    editor,
  ]);
  page.appendChild(el('div', { class: 'mgr' }, [side, main]));
};

// --- Plugins -------------------------------------------------------------
export const renderPlugins = () => {
  const page = $('#page-plugins');
  const plugins = store.state.plugins || {};
  const disabled = store.state.disabledPlugins || {};
  page.textContent = '';
  const grid = el('div', { class: 'plugin-grid' });
  Object.keys(plugins).sort().forEach((key) => {
    const p = plugins[key];
    const name = key.replace(/:$/, '');
    const off = !!disabled[name];
    grid.appendChild(el('div', { class: `plugin-card${off ? ' off' : ''}` }, [
      el('div', { class: 'plugin-head' }, [
        el('span', { class: 'plugin-name', text: name }),
        el('label', { class: 'switch small' }, [
          el('input', {
            type: 'checkbox',
            checked: off ? null : 'checked',
            onchange: async (e) => {
              await api.pluginsDisable(name, e.target.checked ? 0 : 1);
              toast(`${name} ${e.target.checked ? 'enabled' : 'disabled'}`);
            },
          }),
          el('span', {}),
        ]),
      ]),
      el('div', { class: 'plugin-desc', text: p.description || '' }),
      el('div', { class: 'plugin-meta', text: `v${p.version || '?'}${p.isProj ? ' · project' : ''}` }),
      el('div', { class: 'plugin-ops' }, [
        el('a', {
          class: 'link-btn',
          text: 'Open UI',
          onclick: () => openPluginUI(name),
        }),
        p.homepage ? el('a', { class: 'link-btn', href: p.homepage, target: '_blank', text: 'Homepage' }) : null,
      ]),
    ]));
  });
  page.appendChild(grid);
  page.appendChild(el('div', { class: 'plugin-frame-wrap hidden', id: 'plugin-frame-wrap' }, [
    el('div', { class: 'mgr-bar' }, [
      el('span', { class: 'mgr-title', id: 'plugin-frame-title', text: '' }),
      el('button', {
        class: 'link-btn',
        text: 'Close',
        onclick: () => $('#plugin-frame-wrap').classList.add('hidden'),
      }),
    ]),
    el('iframe', { id: 'plugin-frame', title: 'Plugin UI' }),
  ]));
};

// Plugin pages keep whistle's own mount contract: they are served from
// /whistle.<name>/ on the same origin and rendered inside an iframe. Not every
// plugin ships a web UI, so probe the path before swapping the view.
export const openPluginUI = async (name) => {
  const url = `/whistle.${name}/${api.authQuery ? `?${api.authQuery}` : ''}`;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      toast(`${name} has no web UI`);
      return;
    }
  } catch (e) {
    toast(`${name} has no web UI`);
    return;
  }
  const wrap = $('#plugin-frame-wrap');
  $('#plugin-frame-title').textContent = name;
  $('#plugin-frame').src = url;
  wrap.classList.remove('hidden');
};

export const renderClassic = () => {
  const frame = $('#classic-frame');
  if (!frame.src) {
    frame.src = `/${api.authQuery ? `?${api.authQuery}&` : '?'}mode=client`;
  }
};
