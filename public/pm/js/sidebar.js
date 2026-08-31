import { $, el, formatSize } from './util.js';
import * as store from './store.js';
import { icon } from './icons.js';

// Apps and Domains start folded: on a busy session either tree is hundreds of
// rows, and the user opens the one they actually want.
const GROUP_KEY = 'pm-side-groups';
const expanded = new Set();
try {
  JSON.parse(localStorage.getItem(GROUP_KEY) || '[]').forEach((key) => expanded.add(key));
} catch (e) { /* default collapsed */ }

const saveGroups = () => {
  try {
    localStorage.setItem(GROUP_KEY, JSON.stringify(Array.from(expanded)));
  } catch (e) { /* private mode */ }
};

const SECTION_KEY = 'pm-side-sections';

const restoreSections = () => {
  let open = [];
  try {
    open = JSON.parse(localStorage.getItem(SECTION_KEY) || '[]');
  } catch (e) { /* default collapsed */ }
  document.querySelectorAll('[data-side-section]').forEach((section) => {
    const expandedSection = open.includes(section.dataset.sideSection);
    section.classList.toggle('collapsed', !expandedSection);
    section.querySelector('.side-section-toggle').setAttribute('aria-expanded', String(expandedSection));
  });
};

const bindSections = () => {
  document.querySelectorAll('.side-section-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.closest('[data-side-section]');
      const isOpen = section.classList.toggle('collapsed') === false;
      button.setAttribute('aria-expanded', String(isOpen));
      try {
        const open = Array.from(document.querySelectorAll('[data-side-section]:not(.collapsed)'))
          .map((node) => node.dataset.sideSection);
        localStorage.setItem(SECTION_KEY, JSON.stringify(open));
      } catch (e) { /* private mode */ }
    });
  });
};

const groupRow = (label, count, key, children) => {
  // A search is useless against a folded tree, so a query opens both groups
  // without changing what the user chose to keep open.
  const isOpen = expanded.has(key) || !!store.state.sidebarQuery.trim();
  const head = el('a', { class: `tree-group${isOpen ? ' open' : ''}` }, [
    icon(key === 'Apps' ? 'plugins' : 'network'),
    el('span', { class: 'nav-label', text: label }),
    el('span', { class: 'side-count', text: String(count) }),
  ]);
  head.addEventListener('click', () => {
    if (expanded.has(key)) {
      expanded.delete(key);
    } else {
      expanded.add(key);
    }
    saveGroups();
    render();
  });
  const wrap = el('div', { class: 'tree-block' }, [head]);
  if (isOpen) {
    wrap.appendChild(el('div', { class: 'tree-kids' }, children));
  }
  return wrap;
};

const matchesQuery = (text) => {
  const q = store.state.sidebarQuery.trim().toLowerCase();
  return !q || String(text).toLowerCase().includes(q);
};

export const render = () => {
  const tree = $('#side-tree');
  const apps = store.appTree().filter((a) => matchesQuery(a.name));
  const hosts = store.hostTree().filter((h) => matchesQuery(h.host));
  const total = store.state.order.length;

  $('#all-count').textContent = String(total);
  $('#pinned-count').textContent = String(store.state.pinned.size);
  $('#saved-count').textContent = String(store.state.saved.size);

  $('#scope-all').classList.toggle(
    'active',
    store.state.scope === 'all' && !store.state.hostFilter && !store.state.appFilter,
  );
  document.querySelectorAll('#fav-nav a').forEach((a) => {
    a.classList.toggle('active', store.state.scope === a.dataset.scope);
  });

  tree.textContent = '';
  tree.appendChild(groupRow('Apps', apps.length, 'Apps', apps.map((app) => {
    const row = el('a', {
      class: `tree-leaf${store.state.appFilter === app.name ? ' active' : ''}`,
      title: `${app.name} · ${app.count} requests · ${app.hosts.size} hosts`,
    }, [
      el('span', { class: 'leaf-dot' }),
      el('span', { class: 'nav-label', text: app.name }),
      app.errors ? el('span', { class: 'host-err', text: String(app.errors) }) : null,
      el('span', { class: 'side-count', text: String(app.count) }),
    ]);
    row.addEventListener('click', () => store.setAppFilter(app.name));
    return row;
  })));

  tree.appendChild(groupRow('Domains', hosts.length, 'Domains', hosts.map((node) => {
    const row = el('a', {
      class: `tree-leaf${store.state.hostFilter === node.host ? ' active' : ''}`,
      title: `${node.host} · ${formatSize(node.bytes)}`,
    }, [
      el('span', { class: 'leaf-dot' }),
      el('span', { class: 'nav-label', text: node.host || '(direct)' }),
      node.errors ? el('span', { class: 'host-err', text: String(node.errors) }) : null,
      el('span', { class: 'side-count', text: String(node.count) }),
    ]);
    row.addEventListener('click', () => store.setHostFilter(node.host));
    return row;
  })));
};

export const init = () => {
  restoreSections();
  bindSections();
  document.querySelectorAll('#fav-nav a, #scope-all').forEach((a) => {
    a.addEventListener('click', () => store.setScope(a.dataset.scope));
  });
  $('#side-filter-input').addEventListener('input', (e) => store.setSidebarQuery(e.target.value));
  $('#side-add').addEventListener('click', () => {
    document.getElementById('filter-bar').classList.add('open');
    $('#filter-value').focus();
  });
};
