const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, body) {
    const r = await fetch(path, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
    const data = await r.json(); if (!r.ok) throw Error(data.error ?? `Request failed (${r.status})`); return data;
}
let templates = [], inspection = null, selection = null, liveBusy = false, moveDirty = false, pollError = false;
const dirty = () => { window.QB_CUSTOM_SCENARIO = undefined; $('lab-save-status').textContent = 'Unsaved changes'; };
function itemRow(item, equipment = false) {
    return `<div class="lab-row" data-item-row><label>Item ID <input data-item-id type="number" min="0" value="${esc(item.id ?? 995)}"></label>${equipment ? `<label>Slot <input data-item-slot type="number" min="0" max="13" value="${esc(item.slot ?? 3)}"></label>` : `<label>Count <input data-item-count type="number" min="1" value="${esc(item.count ?? 1)}"></label>`}<button type="button" data-remove-item>Remove</button></div>`;
}
function renderConfig(config) {
    $('lab-title').value = config.title; $('lab-minutes').value = config.minutes;
    $('lab-item-player').innerHTML = config.roles.map((r, i) => `<option value="${i}">${esc(r.username)}</option>`).join('');
    $('lab-roles').innerHTML = config.roles.map((r, i) => `<fieldset class="lab-role" data-role="${i}"><div class="lab-row"><label>Player <input data-name value="${esc(r.username)}" ${i === 0 ? 'readonly' : ''}></label><label>Session <select data-policy><option value="continue" ${r.sessionPolicy === 'continue' ? 'selected' : ''}>Continue pursuing goals</option><option value="finish" ${r.sessionPolicy !== 'continue' ? 'selected' : ''}>Stop on final answer</option></select></label>${i ? '<button type="button" data-remove-role>Remove player</button>' : ''}</div><label class="is-size-7">Private goals and knowledge<textarea class="textarea is-small" data-brief>${esc(r.brief)}</textarea></label><div class="lab-row"><label>X <input data-x type="number" value="${r.position.x}"></label><label>Z <input data-z type="number" value="${r.position.z}"></label><label>Level <input data-level type="number" min="0" max="3" value="${r.position.level ?? 0}"></label></div>${['inventory', 'equipment', 'bank'].map(store => `<details><summary>Starting ${store}</summary><div data-store="${store}">${(store === 'equipment' ? r.worn : r[store] ?? []).map(it => itemRow(it, store === 'equipment')).join('')}</div><button type="button" data-add-item="${store}">Add item</button></details>`).join('')}</fieldset>`).join('');
    dirty();
}
function config() {
    return { title: $('lab-title').value, minutes: Number($('lab-minutes').value), roles: [...document.querySelectorAll('[data-role]')].map(role => {
        const read = name => role.querySelector(`[data-${name}]`).value;
        const store = name => [...role.querySelector(`[data-store="${name}"]`).querySelectorAll('[data-item-row]')].map(row => ({ id: Number(row.querySelector('[data-item-id]').value), ...(name === 'equipment' ? { slot: Number(row.querySelector('[data-item-slot]').value) } : { count: Number(row.querySelector('[data-item-count]').value) }) }));
        return { username: read('name'), brief: read('brief'), sessionPolicy: read('policy'), position: { x: Number(read('x')), z: Number(read('z')), level: Number(read('level')) }, inventory: store('inventory'), worn: store('equipment'), bank: store('bank') };
    }) };
}
$('lab-roles').oninput = dirty;
$('lab-title').oninput = $('lab-minutes').oninput = dirty;
$('lab-roles').onclick = e => {
    if (e.target.matches('[data-remove-item]')) { e.target.closest('[data-item-row]').remove(); dirty(); }
    if (e.target.matches('[data-add-item]')) { const store = e.target.dataset.addItem; e.target.closest('[data-role]').querySelector(`[data-store="${store}"]`).insertAdjacentHTML('beforeend', itemRow({}, store === 'equipment')); dirty(); }
    if (e.target.matches('[data-remove-role]')) { const c = config(); c.roles.splice(Number(e.target.closest('[data-role]').dataset.role), 1); renderConfig(c); }
};
$('lab-add-player').onclick = () => {
    const c = config(); if (c.roles.length >= 4) { $('lab-save-status').textContent = 'Up to four players per session'; return; }
    let n = 1; while (c.roles.some(r => r.username === 'partner0' + n)) n++;
    c.roles.push({ username: 'partner0' + n, brief: 'Build a secure future in Gielinor. Make your own plans, seek useful work and decide whether to cooperate with others.', sessionPolicy: 'continue', position: { x: 3222 + c.roles.length, z: 3218 }, inventory: [], worn: [], bank: [] }); renderConfig(c);
};
$('lab-load').onclick = () => { const template = templates.find(t => t.id === $('lab-template').value); if (template) { renderConfig(template.config); if (template.savedId) { window.QB_CUSTOM_SCENARIO = template.savedId; $('l-scenario').value = 'lab'; $('l-scenario').dispatchEvent(new Event('change')); $('lab-save-status').textContent = 'Loaded saved custom session'; } } };
$('lab-item-find').onclick = async () => {
    try {
        const items = await api('/api/operator/items?q=' + encodeURIComponent($('lab-item-query').value));
        $('lab-item-results').innerHTML = items.map(x => `<button type="button" data-catalog-id="${x.id}" data-wearpos="${x.wearpos}">${esc(x.name)} · ${x.id}</button>`).join('') || 'No matching item';
    } catch (e) { $('lab-item-results').textContent = 'Item search needs a running local world: ' + e.message; }
};
$('lab-item-results').onclick = e => {
    const button = e.target.closest('[data-catalog-id]'); if (!button) return;
    const store = $('lab-item-store').value, role = document.querySelector(`[data-role="${Number($('lab-item-player').value)}"]`);
    if (store === 'equipment' && Number(button.dataset.wearpos) < 0) { $('lab-save-status').textContent = 'That item cannot be equipped'; return; }
    role.querySelector(`[data-store="${store}"]`).insertAdjacentHTML('beforeend', itemRow({ id: Number(button.dataset.catalogId), count: 1, slot: Number(button.dataset.wearpos) }, store === 'equipment'));
    role.querySelector(`[data-store="${store}"]`).closest('details').open = true; dirty();
};
$('lab-save').onclick = async () => {
    try { const saved = await api('/api/scenarios', config()); window.QB_CUSTOM_SCENARIO = saved.id; $('lab-save-status').textContent = 'Saved · custom session ready'; $('l-scenario').value = 'lab'; $('l-scenario').dispatchEvent(new Event('change')); }
    catch (e) { $('lab-save-status').textContent = e.message; }
};
function syncScenario() {
    const value = $('l-scenario').value;
    $('l-duo-variant').closest('.field').classList.toggle('is-hidden', value !== 'duo');
    if (value.startsWith('workshop-')) $('l-note').textContent = value.endsWith('livelihood') ? '20-minute exploratory session. Agents plan for the future and choose their own priorities.' : '20-minute task. Distant partners have private complementary clues.';
    if (value === 'lab') { $('scenario-editor').open = true; $('l-note').textContent = 'Custom exploratory session · two to four private roles. Additional players use the default model.'; }
}
$('l-scenario').addEventListener('change', syncScenario);
api('/api/scenarios').then(rows => { templates = rows; $('lab-template').innerHTML = rows.map(t => `<option value="${esc(t.id)}">${esc(t.config.title)} · ${esc(t.id)}</option>`).join(''); const selected = rows.find(t => t.id === 'a0-workshop-livelihood-20m') ?? rows[0]; if (selected) { $('lab-template').value = selected.id; renderConfig(selected.config); } syncScenario(); }).catch(e => { $('lab-save-status').textContent = e.message; });

function showSlots() {
    const slots = inspection?.stores?.[$('inspect-store').value] ?? [];
    const visible = $('inspect-store').value === 'bank' ? [...slots.filter(x => x.id !== null), slots.find(x => x.id === null)].filter(Boolean) : slots;
    $('inspect-slots').innerHTML = visible.map(x => `<button type="button" class="lab-slot" data-slot="${x.slot}"><b>${x.slot}</b> ${x.id === null ? 'empty' : esc(x.name) + ' × ' + x.count}</button>`).join('');
    if (inspection?.position) $('inspect-position').textContent = `${inspection.username} · ${inspection.position.x}, ${inspection.position.z} · level ${inspection.position.level}`;
}
function clearSelection() { selection = null; $('edit-apply').disabled = $('edit-remove').disabled = true; $('edit-selection').textContent = 'Select a slot to edit.'; showSlots(); }
$('inspect-store').onchange = clearSelection;
$('inspect-slots').onclick = e => {
    const button = e.target.closest('[data-slot]'); if (!button || !inspection) return;
    const slot = Number(button.dataset.slot), store = $('inspect-store').value, item = inspection.stores[store][slot];
    selection = { container: inspection.container, username: inspection.username.toLowerCase(), expectedRevision: inspection.revisions?.[store] ?? inspection.revision, store, slot };
    $('edit-selection').textContent = `${inspection.username} · ${store} slot ${slot} · ${item.name || 'empty'}`;
    $('edit-id').value = item.id ?? ''; $('edit-count').value = item.count || 1;
    $('edit-apply').disabled = $('edit-remove').disabled = false;
};
async function change(body) {
    try {
        if (!inspection) throw Error('Inspect a player first');
        const result = await api('/api/operator/player?player=' + encodeURIComponent(body.username), { ...body, reason: $('edit-reason').value });
        inspection = result; clearSelection(); $('operator-status').textContent = 'Applied · intervention recorded with the run';
        moveDirty = false;
    } catch (e) { $('operator-status').textContent = e.message; }
}
$('edit-apply').onclick = () => { if (!$('edit-id').value.trim() && Number($('edit-count').value) !== 0) { $('operator-status').textContent = 'Choose an item ID first'; return; } if (selection) change({ ...selection, action: 'set-slot', item: Number($('edit-count').value) === 0 ? null : { id: Number($('edit-id').value), count: Number($('edit-count').value) } }); };
$('edit-remove').onclick = () => selection && change({ ...selection, action: 'set-slot', item: null });
$('edit-move').onclick = () => inspection && change({ container: inspection.container, username: inspection.username.toLowerCase(), expectedRevision: inspection.revisions?.position ?? inspection.revision, action: 'move', position: { x: Number($('edit-x').value), z: Number($('edit-z').value), level: Number($('edit-level').value) } });
$('inspect-player').onchange = () => { inspection = null; clearSelection(); pollWorld(); };
$('inspect-refresh').onclick = () => { selection = null; moveDirty = false; pollWorld(); };
['edit-x', 'edit-z', 'edit-level'].forEach(id => $(id).oninput = () => { moveDirty = true; });
function tradeView(player) {
    const trade = player.trade, overlay = $('trade-overlay');
    overlay.classList.toggle('is-hidden', !trade?.isOpen);
    if (!trade?.isOpen) return;
    const offer = items => (items ?? []).map(x => `<span class="trade-item"><img src="/api/operator/sprite?id=${Number(x.id)}&count=${Math.max(1, Number(x.count ?? x.amount ?? 1))}" alt="">${esc(x.name ?? 'Item ' + x.id)} × ${esc(x.count ?? x.amount ?? 1)}</span>`).join('') || '<span>Nothing offered</span>';
    overlay.innerHTML = `<header>${trade.screen === 'confirm' ? 'Confirm trade' : 'Trading with ' + esc(trade.partner ?? 'player')}</header><div class="trade-offers"><div><b>${esc(player.username)} gives</b><br>${offer(trade.myOffer)}<p>${trade.myAccepted ? 'Accepted' : 'Not accepted'}</p></div><div><b>${esc(trade.partner ?? 'Partner')} gives</b><br>${offer(trade.theirOffer)}<p>${trade.partnerAccepted ? 'Accepted' : 'Not accepted'}</p></div></div><div class="trade-note">Live trade mirror · observer only · ${esc(trade.screen ?? 'offer')}</div>`;
}
async function pollWorld() {
    if (liveBusy) return; liveBusy = true;
    try {
        const world = await api('/api/operator/players');
        if (pollError) { $('operator-status').textContent = ''; pollError = false; }
        if (inspection && inspection.container !== world.container) { inspection = null; selection = null; moveDirty = false; clearSelection(); }
        const select = $('inspect-player'), current = select.value;
        const names = world.players.map(p => String(p[1]).toLowerCase());
        if (JSON.stringify([...select.options].map(o => o.value)) !== JSON.stringify(names)) { select.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join(''); if (names.includes(current)) select.value = current; }
        for (const pane of ['a', 'b']) { const target = $('camera-target-' + pane), selected = target.value; for (const n of names) if (![...target.options].some(o => o.value === n)) target.add(new Option('Follow ' + n, n)); target.value = selected; }
        if (select.value) {
            const [player, trades] = await Promise.all([api('/api/operator/player?player=' + encodeURIComponent(select.value)), api('/api/operator/trades?players=' + encodeURIComponent(names.join(',')))]);
            if (!selection) { inspection = player; showSlots(); if (!moveDirty) { $('edit-x').value = player.position.x; $('edit-z').value = player.position.z; $('edit-level').value = player.position.level; } }
            const currentTrade = trades.find(t => t.username === select.value && t.trade?.isOpen) ?? trades.find(t => t.trade?.isOpen);
            tradeView(currentTrade ?? { trade: null });
        }
    } catch (e) { pollError = true; $('operator-status').textContent = e.message; $('trade-overlay').classList.add('is-hidden'); }
    finally { liveBusy = false; }
}
setInterval(pollWorld, 1000); pollWorld();

let recorder, stream;
$('observer-record').onclick = async () => {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 20 } }, audio: false, preferCurrentTab: true });
        const chunks = [];
        recorder = new MediaRecorder(stream, { videoBitsPerSecond: 2_000_000 });
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })); const a = document.createElement('a'); a.href = url; a.download = 'questbench-observer-' + new Date().toISOString().replace(/[:.]/g, '-') + (recorder.mimeType.includes('mp4') ? '.mp4' : '.webm'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); $('observer-record').textContent = 'Record Studio tab'; };
        stream.getVideoTracks()[0].onended = () => { if (recorder.state === 'recording') recorder.stop(); };
        recorder.start(1000); $('observer-record').textContent = 'Stop recording';
    } catch (e) { $('observer-status').textContent = 'Recording unavailable: ' + e.message; }
};
