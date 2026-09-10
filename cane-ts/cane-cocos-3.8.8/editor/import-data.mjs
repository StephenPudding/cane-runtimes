import path from 'node:path';
import { RuntimeDataV1, decodeCanebV1 } from '@cane-runtime/core';
import { runtimeTextureDescriptorsV1 } from '../dist/texture-descriptors.js';

/** Only resource resolution belongs here. Core performs every format validation. */
export async function readCaneImportV1(source, readDependency) {
  const bytes = await readDependency(source);
  const binary = /\.caneb$/i.test(source);
  const document = binary ? decodeCanebV1(bytes).document : JSON.parse(bytes.toString('utf8'));
  const atlases = [];
  const atlasDirectories = new Map();
  if (Array.isArray(document?.atlases)) {
    for (const reference of document.atlases) {
      if (typeof reference?.path !== 'string') continue; // Core reports the invalid reference.
      const file = resolveCaneDependencyV1(source, reference.path);
      const atlas = JSON.parse((await readDependency(file)).toString('utf8'));
      atlases.push(atlas);
      atlasDirectories.set(atlas.atlasId, path.dirname(file));
    }
  }
  const data = binary
    ? RuntimeDataV1.fromCaneb(bytes, { atlases })
    : RuntimeDataV1.fromJson(document, { atlases });
  const textures = [];
  for (const [key, descriptor] of runtimeTextureDescriptorsV1(data)) {
    const directory = descriptor.kind === 'atlas'
      ? atlasDirectories.get(descriptor.atlasId) : path.dirname(source);
    const texturePath = descriptor.kind === 'atlas' ? descriptor.pagePath : descriptor.path;
    if (directory === undefined) throw new Error(`Cane Atlas '${descriptor.atlasId}' has no source file.`);
    const file = resolveCaneDependencyV1(path.join(directory, 'source'), texturePath);
    textures.push({ key, file });
  }
  return { binary, document, atlases, textures, catalog: data.catalog };
}

export function resolveCaneDependencyV1(source, reference) {
  if (typeof reference !== 'string' || !reference || reference.includes('\0')
      || /^[a-z][a-z0-9+.-]*:/i.test(reference) || path.isAbsolute(reference)) {
    throw new Error(`Cane imported resources require a relative file path: '${reference}'.`);
  }
  return path.resolve(path.dirname(source), reference);
}

export function isCaneJsonV1(bytes) {
  try { return JSON.parse(bytes.toString('utf8'))?.format === 'cane-runtime'; }
  catch { return false; }
}
