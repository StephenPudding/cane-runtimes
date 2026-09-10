# CANEB v1 size comparison

This companion explains the size comparison referenced by the frozen
[CANEB v1 specification](../formats/CANEB_V1.md). The original specification's
reference-suite benchmark is outside this Runtime source distribution. Its
fixture and development test commands are not installation requirements.

## What to compare

Compare compact Runtime JSON and canonical CANEB generated from the same model.
Exclude texture, audio and font files from both sizes: those resources remain
external in both formats. Remove JSON formatting whitespace before measuring.
Compare decoded models as well as file sizes so that omitted animation data
cannot be mistaken for compression.

The reduction is `1 - CANEB bytes / compact JSON bytes`. The result depends on
the model. The section table and string table have overhead, so a smaller binary
file is not a validity requirement for every possible animation.

## Reproduce with an exported animation

After installing [TypeScript Core](../../cane-ts/cane-core/README.md), save the
following as `compare-size.mjs` in its consuming project:

```js
import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert";
import { RuntimeDataV1 } from "@cane-runtime/core";

const [jsonPath, canebPath, ...atlasPaths] = process.argv.slice(2);
const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const document = readJson(jsonPath);
const bytes = readFileSync(canebPath);
const options = { atlases: atlasPaths.map(readJson) };
const json = RuntimeDataV1.fromJson(document, options);
const binary = RuntimeDataV1.fromCaneb(bytes, options);
deepStrictEqual(binary.document, json.document);

const compactJsonBytes = Buffer.byteLength(JSON.stringify(document), "utf8");
console.log({ compactJsonBytes, canebBytes: bytes.length,
  reduction: 1 - bytes.length / compactJsonBytes });
```

Run it with matching JSON/CANEB exports and any referenced Atlas documents:

```text
node compare-size.mjs character.json character.caneb character-atlas.json
```

Keep the input files identical when comparing implementations. A size result
does not replace animation, geometry or rendering compatibility checks.
