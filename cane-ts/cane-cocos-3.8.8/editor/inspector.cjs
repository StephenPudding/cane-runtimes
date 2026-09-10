'use strict';
exports.template = `
<div class="fields"></div>
<ui-prop type="dump" class="animation-store" hidden></ui-prop>
<ui-prop><ui-label slot="label" value="动画"></ui-label><select slot="content" class="animation"></select></ui-prop>
<ui-prop type="dump" class="skins-store" hidden></ui-prop>
<ui-prop><ui-label slot="label" value="皮肤（按顺序叠加）"></ui-label><div slot="content" class="skins"></div></ui-prop>
<div class="preview"><ui-button class="play">播放预览</ui-button><ui-button class="stop">回到起点</ui-button>
  <input class="time" type="number" min="0" step="0.01" aria-label="预览时间（秒）"><span>秒</span></div>
<div class="status" role="status"></div>
<details><summary>高级设置</summary><div class="advanced"></div></details>`;
exports.style = `
  :host{display:block;min-width:0} select,input{background:var(--color-normal-fill,#252525);color:inherit;border:1px solid var(--color-normal-border,#555);border-radius:3px;height:24px;box-sizing:border-box;min-width:0}
  select{width:100%}.skin-row{display:flex;gap:4px;margin-bottom:4px}.skin-row select{flex:1}.skin-row ui-button{flex:none}
  .preview{display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin:10px 0}.time{width:78px}.status{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--color-normal-contrast,#aaa);margin:6px 0}
  summary{cursor:pointer;margin:8px 0}.fields ui-prop,.advanced ui-prop{display:block}`;
exports.$ = {fields:'.fields',advanced:'.advanced',animation:'.animation',animationStore:'.animation-store',skins:'.skins',skinsStore:'.skins-store',
  play:'.play',stop:'.stop',time:'.time',status:'.status'};
const request = (method, ...args) => Editor.Message.request('scene', 'execute-scene-script', {name:'cane-runtime',method,args});
const basic = ['skeletonData','loop','timeScale'];

function submit(panel, property, value) {
  if (panel.multiple || panel.closed) return;
  const dump = panel.dump.value[property];
  dump.value = value;
  const target = property === 'defaultAnimation' ? panel.$.animationStore : panel.$.skinsStore;
  target.dump = dump;
  target.dispatch('change-dump');
  target.dispatch('confirm-dump');
}
function options(select, entries, current, emptyText) {
  select.replaceChildren();
  if (emptyText !== undefined) {
    const option = document.createElement('option'); option.value = ''; option.textContent = emptyText; select.append(option);
  }
  for (const entry of entries) {
    const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.name || entry.id; select.append(option);
  }
  if (current && !entries.some((entry) => entry.id === current)) {
    const option = document.createElement('option'); option.value = current; option.textContent = `${current}（不可用）`; select.append(option);
  }
  select.value = current || '';
}
function skins(panel, catalog) {
  const dump = panel.dump.value.initialSkins;
  const items = dump.value || [];
  panel.$.skins.replaceChildren();
  const commit = (values) => submit(panel, 'initialSkins', values);
  items.forEach((item, index) => {
    const row = document.createElement('div'); row.className = 'skin-row';
    const select = document.createElement('select');
    options(select, catalog.filter((entry) => entry.id === item.value || !items.some((other) => other.value === entry.id)), item.value);
    select.addEventListener('change', () => commit(items.map((value, i) => i === index ? {...value,value:select.value} : value)));
    row.append(select);
    for (const [label, offset] of [['↑',-1],['↓',1],['移除',0]]) {
      const button = document.createElement('ui-button'); button.textContent = label;
      if (offset && (index+offset < 0 || index+offset >= items.length)) button.setAttribute('disabled','');
      button.addEventListener('confirm', () => {
        const values = [...items];
        if (!offset) values.splice(index,1);
        else if (index+offset >= 0 && index+offset < values.length) [values[index],values[index+offset]]=[values[index+offset],values[index]];
        commit(values);
      });
      row.append(button);
    }
    panel.$.skins.append(row);
  });
  const available = catalog.filter((entry) => !items.some((item) => item.value === entry.id));
  if (available.length) {
    const select = document.createElement('select'); options(select,available,'','添加皮肤…');
    select.addEventListener('change', () => {
      if (select.value) commit([...items,{...(dump.elementTypeData || {type:'String'}),value:select.value}]);
    });
    panel.$.skins.append(select);
  }
}
async function refresh(panel) {
  if (panel.multiple || panel.closed || !panel.uuid) return;
  const token = ++panel.requestVersion;
  try {
    const state = await request('state', panel.uuid);
    if (panel.closed || token !== panel.requestVersion) return;
    const presentation = JSON.stringify([state.catalog,panel.dump.value.defaultAnimation.value,panel.dump.value.initialSkins.value]);
    if (presentation !== panel.presentation) {
      options(panel.$.animation,state.catalog.animations,panel.dump.value.defaultAnimation.value,'设置姿势');
      skins(panel,state.catalog.skins);
      panel.presentation = presentation;
    }
    panel.playing = state.playing;
    panel.$.play.textContent = state.playing ? '暂停预览' : '播放预览';
    if (panel.$.time.getRootNode().activeElement !== panel.$.time) panel.$.time.value = state.time.toFixed(3);
    panel.$.status.textContent = state.error;
    if (state.playing && panel.poll === null) panel.poll = setTimeout(() => {panel.poll=null;void refresh(panel);},100);
  } catch (error) {
    if (!panel.closed && token === panel.requestVersion) panel.$.status.textContent = String(error.message || error);
  }
}
exports.ready = function () {
  this.requestVersion = 0; this.poll = null; this.closed = false;
  const action = async (steps) => {
    if (this.closed || this.multiple || !this.uuid) return;
    const uuid = this.uuid;
    try {
      for (const [method,value] of steps) {
        if(this.closed || this.uuid!==uuid)return;
        await request(method,uuid,value);
      }
      await refresh(this);
    } catch(error) { if(!this.closed && this.uuid===uuid)this.$.status.textContent=String(error.message||error); }
  };
  this.$.animation.addEventListener('change',()=>submit(this,'defaultAnimation',this.$.animation.value));
  this.$.play.addEventListener('confirm',()=>void action([['play',!this.playing]]));
  this.$.stop.addEventListener('confirm',()=>void action([['play',false],['seek',0]]));
  this.$.time.addEventListener('change',()=>void action([['seek',Number(this.$.time.value)]]));
};
exports.update = function (dump) {
  const next = dump.value.uuid.value;
  const multiple = (dump.value.uuid.values?.length || 1)>1;
  if (this.uuid && (this.uuid !== next || multiple)) void request('play',this.uuid,false).catch(()=>{});
  if (this.poll !== null) clearTimeout(this.poll);
  this.poll = null; this.requestVersion++; this.presentation = null; this.multiple = multiple;
  this.uuid = next; this.dump = dump;
  const previous = this.properties || new Map();
  this.properties = new Map();
  for (const [key,value] of Object.entries(dump.value)) {
    if (!value || value.visible === false || ['uuid','name','enabled','defaultAnimation','initialSkins'].includes(key)) continue;
    const property = previous.get(key) || document.createElement('ui-prop'); property.setAttribute('type','dump');
    this.properties.set(key,property);
    (basic.includes(key) ? this.$.fields : this.$.advanced).append(property);
    property.render(value);
  }
  for (const [key,property] of previous) if(!this.properties.has(key))property.remove();
  this.$.animationStore.dump = dump.value.defaultAnimation;
  this.$.skinsStore.dump = dump.value.initialSkins;
  this.$.animation.disabled = multiple;
  for (const button of [this.$.play,this.$.stop])button.toggleAttribute('disabled',multiple);
  this.$.time.disabled = multiple;
  if(multiple){this.$.skins.replaceChildren();this.$.status.textContent='请选择单个 Cane 组件来配置动画、皮肤或预览。';return;}
  void refresh(this);
};
exports.close = function () {
  this.closed = true; this.requestVersion++;
  if (this.poll !== null) clearTimeout(this.poll);
  this.poll = null;
  if (this.uuid) void request('play',this.uuid,false).catch(()=>{});
};
