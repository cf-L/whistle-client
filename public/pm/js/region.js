// Which part of the UI a keystroke belongs to. Shortcuts used to be handled in
// a fixed order regardless of what the user was working in, so Escape inside a
// tool dialog was answered by the URL filter behind it.
//
// Two things decide the answer: an overlay on screen owns the keyboard while it
// is up, and below that the region is wherever the last click or focus landed.

const SCOPES = [
  ['#modal-root', 'modal'],
  ['#filter-bar', 'filter'],
  ['#detail', 'inspector'],
  ['#sidebar', 'sidebar'],
];

let last = 'list';
let inspectorNode = null;

const scopeOf = (node) => {
  if (!node || !node.closest) {
    return null;
  }
  const hit = SCOPES.find(([selector]) => node.closest(selector));
  return hit ? hit[1] : 'list';
};

const track = (node) => {
  const scope = scopeOf(node);
  if (!scope) {
    return;
  }
  if (scope === 'inspector') {
    inspectorNode = node;
  }
  last = scope;
};

document.addEventListener('mousedown', (e) => track(e.target), true);
document.addEventListener('focusin', (e) => track(e.target), true);

export const isModalOpen = () => {
  const root = document.querySelector('#modal-root');
  return !!(root && root.childElementCount);
};

// A modal is a blocking layer: while it is up every key belongs to it, whatever
// was clicked last. The click is otherwise authoritative, because list rows are
// not focusable and asking the DOM where focus is would keep answering with the
// last text field touched.
export const current = () => {
  if (isModalOpen()) {
    return 'modal';
  }
  return last === 'modal' ? 'list' : last;
};

// The pane the inspector shortcuts act on: the caret's, or the last click's.
export const lastInspectorNode = () => {
  const active = document.activeElement;
  if (active && active.closest && active.closest('#detail-body')) {
    return active;
  }
  return inspectorNode && document.body.contains(inspectorNode) ? inspectorNode : null;
};
