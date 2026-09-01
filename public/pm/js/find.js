import { el } from './util.js';

// In-pane text search for the inspector. ⌘F over the request list filters the
// list; over a response body people expect to search the body itself, which is
// what this provides — the shell's global find bar is a page-level search that
// cannot see into the virtualised list, so the UI owns both behaviours.

const HIT = 'find-hit';
const CURRENT = 'find-hit-current';

let bar;
let input;
let counter;
let target;
let hits = [];
let index = -1;

const clearHits = () => {
  hits.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
  hits = [];
  index = -1;
};

// Collect text nodes first: wrapping matches mutates the tree, and walking it
// live would revisit the text just inserted.
const textNodes = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (!parent || parent.closest('.find-bar') || parent.closest('.viewer-tools')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const list = [];
  let node = walker.nextNode();
  while (node) {
    list.push(node);
    node = walker.nextNode();
  }
  return list;
};

const markMatches = (root, query) => {
  const needle = query.toLowerCase();
  textNodes(root).forEach((node) => {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    let from = lower.indexOf(needle);
    if (from === -1) {
      return;
    }
    const frag = document.createDocumentFragment();
    let cursor = 0;
    while (from !== -1) {
      if (from > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, from)));
      }
      const mark = document.createElement('mark');
      mark.className = HIT;
      mark.textContent = text.slice(from, from + query.length);
      frag.appendChild(mark);
      hits.push(mark);
      cursor = from + query.length;
      from = lower.indexOf(needle, cursor);
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    node.parentNode.replaceChild(frag, node);
  });
};

const showCurrent = () => {
  hits.forEach((mark) => mark.classList.remove(CURRENT));
  const mark = hits[index];
  if (!mark) {
    return;
  }
  mark.classList.add(CURRENT);
  mark.scrollIntoView({ block: 'center', behavior: 'auto' });
};

const update = () => {
  clearHits();
  const query = input.value;
  if (query && target) {
    markMatches(target, query);
  }
  index = hits.length ? 0 : -1;
  counter.textContent = query ? `${hits.length ? 1 : 0}/${hits.length}` : '';
  showCurrent();
};

const step = (delta) => {
  if (!hits.length) {
    return;
  }
  index = (index + delta + hits.length) % hits.length;
  counter.textContent = `${index + 1}/${hits.length}`;
  showCurrent();
};

export const close = () => {
  clearHits();
  if (target) {
    target.classList.remove('finding');
  }
  if (bar) {
    bar.remove();
    bar = null;
  }
  target = null;
};

export const isOpen = () => !!bar;

const build = () => {
  input = el('input', {
    class: 'find-input',
    type: 'text',
    placeholder: 'Find in response',
    spellcheck: 'false',
    oninput: update,
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
  });
  counter = el('span', { class: 'find-count' });
  bar = el('div', { class: 'find-bar' }, [
    input,
    counter,
    el('button', { class: 'find-btn', text: '↑', title: 'Previous (⇧⏎)', onclick: () => step(-1) }),
    el('button', { class: 'find-btn', text: '↓', title: 'Next (⏎)', onclick: () => step(1) }),
    el('button', { class: 'find-btn', text: '✕', title: 'Close (Esc)', onclick: close }),
  ]);
  return bar;
};

// Which pane the search applies to: whichever the caret or the last click sits
// in, falling back to the response side since that is what people search.
const paneFor = (node) => {
  const pane = node && node.closest && node.closest('.pane');
  if (pane) {
    return pane;
  }
  const panes = Array.from(document.querySelectorAll('#detail-body .pane'));
  return panes[panes.length - 1] || null;
};

export const open = (node) => {
  const pane = paneFor(node);
  if (!pane) {
    return false;
  }
  // A JSON tree already ships a smarter filter; hand the shortcut to it.
  const treeSearch = pane.querySelector('.viewer-search');
  if (treeSearch) {
    close();
    treeSearch.focus();
    treeSearch.select();
    return true;
  }
  const scroll = pane.querySelector('.pane-scroll') || pane;
  if (bar && target === scroll) {
    input.focus();
    input.select();
    return true;
  }
  close();
  target = scroll;
  // The bar floats over the body, so keep the last lines scrollable above it.
  scroll.classList.add('finding');
  pane.appendChild(build());
  input.focus();
  update();
  return true;
};

// The inspector is rebuilt on tab switches and selection changes, which drops
// the marks; reopening on the new pane keeps the query.
export const refresh = () => {
  if (!bar || !document.body.contains(target)) {
    close();
    return;
  }
  const query = input.value;
  if (query) {
    const caret = input.selectionStart;
    update();
    input.setSelectionRange(caret, caret);
  }
};

// Which node the next ⌘F applies to: the caret if it sits in the inspector,
// otherwise the last thing clicked there.
let lastClick = null;
document.addEventListener('mousedown', (e) => {
  const node = e.target;
  if (node && node.closest && node.closest('#detail-body')) {
    lastClick = node;
  }
}, true);

export const findTarget = () => {
  const active = document.activeElement;
  if (active && active.closest && active.closest('#detail-body')) {
    return active;
  }
  return lastClick && document.body.contains(lastClick) ? lastClick : null;
};

export const inInspector = () => !!findTarget() || isOpen();
