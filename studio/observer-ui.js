const $ = id => document.getElementById(id);
const panes = ['a', 'b'];
const frame = pane => $('camera-' + pane);
const send = (pane, data) => frame(pane).contentWindow?.postMessage(data, location.origin);
const command = (pane, data) => send(pane, { type: 'rs-watch-command', command: { id: crypto.randomUUID(), ...data } });
let started = false, busy = false;
const cameras = new Map();
function target(pane) {
    const name = $('camera-target-' + pane).value;
    if (name === 'free') {
        const camera = cameras.get(pane);
        command(pane, { kind: 'goto', x: camera?.x ?? 3222, z: camera?.z ?? 3218, height: camera?.height ?? 70, pitch: camera?.pitch ?? -500, yaw: camera?.yaw ?? 0 });
    } else command(pane, { kind: 'follow', name });
}
for (const pane of panes) {
    $('camera-target-' + pane).onchange = () => target(pane);
    document.querySelector(`[data-overhead="${pane}"]`).onclick = () => send(pane, { type: 'rs-watch-camera-preset', preset: 'overhead' });
    document.querySelector(`[data-roofs="${pane}"]`).onchange = e => send(pane, { type: 'rs-watch-roofs', hidden: e.target.checked });
}
$('observer-fullscreen').onclick = () => document.fullscreenElement ? document.exitFullscreen() : $('observer').requestFullscreen();
window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    const pane = panes.find(p => frame(p).contentWindow === event.source);
    if (!pane) return;
    if (event.data?.type === 'rs-watch-camera') cameras.set(pane, event.data.camera);
    if (event.data?.type === 'rs-watch-scroll') window.scrollBy({ top: Number(event.data.deltaY) || 0, behavior: 'instant' });
});
async function poll() {
    if (busy) return; busy = true;
    try {
        const response = await fetch('/api/observer', { signal: AbortSignal.timeout(5000) });
        const state = await response.json();
        if (!state.ready) { $('observer-status').textContent = 'Renderer not built · run bun run viewer:build'; return; }
        if (!started) {
            started = true;
            for (const pane of panes) {
                const follow = $('camera-target-' + pane).value;
                frame(pane).src = '/viewer/?dualpane=1&follow=' + encodeURIComponent(follow) + '&cx=3222&cz=3218&cy=70&p=-500&y=0';
            }
        }
        const loading = !panes.every(p => cameras.get(p)?.ready);
        $('observer-status').textContent = state.error || (state.stale ? 'Waiting for a local trial · terrain is available' : `Live · ${state.viewers} cameras · local server`) + (loading ? ' · loading terrain' : '');
        const visible = !$('tab-live').classList.contains('is-hidden');
        for (const pane of panes) send(pane, { type: 'rs-watch-pane-config', active: true, visible, dual: true, compact: true });
    } catch { $('observer-status').textContent = 'Studio connection lost · reconnecting…'; }
    finally { busy = false; }
}
setInterval(poll, 2000);
poll();
