'use strict';
exports.load = function () {
  if (Editor.App.version !== '3.8.8') throw new Error('This Cane extension requires Cocos Creator 3.8.8.');
};
exports.unload = function () {};
