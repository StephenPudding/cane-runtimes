import { dirname, resolve, relative, posix } from 'node:path';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import transformSpread from '@babel/plugin-transform-spread';

const directory = dirname(fileURLToPath(import.meta.url));
const core = resolve(directory, '../cane-core/dist/index.js');
const workspaceCore = { name: 'cane-core', resolveId: (id) => id === '@cane-runtime/core' ? core : null };
const onwarn = (warning, warn) => {
  if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
  warn(warning);
};
// Creator 3.8.8's game compiler assumes every spread operand is an Array.
// Lower iterable spreads before that pass, preserving Set/Map/typed-array
// semantics in Core and the adapter without changing the host compiler.
const iterableSpreads = {
  name: 'cane-iterable-spreads',
  renderChunk(code) {
    const result = transformSync(code, {
      configFile: false, babelrc: false, sourceMaps: false, compact: false,
      assumptions: { iterableIsArray: false },
      plugins: [[transformSpread, { loose: false }]],
    });
    if (!result?.code) throw new Error('Failed to lower iterable spreads for Creator.');
    return { code: result.code, map: null };
  },
};

function declarations(plugin) {
  for (const [family,source] of [['cocos',resolve(directory,'dist')],['core',dirname(core)]]) {
    const visit=(folder)=>{
      for(const entry of readdirSync(folder,{withFileTypes:true})) {
        const file=resolve(folder,entry.name);
        if(entry.isDirectory()){visit(file);continue;}
        if(!entry.name.endsWith('.d.ts'))continue;
        const fileName=`types/${family}/${relative(source,file).replaceAll('\\','/')}`;
        let declaration=readFileSync(file,'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm,'');
        const corePath=posix.relative(posix.dirname(fileName),'types/core/index.js');
        declaration=declaration.replaceAll('"@cane-runtime/core"',JSON.stringify(corePath.startsWith('.')?corePath:'./'+corePath));
        plugin.emitFile({type:'asset',fileName,source:declaration});
      }
    };
    visit(source);
  }
  // Creator 3.8.8 treats .d.mts as an ordinary asset and copies it into Library.
  // Its generated db:// path mapping resolves this ambient declaration instead.
  rmSync(resolve(directory,'editor/dist/assets/cane-runtime.d.mts'),{force:true});
  plugin.emitFile({type:'asset',fileName:'cane-runtime.d.ts',source:'declare module "db://cane-runtime/cane-runtime.mjs" {\n  export * from "db://cane-runtime/types/cocos/index.js";\n}\n'});
}

export default [
  {
    input: resolve(directory, 'dist/index.js'),
    external: ['cc', 'cc/env'],
    plugins: [workspaceCore, iterableSpreads, { name: 'cane-editor-assets', generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'package.json', source: '{"type":"module"}\n' });
      this.emitFile({ type: 'asset', fileName: 'cane-color.effect', source: readFileSync(resolve(directory, 'cocos-assets/cane-runtime-color.effect')) });
      this.emitFile({type:'asset',fileName:'cane-runtime.mjs.meta',source:readFileSync(resolve(directory,'editor/runtime.mjs.meta'))});
      this.emitFile({type:'asset',fileName:'cane-color.effect.meta',source:readFileSync(resolve(directory,'editor/color.effect.meta'))});
      declarations(this);
    } }], onwarn,
    output: { file: resolve(directory, 'editor/dist/assets/cane-runtime.mjs'), format: 'es', sourcemap: false },
  },
  {
    input: resolve(directory, 'dist/assets.js'),
    external: ['cc'],
    plugins: [workspaceCore, iterableSpreads], onwarn,
    output: { file: resolve(directory, 'editor/dist/resource.cjs'), format: 'cjs', sourcemap: false },
  },
  {
    input: resolve(directory, 'editor/import-data.mjs'),
    external: ['node:path'],
    plugins: [workspaceCore, iterableSpreads], onwarn,
    output: { file: resolve(directory, 'editor/dist/import-data.cjs'), format: 'cjs', sourcemap: false },
  },
];
