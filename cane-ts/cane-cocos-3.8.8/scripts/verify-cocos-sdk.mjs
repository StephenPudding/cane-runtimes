import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_VERSION = "3.8.8";
const EXPECTED_COMMIT = "411f98df047c25902f93440d4b22925c2fb65461";
const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryDirectory = resolve(packageDirectory, "../..");
const sourceDirectory = resolve(
  process.env.CANE_COCOS_388_ENGINE_ROOT
    ?? resolve(repositoryDirectory, ".tmp/cocos-engine-v3.8.8"),
);
const typesDirectory = resolve(packageDirectory, "node_modules/@cocos/creator-types");

let actualCommit;
try {
  actualCommit = execFileSync("git", ["-C", sourceDirectory, "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
} catch (error) {
  throw new Error(
    `Cocos Engine ${EXPECTED_VERSION} source evidence is missing at '${sourceDirectory}'.`,
    { cause: error },
  );
}
if (actualCommit !== EXPECTED_COMMIT) {
  throw new Error(`Expected Cocos ${EXPECTED_VERSION} commit ${EXPECTED_COMMIT}, received ${actualCommit}.`);
}

const [manifestSource, declarations] = await Promise.all([
  readFile(resolve(typesDirectory, "package.json"), "utf8"),
  readFile(resolve(typesDirectory, "engine/cc.d.ts")),
]);
const manifest = JSON.parse(manifestSource);
if (manifest.name !== "@cocos/creator-types" || manifest.version !== EXPECTED_VERSION) {
  throw new Error(
    `Expected @cocos/creator-types@${EXPECTED_VERSION}, received ${manifest.name}@${manifest.version}.`,
  );
}
if (!declarations.includes(Buffer.from(`export const VERSION = \"${EXPECTED_VERSION}\"`))) {
  throw new Error(`Cocos declarations do not identify VERSION ${EXPECTED_VERSION}.`);
}

process.stdout.write(`${JSON.stringify({
  version: EXPECTED_VERSION,
  commit: actualCommit,
  declarationsSha256: createHash("sha256").update(declarations).digest("hex"),
})}\n`);
