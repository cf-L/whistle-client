import { $ } from './util.js';

let timer;
export const toast = (msg) => {
  const node = $('#toast');
  node.textContent = msg;
  node.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => node.classList.remove('show'), 2200);
};

export const confirmDialog = (msg) => window.confirm(msg); // eslint-disable-line no-alert
export const promptDialog = (msg, value) => window.prompt(msg, value || ''); // eslint-disable-line no-alert

// Lightweight hover tooltips: native `title` popups are slow and unstyled, so
// the markup keeps its title until boot swaps it for data-tip.
let tipNode;
let tipTimer;
let tipTarget;
let tipAnchorBox;

const removeTipNode = () => {
  if (tipNode) {
    tipNode.remove();
    tipNode = null;
  }
};

const hideTip = () => {
  clearTimeout(tipTimer);
  tipTimer = null;
  tipTarget = null;
  tipAnchorBox = null;
  removeTipNode();
};

const showTip = (target) => {
  tipTimer = null;
  const text = target.dataset.tip;
  const box = tipAnchorBox;
  if (!text || !box) {
    return;
  }
  // Showing a tooltip must not clear its hover target. The request list and
  // sidebar replace rows while polling; losing the target here made every
  // replacement start the hover cycle again and caused a visible flash.
  removeTipNode();
  tipNode = document.createElement('div');
  tipNode.className = 'tip';
  tipNode.textContent = text;
  document.body.appendChild(tipNode);
  const tip = tipNode.getBoundingClientRect();
  const left = Math.min(
    window.innerWidth - tip.width - 8,
    Math.max(8, box.left + (box.width - tip.width) / 2),
  );
  const below = box.bottom + 8;
  const top = below + tip.height > window.innerHeight - 8 ? box.top - tip.height - 8 : below;
  tipNode.style.left = `${left}px`;
  tipNode.style.top = `${top}px`;
  requestAnimationFrame(() => tipNode && tipNode.classList.add('show'));
};

// Polling replaces list/sidebar rows even when the text under the pointer is
// unchanged. Treat an equivalent node in the same screen position as the same
// hover target so an already visible tooltip remains stable.
const sameTipAnchor = (next) => {
  if (!tipTarget || !tipAnchorBox || tipTarget.dataset.tip !== next.dataset.tip) {
    return false;
  }
  const nextBox = next.getBoundingClientRect();
  return Math.abs(tipAnchorBox.left - nextBox.left) < 1
    && Math.abs(tipAnchorBox.top - nextBox.top) < 1
    && Math.abs(tipAnchorBox.width - nextBox.width) < 1
    && Math.abs(tipAnchorBox.height - nextBox.height) < 1;
};

// Nodes rendered later keep using `title`, so adopt it on first hover.
const adopt = (node) => {
  const title = node.getAttribute('title');
  if (title) {
    node.dataset.tip = title;
    node.removeAttribute('title');
  }
  return node;
};

export const initTooltips = () => {
  document.querySelectorAll('[title]').forEach(adopt);
  document.addEventListener('mouseover', (e) => {
    const found = e.target.closest('[data-tip], [title]');
    const target = found && adopt(found);
    if (!target) {
      hideTip();
      return;
    }
    if (tipTarget === target) {
      return;
    }
    if (sameTipAnchor(target)) {
      tipTarget = target;
      tipAnchorBox = target.getBoundingClientRect();
      return;
    }
    hideTip();
    tipTarget = target;
    tipAnchorBox = target.getBoundingClientRect();
    tipTimer = setTimeout(() => {
      if (tipTarget) {
        showTip(tipTarget);
      }
    }, 320);
  });
  // Only hide when the pointer leaves the page. Capturing `mouseleave` on the
  // document also observes descendant transitions and DOM replacement.
  document.documentElement.addEventListener('mouseleave', hideTip);
  document.addEventListener('mousedown', hideTip);
  document.addEventListener('wheel', hideTip, { passive: true });
  window.addEventListener('blur', hideTip);
};
