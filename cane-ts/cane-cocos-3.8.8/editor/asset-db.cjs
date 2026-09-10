'use strict';
const path = require('node:path');
const fs = require('node:fs');
module.paths.push(path.join(Editor.App.path, 'node_modules'));
const manifest = require('./package.json');
const bridge = require('./creator-bridge.cjs');
const { readCaneImportV1, isCaneJsonV1 } = require('./dist/import-data.cjs');
const TYPE = 'cane.CaneSkeletonDataAsset';
const handlers = manifest.contributions['asset-db']['asset-handler'];

exports.methods = {
  beforePreStart() { bridge.register(manifest.name, handlers); },
  registerCaneHandler() {
    // Asset DB runs in a separate process; register the same runtime resource
    // class there so Creator can query its type and serialize dependencies.
    require('./dist/resource.cjs');
    return {
      name: 'cane-skeleton', assetType: TYPE,
      async validate(asset) {
        return /\.caneb$/i.test(asset.source) || isCaneJsonV1(await fs.promises.readFile(asset.source));
      },
      importer: { version: '1.0.1', import: importCane },
    };
  },
};
exports.load = function () {};
exports.unload = function () { bridge.unregister(manifest.name, handlers); };

async function importCane(asset) {
  const { queryAsset } = require('@editor/asset-db');
  const readDependency = async (file) => {
    // Record missing paths too: restoring them must trigger a fresh import.
    if (file !== asset.source) await asset.depend(file);
    return fs.promises.readFile(file);
  };
  const plan = await readCaneImportV1(asset.source, readDependency);
  const references = [];
  const textureKeys = [];
  const depends = new Set();
  for (const { key, file } of plan.textures) {
    await asset.depend(file);
    const image = queryAsset(file);
    if (!image || !fs.existsSync(file)) throw new Error(`Cane texture is missing: ${file}`);
    // This stable Texture2D subasset ID is part of the pinned 3.8.8 image importer.
    const uuid = `${image.uuid}@6c48a`;
    await asset.depend(uuid);
    references.push({ __uuid__: uuid, __expectedType__: 'cc.Texture2D' });
    textureKeys.push(key);
    depends.add(uuid);
  }
  const effectFile = path.join(__dirname, 'dist/assets/cane-color.effect');
  await asset.depend(effectFile);
  const effect = queryAsset(effectFile);
  if (!effect) throw new Error('Cane Effect was not imported. Reinstall the Cane Runtime extension.');
  depends.add(effect.uuid);
  const root = {
    __type__: TYPE, _name: asset.basename, _objFlags: 0, _native: plan.binary ? '.bin' : '',
    colorEffectAsset: { __uuid__: effect.uuid, __expectedType__: 'cc.EffectAsset' },
    _runtimeDocument: plan.binary ? null : plan.document,
    _atlasDocuments: plan.atlases,
    runtimeJson: null, runtimeBinary: null, atlasAssets: [], textureKeys, textures: references,
  };
  if (plan.binary) await asset.copyToLibrary('.bin', asset.source);
  await asset.saveToLibrary('.json', JSON.stringify([root]));
  asset.setData('depends', [...depends]);
  asset.userData.cane = {
    animations: plan.catalog.animations.map(({ id, name, durationSeconds }) => ({ id, name, durationSeconds })),
    skins: plan.catalog.skins.map(({ id, name }) => ({ id, name })),
  };
  return true;
}
