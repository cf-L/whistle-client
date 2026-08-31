import { $, $$, el, debounce } from './util.js';
import * as store from './store.js';
import { icon } from './icons.js';
import { toast } from './ui.js';

const FIELDS = [
  ['url', 'URL'],
  ['host', 'Host'],
  ['path', 'Path'],
  ['method', 'Method'],
  ['status', 'Status'],
  ['headers', 'Headers'],
  ['body', 'Body'],
  ['type', 'Type'],
];

const OPS = [
  ['contains', 'Contains'],
  ['not', 'Not contains'],
  ['equals', 'Equals'],
  ['regex', 'Matches regex'],
];

const SAVED_KEY = 'pm-filters';
const apply = debounce(() => store.emit(), 120);

const blankRow = () => ({
  field: 'url', op: 'contains', value: '', enabled: true,
});

// Proxyman keeps one empty row at the bottom so a new condition is just typing.
const ensureTrailingRow = () => {
  const list = store.state.filters;
  if (!list.length || list[list.length - 1].value.trim()) {
    list.push(blankRow());
  }
};

const select = (options, value, onChange) => el('select', {
  class: 'filter-select',
  onchange: (e) => onChange(e.target.value),
}, options.map(([v, label]) => el('option', {
  value: v,
  selected: v === value ? 'selected' : null,
  text: label,
})));

const renderRow = (filter, index) => {
  const row = el('div', { class: `filter-row${filter.enabled ? '' : ' off'}`, dataset: { index } });

  row.appendChild(el('label', { class: 'filter-check' }, el('input', {
    type: 'checkbox',
    checked: filter.enabled ? 'checked' : null,
    title: 'Enable this filter (⌘B)',
    onchange: (e) => {
      filter.enabled = e.target.checked;
      row.classList.toggle('off', !filter.enabled);
      apply();
    },
  })));

  row.appendChild(select(FIELDS, filter.field, (v) => {
    filter.field = v;
    apply();
  }));
  row.appendChild(select(OPS, filter.op, (v) => {
    filter.op = v;
    apply();
  }));

  const input = el('input', {
    class: 'filter-input',
    value: filter.value,
    placeholder: 'Filter value',
    spellcheck: 'false',
    dataset: { index },
    oninput: (e) => {
      filter.value = e.target.value;
      const wasLast = index === store.state.filters.length - 1;
      if (wasLast && e.target.value.trim()) {
        ensureTrailingRow();
        render();
        focusRow(index);
      }
      apply();
    },
  });

  const clear = el('button', {
    class: 'filter-x',
    title: 'Clear value',
    onclick: () => {
      filter.value = '';
      input.value = '';
      apply();
    },
  }, icon('close'));

  row.appendChild(el('div', { class: 'filter-field' }, [
    icon('search', 'filter-search'),
    input,
    clear,
  ]));

  row.appendChild(el('button', {
    class: 'row-btn',
    title: 'Remove this filter (⇧⌘N)',
    onclick: () => removeRow(index),
  }, el('span', { class: 'icn', html: '<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 12h12"/></svg>' })));

  row.appendChild(el('button', {
    class: 'row-btn',
    title: 'Add a filter below (⌘N)',
    onclick: () => insertRow(index + 1),
  }, icon('plus')));

  return row;
};

// Cheap state-only refresh. The row DOM is rebuilt exclusively on structural
// edits; rebuilding it on every poll tick would flicker text under the cursor
// and drop the caret while typing.
export const sync = () => {
  $('#filter-bar').classList.toggle(
    'has-filters',
    store.state.filters.some((f) => f.value.trim()),
  );
};

export const render = () => {
  ensureTrailingRow();
  const wrap = $('#filter-rows');
  wrap.textContent = '';
  store.state.filters.forEach((filter, index) => wrap.appendChild(renderRow(filter, index)));
  $('#filter-mode').value = store.state.filterMode;
  sync();
};

const focusRow = (index) => {
  const list = $$('#filter-rows .filter-input');
  const node = list[Math.max(0, Math.min(list.length - 1, index))];
  if (node) {
    node.focus();
    const end = node.value.length;
    node.setSelectionRange(end, end);
  }
};

const activeIndex = () => {
  const node = document.activeElement;
  if (node && node.classList.contains('filter-input')) {
    return +node.dataset.index;
  }
  return store.state.filters.length - 1;
};

const insertRow = (index) => {
  store.state.filters.splice(index, 0, blankRow());
  render();
  focusRow(index);
  apply();
};

const removeRow = (index) => {
  store.state.filters.splice(index, 1);
  render();
  focusRow(Math.max(0, index - 1));
  apply();
};

export const focusInput = () => {
  $('#filter-bar').classList.remove('dismissed');
  $('#filter-bar').classList.add('open');
  render();
  const rows = store.state.filters;
  const firstEmpty = rows.findIndex((f) => !f.value.trim());
  focusRow(firstEmpty === -1 ? rows.length - 1 : firstEmpty);
};

export const hide = () => {
  const bar = $('#filter-bar');
  // Escape means leaving filter mode, not merely hiding its editor while the
  // request list remains filtered by invisible conditions.
  store.clearFilters();
  render();
  bar.classList.remove('open');
  bar.classList.add('dismissed');
};

// The bar also shows itself whenever conditions are active, so "open" has to
// mean visible - otherwise Escape would ignore a bar the user can plainly see.
export const isOpen = () => {
  const bar = $('#filter-bar');
  return bar.classList.contains('open')
    || (bar.classList.contains('has-filters') && !bar.classList.contains('dismissed'));
};

// Filter-bar shortcuts mirror Proxyman's, but only while the bar has focus.
export const handleKey = (e) => {
  // Escape closes an open filter bar even after focus moved to the request
  // list. Other filter shortcuts remain scoped to controls inside the bar.
  if ((e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) && isOpen()) {
    hide();
    return true;
  }
  const inBar = $('#filter-bar').contains(document.activeElement);
  if (!inBar) {
    return false;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) {
    return false;
  }
  const index = activeIndex();
  if (e.key.toLowerCase() === 'n') {
    if (e.shiftKey) {
      removeRow(index);
    } else {
      insertRow(index + 1);
    }
    return true;
  }
  if (e.key === 'ArrowUp') {
    focusRow(index - 1);
    return true;
  }
  if (e.key === 'ArrowDown') {
    focusRow(index + 1);
    return true;
  }
  if (e.key.toLowerCase() === 'b') {
    const filter = store.state.filters[index];
    if (filter) {
      filter.enabled = !filter.enabled;
      render();
      focusRow(index);
      apply();
    }
    return true;
  }
  return false;
};

export const init = () => {
  $('#filter-mode').addEventListener('change', (e) => {
    store.setFilterMode(e.target.value);
    render();
  });
  $('#filter-clear').addEventListener('click', () => {
    store.clearFilters();
    render();
  });
  $('#filter-save').addEventListener('click', () => {
    try {
      const keep = store.state.filters.filter((f) => f.value.trim());
      localStorage.setItem(SAVED_KEY, JSON.stringify({ mode: store.state.filterMode, list: keep }));
      toast(`Saved ${keep.length} filter${keep.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast('Could not save filters');
    }
  });
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || 'null');
    if (saved && Array.isArray(saved.list) && saved.list.length) {
      store.state.filters = saved.list.map((f) => ({ ...blankRow(), ...f }));
      store.setFilterMode(saved.mode);
    }
  } catch (err) { /* ignore malformed storage */ }
  render();
};
