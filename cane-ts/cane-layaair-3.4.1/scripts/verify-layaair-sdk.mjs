import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_VERSION = "3.4.1";
const EXPECTED_COMMIT = "f368b43098fe6bde7b961546114e71907c5f8a98";
const EXPECTED_DECLARATIONS_HASH = "D68BD1720CAF1270DF5104B1F6C07A1958A9F806E2F1D4FE354D945810BC4510";
const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryDirectory = resolve(packageDirectory, "../..");
const sdkDirectory = resolve(
  process.env.CANE_LAYAAIR_341_ROOT ?? resolve(repositoryDirectory, ".tmp/LayaAir-v3.4.1"),
);
const releaseDirectory = resolve(
  process.env.CANE_LAYAAIR_341_RELEASE_ROOT
    ?? resolve(repositoryDirectory, ".tmp/LayaAir_3.4.1_release_libs"),
);

const manifestPath = resolve(sdkDirectory, "package.json");
const environmentPath = resolve(sdkDirectory, "src/layaAir/LayaEnv.ts");
const declarationsPath = resolve(releaseDirectory, "types/LayaAir.d.ts");
const releaseFiles = new Map([
  ["laya.core.js", "C7E8551852EAF7030DCCC2C1E208DBD9D24F976299D350F6D62FB7041E7EC9DB"],
  ["laya.webgl_2D.js", "729B8CEBE148EC7B7E850C2B3E1331FF386F3FB2825557D58AD63B9B3804CF73"],
  ["laya.webgpu_2D.js", "05F87E8E4AAE1C711BE89D529730D0F3AB5B4F5599B8E43AA7905819E9C3BC10"],
  ["shader_compiler_web.js", "EFD2ADAB7182FB07ED92A48F37A6073E2F1DFFAB0B406A4C630727A18BD5D244"],
  ["shader_compiler_web.wasm", "9CC4672B2293949BC26659418E5892E726F82D540BF6909D69B38DC72F8B3641"],
  ["nagabind.js", "06C7194DE1B68411E4E685A5C0C0AC9E1E526428EB0FB5B6512C887D2042704D"],
  ["nagabind_bg.wasm", "709A6A8C5AF6D1F2DF7ECD058ACF34282702BEFD5D7B7BB106CAE75903D9CC08"],
]);

let manifest;
let environmentSource;
let declarations;
try {
  [manifest, environmentSource, declarations] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(environmentPath, "utf8"),
    readFile(declarationsPath),
  ]);
} catch (error) {
  throw new Error(
    `LayaAir ${EXPECTED_VERSION} SDK evidence is missing. Expected the official source checkout at `
      + `'${sdkDirectory}' and extracted release libraries at '${releaseDirectory}'.`,
    { cause: error },
  );
}

if (manifest.name !== "layaair" || manifest.version !== EXPECTED_VERSION) {
  throw new Error(`Expected official layaair@${EXPECTED_VERSION}, received ${manifest.name}@${manifest.version}.`);
}
if (!environmentSource.includes(`static version: string = "${EXPECTED_VERSION}"`)) {
  throw new Error(`LayaEnv.version does not identify LayaAir ${EXPECTED_VERSION}.`);
}
const declarationsHash = createHash("sha256").update(declarations).digest("hex").toUpperCase();
if (declarationsHash !== EXPECTED_DECLARATIONS_HASH
  || !declarations.includes(Buffer.from("class WebGPURenderEngine"))) {
  throw new Error(`Official LayaAir ${EXPECTED_VERSION} WebGPU declarations failed verification.`);
}
let actualCommit;
try {
  actualCommit = execFileSync("git", ["-C", sdkDirectory, "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
} catch (error) {
  throw new Error(`LayaAir SDK evidence at '${sdkDirectory}' is not a verifiable Git checkout.`, { cause: error });
}
if (actualCommit !== EXPECTED_COMMIT) {
  throw new Error(`Expected official LayaAir ${EXPECTED_VERSION} commit ${EXPECTED_COMMIT}, received ${actualCommit}.`);
}

for (const [filename, expectedHash] of releaseFiles) {
  const path = resolve(releaseDirectory, "libs", filename);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new Error(`Official LayaAir ${EXPECTED_VERSION} release file '${path}' is missing.`, { cause: error });
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (actualHash !== expectedHash) {
    throw new Error(`Official LayaAir ${EXPECTED_VERSION} release file '${filename}' failed SHA-256 verification.`);
  }
}

const generatedDirectory = resolve(packageDirectory, ".generated");
await mkdir(generatedDirectory, { recursive: true });
await copyFile(declarationsPath, resolve(generatedDirectory, "LayaAir.d.ts"));
await writeFile(
  resolve(generatedDirectory, "sdk.json"),
  `${JSON.stringify({
    version: EXPECTED_VERSION,
    commit: actualCommit,
    sdkDirectory,
    releaseDirectory,
    renderers: ["webgl", "webgpu"],
  }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(
  `verified official LayaAir ${EXPECTED_VERSION} source and WebGL/WebGPU release SDK on E:\n`,
);
