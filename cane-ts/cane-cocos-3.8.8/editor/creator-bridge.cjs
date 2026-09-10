'use strict';
const path = require('node:path');

// Creator 3.8.8 reads third-party asset-handler declarations but does not put
// them into the worker registry at startup. Isolate that exact SDK bridge here.
// No importer, renderer or Core behavior is implemented in this shim.
function handlerManager() {
  if (Editor.App.version !== '3.8.8') throw new Error('Unsupported Creator asset database version.');
  const { assetHandlerManager } = require(path.join(Editor.App.path,
    'builtin/asset-db/dist/worker/manager/asset-handler-manager'));
  if (typeof assetHandlerManager?.register !== 'function') throw new Error('Creator asset-handler registry is unavailable.');
  return assetHandlerManager;
}

exports.register = function (name, handlers) {
  const manager = handlerManager();
  const missing = handlers.filter((info) => !manager.name2registerInfo[info.name]);
  if (missing.length) manager.register(name, missing, false);
};

exports.unregister = function (name, handlers) {
  const manager = handlerManager();
  manager.unregister(name, handlers);
};
