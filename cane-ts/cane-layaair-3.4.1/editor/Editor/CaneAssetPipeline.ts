import { Core } from "../runtime.js";
import { CaneSkeleton } from "../CaneSkeleton";

const fs = IEditorEnv.require("fs");
const path = IEditorEnv.require("path");
const { createHash } = IEditorEnv.require("crypto");
const { Buffer } = IEditorEnv.require("buffer");

const TYPE = "CaneSkeleton";
const DATA_ID = "ca000001";
interface Dependency { key: string; reference: string; file: string; id: string | null; fingerprint?: string }

function fingerprint(file: string): string {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** JSON recognition augments the built-in importer; unrelated JSON is untouched. */
@IEditorEnv.regAssetProcessor()
export class CaneJsonProcessor implements IEditorEnv.IAssetProcessor {
    onRecognizeJson(_head: string, asset: IEditorEnv.IAssetInfo): string | null {
        try {
            return JSON.parse(fs.readFileSync(EditorEnv.assetMgr.getFullPath(asset), "utf8"))?.format === "cane-runtime" ? TYPE : null;
        } catch { return null; }
    }
    async onPostprocessAsset(importer: IEditorEnv.IAssetImporter): Promise<void> {
        if (importer instanceof CaneSkeletonImporter) return;
        if (importer.asset.ext !== "json") return;
        let document: any;
        try { document = JSON.parse(fs.readFileSync(importer.assetFullPath, "utf8")); }
        catch { return; }
        if (document?.format === "cane-runtime") {
            importer.setSubType(TYPE);
            try { await importSkeleton(importer, document, null); }
            catch (error) { rejectImport(importer, error); throw error; }
        }
    }
}

@IEditorEnv.regAssetImporter(["CaneSkeleton", "caneb"], { version: 2, runAfterRenaming: true, runAfterMoving: true })
export class CaneSkeletonImporter extends IEditorEnv.AssetImporter {
    async handleImport(): Promise<void> {
        this.setSubType(TYPE);
        try {
            const bytes = fs.readFileSync(this.assetFullPath);
            const binary = this.asset.ext === "caneb";
            await importSkeleton(this, binary ? Core.decodeCanebV1(bytes).document : JSON.parse(bytes.toString("utf8")), binary ? bytes : null);
        } catch (error) { rejectImport(this, error); throw error; }
    }
}

async function importSkeleton(importer: IEditorEnv.IAssetImporter, document: any, binary: Uint8Array | null): Promise<void> {
    const manager = EditorEnv.assetMgr;
    const previous: Dependency[] = importer.metaData.caneDependencies ?? [];
    const dependencies: Dependency[] = [];
    importer.metaData.caneDependencies = dependencies;
    const assetsRoot = path.join(EditorEnv.projectPath, "assets");
    const resolve = (key: string, reference: string, owner: string): IEditorEnv.IAssetInfo => {
        if (typeof reference !== "string" || !reference || reference.includes("\0")
            || /^[a-z][a-z0-9+.-]*:/i.test(reference) || path.isAbsolute(reference)) {
            throw new Error(`Cane '${importer.asset.file}': dependency must be a relative project path: '${reference}'.`);
        }
        const full = path.resolve(path.dirname(owner), reference);
        const relative = path.relative(assetsRoot, full).replace(/\\/g, "/");
        if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`Cane dependency is outside assets: '${reference}'.`);
        let asset = manager.getAsset(relative);
        const old = previous.find(item => item.key === key && item.reference === reference);
        if (!asset && old?.id) asset = manager.getAsset(old.id);
        const dependency: Dependency = { key, reference, file: asset?.file ?? relative, id: asset?.id ?? null };
        dependencies.push(dependency);
        if (!asset) throw new Error(`Cane '${importer.asset.file}': missing dependency '${relative}'. Restore the file and reimport.`);
        dependency.fingerprint = fingerprint(manager.getFullPath(asset));
        return asset;
    };
    const atlases: { url: string; document: any; file: string }[] = [];
    for (const reference of document.atlases ?? []) {
        const asset = resolve(`atlas:${reference.path}`, reference.path, importer.assetFullPath);
        const file = manager.getFullPath(asset);
        atlases.push({ url: `cane-resource://atlas/${atlases.length}/atlas.json`,
            document: JSON.parse(fs.readFileSync(file, "utf8")), file });
    }
    // Core is the only validator and authoritative interpreter of exported data.
    const options = { atlases: atlases.map(atlas => atlas.document) };
    const data = binary ? Core.RuntimeDataV1.fromCaneb(binary, options) : Core.RuntimeDataV1.fromJson(document, options);
    const textures: { url: string; asset: IEditorEnv.IAssetInfo }[] = [];
    for (const image of data.document.images) {
        if (image.atlasId !== null || image.path === null) continue;
        textures.push({ url: new URL(image.path, "cane-resource://source/runtime.json").href,
            asset: resolve(`image:${image.imageId}`, image.path, importer.assetFullPath) });
    }
    for (const atlas of data.atlases) {
        const source = atlases.find(item => item.document.atlasId === atlas.atlasId)!;
        for (const page of atlas.pages) {
            textures.push({ url: new URL(page.image, source.url).href,
                asset: resolve(`page:${atlas.atlasId}:${page.pageId}`, page.image, source.file) });
        }
    }
    // Raw texture subassets keep encoded pixels intact through Laya's game build.
    // Engine auto-atlas, trimming and color conversion must not alter Cane pages.
    importer.clearLibrary();
    const dataAsset = importer.createSubAsset(`${importer.asset.fileName}.caneasset`, DATA_ID);
    const imported = new Map<string, string>();
    const urls = new Set<string>();
    const bindings: { url: string; asset: string }[] = [];
    for (const texture of textures) {
        if (urls.has(texture.url)) continue;
        urls.add(texture.url);
        let id = imported.get(texture.asset.id);
        if (!id) {
            const suffix = createHash("sha256").update(texture.asset.id).digest("hex").slice(0, 16);
            const sub = importer.createSubAsset(`texture-${suffix}.canetex`, `tex-${suffix}`);
            fs.copyFileSync(manager.getFullPath(texture.asset), sub.fullPath);
            id = sub.id;
            imported.set(texture.asset.id, id);
        }
        bindings.push({ url: texture.url, asset: `res://${id}` });
    }
    const manifest = { format: "cane-laya-skeleton", version: 1,
        document: binary ? null : document, caneb: binary ? Buffer.from(binary).toString("base64") : null,
        atlases: atlases.map(({ url, document }) => ({ url, document })), textures: bindings };
    fs.writeFileSync(dataAsset.fullPath, JSON.stringify(manifest));
    importer.metaData.caneAssetId = dataAsset.id;
    importer.metaData.caneCatalog = data.catalog;
    delete importer.metaData.caneImportError;
}

function rejectImport(importer: IEditorEnv.IAssetImporter, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    importer.clearLibrary();
    const dataAsset = importer.createSubAsset(`${importer.asset.fileName}.caneasset`, DATA_ID);
    fs.writeFileSync(dataAsset.fullPath, JSON.stringify({ format: "cane-laya-import-error", message }));
    importer.metaData.caneAssetId = dataAsset.id;
    importer.metaData.caneImportError = message;
    delete importer.metaData.caneCatalog;
    CaneSkeleton.reimport(`res://${dataAsset.id}`);
}

@IEditorEnv.regAssetExporter(["caneasset"])
export class CaneSkeletonExporter extends IEditorEnv.AssetExporter {
    async handleExport(): Promise<void> {
        const data = JSON.parse(fs.readFileSync(EditorEnv.assetMgr.getFullPath(this.asset), "utf8"));
        if (data.format !== "cane-laya-skeleton") throw new Error(data.message ?? "Cane skeleton did not import successfully.");
        this.exportInfo.deps = this.parseLinks(data.textures.map((texture: any) => ({
            obj: texture, prop: "asset", url: texture.asset, absolutePath: true,
        })));
        if (this.exportInfo.brokenLinks?.length) throw new Error(`Cane '${this.asset.file}' has missing texture dependencies.`);
        this.exportInfo.contents = [{ type: "json", data }];
    }
}

/** Laya logs per-asset importer failures without necessarily failing the game build. */
@IEditorEnv.regBuildPlugin("web")
export class CaneBuildValidation implements IEditorEnv.IBuildPlugin {
    async onStart(): Promise<void> {
        CaneAssetPipeline.revalidateDependencies();
        await EditorEnv.assetMgr.flushChanges();
        for (const asset of EditorEnv.assetMgr.getUserAssets()) {
            if (!(asset.ext === "caneb" || asset.subType === TYPE)) continue;
            const error = EditorEnv.assetMgr.readMeta(asset)?.caneImportError;
            if (error) throw new Error(`Cannot build Cane animation: ${error}`);
        }
    }
}

@IEditorEnv.regClass()
export class CaneAssetPipeline {
    @IEditorEnv.onLoad
    static start(): void {
        EditorEnv.assetMgr.onAssetChanged.add(this.changed, this);
        this.revalidateDependencies();
    }
    @IEditorEnv.onUnload
    static stop(): void {
        EditorEnv.assetMgr.onAssetChanged.remove(this.changed, this);
    }

    private static changed(asset: IEditorEnv.IAssetInfo): void {
        if (asset.ext === "caneasset") { CaneSkeleton.reimport(`res://${asset.id}`); return; }
        if (asset.ext === "canetex") return;
        for (const candidate of EditorEnv.assetMgr.getUserAssets()) {
            if (candidate.id === asset.id || !(candidate.ext === "caneb" || candidate.subType === TYPE)) continue;
            // During the first asset scan another source may not have metadata yet.
            const metadata = EditorEnv.assetMgr.readMeta(candidate) ?? {};
            const deps = metadata.caneDependencies as Dependency[] | undefined;
            if (deps?.some(dep => dep.id === asset.id || dep.file === asset.file)) {
                EditorEnv.assetMgr.importAsset(candidate);
            }
        }
    }

    /** Startup deletions can precede plugin registration; do not trust stale raw copies. */
    static revalidateDependencies(): void {
        const manager = EditorEnv.assetMgr;
        const hashes = new Map<string, string>();
        for (const candidate of manager.getUserAssets()) {
            if (!(candidate.ext === "caneb" || candidate.subType === TYPE)) continue;
            const metadata = manager.readMeta(candidate) ?? {};
            const dependencies = metadata.caneDependencies as Dependency[] | undefined;
            const stale = metadata.caneImportError || dependencies?.some(dependency => {
                const asset = dependency.id ? manager.getAsset(dependency.id) : manager.getAsset(dependency.file);
                if (!asset || asset.file !== dependency.file) return true;
                let hash = hashes.get(asset.id);
                if (hash === undefined) {
                    const file = manager.getFullPath(asset);
                    if (!fs.existsSync(file)) return true;
                    hash = fingerprint(file);
                    hashes.set(asset.id, hash);
                }
                return hash !== dependency.fingerprint;
            });
            if (stale) manager.importAsset(candidate);
        }
    }

    static describe(id: string): { id: string; name: string; catalog: any; componentType: string } {
        const componentType = EditorEnv.typeRegistry.getTypeOfClass(CaneSkeleton)?.name;
        if (!componentType) throw new Error("CaneSkeleton is not registered with the IDE.");
        const source = EditorEnv.assetMgr.getAsset(id);
        if (!source) throw new Error(`Cane source '${id}' is missing.`);
        if (source.ext === "caneasset") return { id, name: source.name, catalog: null, componentType };
        const metadata = EditorEnv.assetMgr.readMeta(source) ?? {};
        if (metadata.caneImportError) throw new Error(metadata.caneImportError);
        if (!metadata.caneAssetId) throw new Error(`Cane '${source.file}' did not import successfully. Check the console.`);
        return { id: metadata.caneAssetId, name: source.name, catalog: metadata.caneCatalog, componentType };
    }
}
