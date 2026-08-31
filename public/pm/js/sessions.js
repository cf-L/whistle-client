import * as store from './store.js';
import { toast } from './ui.js';

// Sessions are exported as whistle-compatible JSON so the classic UI (and
// other whistle clients) can import the very same file.
export const exportSessions = () => {
  const items = store.visibleItems();
  if (!items.length) {
    toast('Nothing to export');
    return;
  }
  const payload = JSON.stringify(items, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `whistle-sessions-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${items.length} sessions`);
};

export const importSessions = async (file) => {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data.list || Object.values(data));
    let added = 0;
    list.forEach((item) => {
      if (!item || !item.url) {
        return;
      }
      const id = item.id || `imported-${Date.now()}-${added}`;
      if (!store.state.sessions.has(id)) {
        store.state.sessions.set(id, { ...item, id, imported: true });
        store.state.order.push(id);
        added += 1;
      }
    });
    store.emit();
    toast(`Imported ${added} sessions`);
  } catch (e) {
    toast(`Import failed: ${e.message}`);
  }
};
