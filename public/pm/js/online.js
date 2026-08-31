import { el, formatSize, copyText } from './util.js';
import * as store from './store.js';
import { openModal } from './tools.js';
import { toast } from './ui.js';

const pct = (value) => (value == null ? '' : String(value));

const uptime = (ms) => {
  if (!ms) {
    return '';
  }
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};

const row = (key, value, action) => el('div', { class: 'kv-row' }, [
  el('div', { class: 'kv-key', text: key }),
  el('div', { class: 'kv-val' }, [
    el('span', { text: String(value == null ? '' : value) }),
    action || null,
  ]),
]);

// Mirrors the classic UI's "Online" panel: reachable addresses plus live
// process counters, both already carried by /cgi-bin/get-data.
export const open = () => {
  const server = store.state.server || {};
  const info = server.pInfo || {};
  const port = server.port;
  const addresses = [server.host, ...(server.ipv4 || [])]
    .filter(Boolean)
    .map((host) => `http://${host}:${port}`);

  const addrList = el('div', { class: 'kv' }, addresses.map((url) => row(
    url.includes(server.host) ? 'Hostname' : 'LAN',
    url,
    el('button', {
      class: 'link-btn',
      text: 'Copy',
      onclick: async () => {
        await copyText(url);
        toast('Address copied');
      },
    }),
  )));

  const stats = el('div', { class: 'kv' }, [
    row('Requests', `${info.totalHttpRequests || 0} http · ${info.totalTunnelRequests || 0} tunnel · ${info.totalWsRequests || 0} ws`),
    row('QPS', `${info.totalQps || 0} (peak ${info.maxQps || 0})`),
    row('CPU', pct(info.cpuPercent)),
    row('Memory', formatSize((info.memUsage || {}).rss)),
    row('Uptime', uptime(info.uptime)),
  ]);

  const about = el('div', { class: 'kv' }, [
    row('Whistle', server.version),
    row('Node', server.nodeVersion),
    row('User', server.username),
    row('DNS order', server.dnsOrder === 1 ? 'IPv4 first' : 'System'),
  ]);

  openModal('Online', el('div', {}, [
    el('div', { class: 'field-label', text: 'Addresses' }),
    addrList,
    el('div', { class: 'field-label', text: 'Traffic' }),
    stats,
    el('div', { class: 'field-label', text: 'About' }),
    about,
  ]), null, 'Point another device\'s proxy at one of these addresses to capture its traffic.');
};
