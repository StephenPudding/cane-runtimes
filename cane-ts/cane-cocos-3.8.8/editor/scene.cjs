'use strict';
const active = new Set();
const pendingPlay = new Map();
let timer = null;
let lastTime = 0;

function component(uuid) {
  const value = cce.Component.query(uuid);
  if (!value || typeof value.advanceEditorPreview !== 'function') throw new Error('Cane component is no longer in the scene.');
  return value;
}
function schedule() {
  if (timer !== null || !active.size) return;
  lastTime = performance.now();
  timer = setTimeout(tick, 16);
}
function tick() {
  timer = null;
  const now = performance.now();
  const dt = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  for (const uuid of active) {
    if (!cce.Component.query(uuid)) { active.delete(uuid); continue; }
    try {
      const value = component(uuid);
      value.advanceEditorPreview(dt);
      if (!value.editorPreviewPlaying) active.delete(uuid);
    } catch (error) { active.delete(uuid); console.error('[Cane preview]', error); }
  }
  cce.Engine.repaintInEditMode();
  if (active.size) timer = setTimeout(tick, 16);
}
function pauseAll() {
  pendingPlay.clear();
  if (timer !== null) clearTimeout(timer);
  timer = null;
  for (const uuid of active) {
    try { component(uuid).setEditorPreviewPlaying(false); } catch { /* Scene was released. */ }
  }
  active.clear();
}
exports.load = () => { cce.Scene.on('close', pauseAll); };
exports.unload = () => { pauseAll(); cce.Scene.off('close', pauseAll); };
exports.methods = {
  async state(uuid) {
    const value = component(uuid);
    await value.initialize();
    value.refreshConfiguration();
    const player = value.runtimePlayer;
    return { catalog: { animations: player.data.catalog.animations, skins: player.data.catalog.skins },
      playing: value.editorPreviewPlaying, time: player.timeSeconds,
      error: value.lastError ? String(value.lastError.message || value.lastError) : '' };
  },
  async play(uuid, playing) {
    if (!playing) {
      pendingPlay.delete(uuid);
      active.delete(uuid);
      if (!active.size && timer !== null) { clearTimeout(timer); timer = null; }
      const value = cce.Component.query(uuid);
      if (value && typeof value.setEditorPreviewPlaying === 'function') value.setEditorPreviewPlaying(false);
      cce.Engine.repaintInEditMode();
      return;
    }
    const value = component(uuid);
    const token = {};
    pendingPlay.set(uuid, token);
    await value.initialize();
    if (pendingPlay.get(uuid) !== token || cce.Component.query(uuid) !== value) return;
    pendingPlay.delete(uuid);
    value.setEditorPreviewPlaying(!!playing);
    if (value.editorPreviewPlaying) { active.add(uuid); schedule(); }
    else {
      active.delete(uuid);
      if (!active.size && timer !== null) { clearTimeout(timer); timer = null; }
    }
    cce.Engine.repaintInEditMode();
  },
  async seek(uuid, time) {
    const value = component(uuid);
    await value.initialize();
    value.refreshConfiguration();
    value.seekEditorPreview(time);
    cce.Engine.repaintInEditMode();
  },
};
