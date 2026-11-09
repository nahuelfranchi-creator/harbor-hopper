// Harbor Hopper front end. All data comes from our own server (/api/*), which
// fetches everything live. Nothing about stops, routes, times or fares lives here.
import { shortLabel, nameContains } from './shared/names.mjs';
import {
  origins, outbound, roundTripOrigins, roundTripDestinations, hasEdge,
  loadConfig, saveConfig, defaultConfig, nearerTab,
} from './shared/pickers.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  stops: [], byId: {}, net: null, defaults: null, cfg: null,
  custom: null, tab: 'tab1', manualTab: false, day: null, refreshMs: 30000,
  lastBoard: null, loading: false,
};
const CUSTOM_KEY = 'harborHopper.custom.v1';

// ---------- helpers ----------
const nyDayType = () => {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date());
  return wd === 'Sat' || wd === 'Sun' ? 'weekend' : 'weekday';
};
const optionLabel = (id) => {
  const s = S.byId[id];
  if (!s) return id;
  const dup = S.stops.some((o) => o.id !== id && o.name === s.name);
  return dup ? `${s.name} (${s.operator})` : s.name;
};
const sortByName = (ids) => ids.slice().sort((a, b) => optionLabel(a).localeCompare(optionLabel(b)));

function fillSelect(sel, ids, value, { disabledText } = {}) {
  if (disabledText) {
    sel.innerHTML = `<option>${esc(disabledText)}</option>`;
    sel.disabled = true;
    return null;
  }
  const list = sortByName(ids);
  sel.disabled = list.length === 0;
  sel.innerHTML = list.length ? list.map((id) => `<option value="${esc(id)}">${esc(optionLabel(id))}</option>`).join('')
    : '<option>No direct ferries from here</option>';
  const v = list.includes(value) ? value : list[0] ?? null;
  if (v) sel.value = v;
  return v;
}

const pairFor = (tab) => (tab === 'custom' ? S.custom : S.cfg[tab]);

function fmtCountdown(ms) {
  const mins = Math.round((ms - Date.now()) / 60000);
  if (mins <= 0) return 'Departing now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `in ${h} h ${m} min`;
}

function delayBadge(d) {
  if (d == null) return '';
  if (d > 0) return `<span class="badge late">+${d} MIN LATE</span>`;
  if (d < 0) return `<span class="badge early">${-d} MIN EARLY</span>`;
  return '<span class="badge ontime">ON TIME</span>';
}
const modeBadge = (m) => (m === 'shuttle bus' ? '<span class="badge mode">🚌 SHUTTLE BUS</span>' : '');

// ---------- rendering ----------
function renderTabs() {
  $('tab-tab1').textContent = `${shortLabel(S.byId[S.cfg.tab1.from]?.name)} →`;
  $('tab-tab2').textContent = `${shortLabel(S.byId[S.cfg.tab2.from]?.name)} →`;
  $('tab-tab1').title = `${S.byId[S.cfg.tab1.from]?.name} → ${S.byId[S.cfg.tab1.to]?.name}`;
  $('tab-tab2').title = `${S.byId[S.cfg.tab2.from]?.name} → ${S.byId[S.cfg.tab2.to]?.name}`;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
  $('customPick').hidden = S.tab !== 'custom';
  if (S.tab === 'custom') renderCustomPickers();
}

function renderCustomPickers() {
  const from = fillSelect($('cFrom'), origins(S.net), S.custom.from);
  const to = fillSelect($('cTo'), outbound(S.net, from), S.custom.to);
  S.custom = { from, to };
  const canSwap = hasEdge(S.net, to, from);
  $('swapBtn').disabled = !canSwap;
  $('swapBtn').title = canSwap ? 'Swap' : 'No direct boat back the other way';
}

function renderTop(data) {
  const t = data.top, card = $('topCard');
  const route = `<p class="route">${esc(t.from)} → ${esc(t.to)}</p>`;
  const badge = t.badge ? `<span class="badge ${t.badge}">${t.badge}</span>` : '';
  let html = route;
  if (t.next) {
    const n = t.next;
    html += `<div class="row">${badge}${n.badge === 'LIVE' ? delayBadge(n.delayMin) : ''}${modeBadge(n.mode)}</div>`;
    html += `<p class="heading">${esc(t.heading)}</p>`;
    html += `<p class="big">${esc(n.clock)}</p><p class="countdown" data-dep="${n.depAtMs}">${fmtCountdown(n.depAtMs)}</p>`;
    if (n.badge === 'LIVE') html += `<p class="msg muted">Real-time estimate from the live feed.</p>`;
  } else {
    html += `<div class="row">${badge}</div><p class="heading">${esc(t.heading)}</p>`;
    if (t.nextService) html += `<p class="big">${esc(t.nextService.clock)}</p><p class="msg"><strong>${esc(t.nextService.dateLabel)}</strong> · official schedule</p>`;
  }
  if (t.message) html += `<p class="msg">${esc(t.message)}</p>`;
  if (t.why) html += `<p class="msg muted">${esc(t.why)}</p>`;
  if (t.dockNote) html += `<p class="note">${esc(t.dockNote)}</p>`;
  if (t.then?.length) {
    html += `<p class="then-label">THEN</p><ul class="then">${t.then.map((x) =>
      `<li>${esc(x.clock)} <span class="badge ${x.badge}">${x.badge}</span>${x.badge === 'LIVE' && x.delayMin ? delayBadge(x.delayMin) : ''}${x.mode === 'shuttle bus' ? ' 🚌' : ''}</li>`).join('')}</ul>`;
  }
  card.innerHTML = html;

  const f = data.footer;
  $('boardLink').innerHTML = f.boardUrl
    ? `<a href="${esc(f.boardUrl)}" target="_blank" rel="noopener">${esc(f.boardLabel)}</a>`
    : `${esc(f.boardLabel)}: no public board link found for this stop`;
  $('fare').textContent = f.fare;
}

function renderSchedule(s) {
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.day === S.day));
  const body = $('schedBody');
  if (!s.found) { body.innerHTML = `<p class="msg">${esc(s.message)}</p>`; return; }
  body.innerHTML = `<p class="day-label">${esc(s.dayLabel)} <span class="muted">(${esc(s.dateLabel)})</span></p>` +
    `<ul class="times">${s.times.map((x) => `<li class="${x.mode === 'shuttle bus' ? 'bus' : ''}">${esc(x.clock)}${x.mode === 'shuttle bus' ? ' 🚌' : ''}</li>`).join('')}</ul>` +
    (s.notes || []).map((n) => `<p class="note">${esc(n)}</p>`).join('');
}

// ---------- data loading ----------
async function api(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}

async function refresh() {
  const p = pairFor(S.tab);
  if (!p?.from || !p?.to || S.loading) return;
  S.loading = true;
  $('refreshBtn').disabled = true;
  const q = `from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}`;
  try {
    const [board, sched] = await Promise.all([api(`/api/board?${q}`), api(`/api/schedule?${q}&day=${S.day}`)]);
    if (pairFor(S.tab) !== p) return; // tab changed mid-flight
    renderTop(board);
    renderSchedule(sched);
    $('updatedPill').textContent = `Updated ${new Date(board.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch (e) {
    $('topCard').innerHTML = `<p class="heading">CAN'T CHECK RIGHT NOW</p><p class="msg">Live data couldn't be loaded (${esc(e.message)}). Try Refresh in a moment.</p>`;
  } finally {
    S.loading = false;
    $('refreshBtn').disabled = false;
  }
}

async function refreshSchedule() {
  const p = pairFor(S.tab);
  const q = `from=${encodeURIComponent(p.from)}&to=${encodeURIComponent(p.to)}&day=${S.day}`;
  try { renderSchedule(await api(`/api/schedule?${q}`)); } catch (e) { $('schedBody').innerHTML = `<p class="msg">Schedule unavailable (${esc(e.message)}).</p>`; }
}

function setTab(tab, manual) {
  if (manual) S.manualTab = true;
  S.tab = tab;
  renderTabs();
  updateLocPill();
  refresh();
}

// ---------- geolocation ----------
let lastPos = null;
function updateLocPill() {
  const pill = $('locPill');
  if (!lastPos) return;
  const which = nearerTab(lastPos, S.byId, S.cfg);
  const name = S.byId[S.cfg[which].from]?.name || '';
  pill.textContent = `📍 Near ${shortLabel(name)}`;
  pill.title = `Nearest home endpoint: ${name}`;
}
function locate() {
  if (!navigator.geolocation) { $('locPill').textContent = '📍 Location off'; return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    lastPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    updateLocPill();
    if (!S.manualTab) setTab(nearerTab(lastPos, S.byId, S.cfg), false);
  }, () => { $('locPill').textContent = '📍 Location off'; }, { timeout: 8000, maximumAge: 300000 });
}

// ---------- settings modal ----------
let draft = null, lastFocus = null;

function renderModal() {
  $('rtToggle').checked = draft.roundTrip;
  $('rtOn').hidden = !draft.roundTrip;
  $('rtOff').hidden = draft.roundTrip;
  if (!S.net) {
    for (const id of ['sFrom', 'sTo', 's1From', 's1To', 's2From', 's2To']) fillSelect($(id), [], null, { disabledText: 'Checking which routes exist…' });
    $('saveBtn').disabled = true;
    return;
  }
  $('saveBtn').disabled = false;
  if (draft.roundTrip) {
    const rto = roundTripOrigins(S.net);
    const from = fillSelect($('sFrom'), rto, draft.tab1.from);
    const to = fillSelect($('sTo'), roundTripDestinations(S.net, from), draft.tab1.to);
    draft.tab1 = { from, to };
    draft.tab2 = { from: to, to: from };
    $('rtHint').textContent = `${rto.length} stops have a direct round trip. The return tab is automatic.`;
  } else {
    const o = origins(S.net);
    const f1 = fillSelect($('s1From'), o, draft.tab1.from);
    draft.tab1 = { from: f1, to: fillSelect($('s1To'), outbound(S.net, f1), draft.tab1.to) };
    const f2 = fillSelect($('s2From'), o, draft.tab2.from);
    draft.tab2 = { from: f2, to: fillSelect($('s2To'), outbound(S.net, f2), draft.tab2.to) };
  }
  $('saveBtn').disabled = !draft.tab1.to || !draft.tab2.to;
}

function openModal() {
  draft = structuredClone(S.cfg);
  lastFocus = document.activeElement;
  $('modal').hidden = false;
  renderModal();
  $('rtToggle').focus();
}
function closeModal() { $('modal').hidden = true; lastFocus?.focus(); }

function wireModal() {
  $('gearBtn').onclick = openModal;
  $('cancelBtn').onclick = closeModal;
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if ($('modal').hidden) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...$('modal').querySelectorAll('button, select, input')].filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  });
  $('rtToggle').onchange = (e) => {
    draft.roundTrip = e.target.checked;
    if (!draft.roundTrip) draft.tab2 = { from: draft.tab1.to, to: draft.tab1.from }; // prefill return as reverse
    // turning back ON collapses to the outbound pair (renderModal re-validates it)
    renderModal();
  };
  $('sFrom').onchange = (e) => { draft.tab1 = { from: e.target.value, to: null }; renderModal(); };
  $('sTo').onchange = (e) => { draft.tab1.to = e.target.value; renderModal(); };
  $('s1From').onchange = (e) => { draft.tab1 = { from: e.target.value, to: null }; renderModal(); };
  $('s1To').onchange = (e) => { draft.tab1.to = e.target.value; renderModal(); };
  $('s2From').onchange = (e) => { draft.tab2 = { from: e.target.value, to: null }; renderModal(); };
  $('s2To').onchange = (e) => { draft.tab2.to = e.target.value; renderModal(); };
  $('resetBtn').onclick = () => { draft = defaultConfig(S.defaults); renderModal(); };
  $('saveBtn').onclick = () => {
    // final guard: never save a pair the network doesn't list
    if (!hasEdge(S.net, draft.tab1.from, draft.tab1.to) || !hasEdge(S.net, draft.tab2.from, draft.tab2.to)) return;
    S.cfg = draft;
    saveConfig(localStorage, S.cfg);
    closeModal();
    renderTabs();
    updateLocPill();
    if (S.tab !== 'custom') refresh();
  };
}

// ---------- boot ----------
function wireUi() {
  for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => setTab(b.dataset.tab, true);
  $('refreshBtn').onclick = refresh;
  for (const b of document.querySelectorAll('.seg button')) b.onclick = () => { S.day = b.dataset.day; refreshSchedule(); };
  $('cFrom').onchange = (e) => { S.custom = { from: e.target.value, to: null }; renderCustomPickers(); saveCustom(); refresh(); };
  $('cTo').onchange = (e) => { S.custom.to = e.target.value; saveCustom(); refresh(); };
  $('swapBtn').onclick = () => { if (hasEdge(S.net, S.custom.to, S.custom.from)) { S.custom = { from: S.custom.to, to: S.custom.from }; renderCustomPickers(); saveCustom(); refresh(); } };
  wireModal();
  setInterval(() => { for (const el of document.querySelectorAll('.countdown[data-dep]')) el.textContent = fmtCountdown(Number(el.dataset.dep)); }, 15000);
}
function saveCustom() { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(S.custom)); } catch { /* ignore */ } }
function loadCustom() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null'); } catch { c = null; }
  return c && hasEdge(S.net, c.from, c.to) ? c : { ...S.cfg.tab1 };
}

async function boot() {
  S.day = nyDayType();
  wireUi();
  let meta = await api('/api/meta');
  S.stops = meta.stops;
  S.byId = Object.fromEntries(meta.stops.map((s) => [s.id, s]));
  S.refreshMs = meta.refreshMs || S.refreshMs;
  if (!meta.network.ready) meta = await api('/api/meta?wait=1'); // pickers stay disabled until then
  if (!meta.network.ready || !meta.defaults) {
    $('topCard').innerHTML = `<p class="heading">CAN'T CHECK RIGHT NOW</p><p class="msg">The published route network couldn't be loaded, so routes can't be checked. Try again shortly.</p>`;
    return;
  }
  S.net = meta.network;
  S.defaults = meta.defaults;
  const resolveName = (name) => S.stops.find((s) => nameContains(s.name, name) && outbound(S.net, s.id).length)?.id ?? null;
  S.cfg = loadConfig(localStorage, S.net, S.defaults, resolveName); // validates + repairs + saves silently
  S.custom = loadCustom();
  renderTabs();
  refresh();
  locate();
  setInterval(refresh, S.refreshMs);
}

boot().catch((e) => {
  $('topCard').innerHTML = `<p class="heading">CAN'T CHECK RIGHT NOW</p><p class="msg">${esc(e.message)}</p>`;
});
