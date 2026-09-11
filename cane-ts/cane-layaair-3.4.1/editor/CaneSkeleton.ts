import {
    CaneLayaRuntime, acquireCaneLayaSkeletonAssetV1, invalidateCaneLayaSkeletonAssetV1,
    detectCaneLayaBackendV1,
    type CaneLayaSkeletonAssetLeaseV1,
} from "./runtime.js";

/** Serializable engine component. Core owns all animation and final geometry. */
@Laya.regClass()
@Laya.runInEditor
@Laya.classInfo({ menu: "Cane/Cane Skeleton" })
export class CaneSkeleton extends Laya.Script {
    /** Set by the editor plugin for the official rendererless CLI import process. */
    static editorHeadless = false;
    static editorChanged: ((component: CaneSkeleton) => void) | null = null;
    private static readonly instances = new Set<CaneSkeleton>();
    private _source = "";
    private _animation = "";
    private _skin = "";
    private _loop = true;
    private _speed = 1;
    private _playOnAwake = true;
    private _preview = false;
    private _generation = 0;
    private _lease: CaneLayaSkeletonAssetLeaseV1 | null = null;
    private _runtime: CaneLayaRuntime | null = null;
    private _alive = false;
    private _ready: Promise<void> = Promise.resolve();
    private _error = "";

    @Laya.property({ type: "string", isAsset: true, assetTypeFilter: "CaneSkeletonData", caption: "Cane 数据 / Data" })
    get source(): string { return this._source; }
    set source(value: string) {
        if (value === this._source) return;
        this._source = value || "";
        if (this._alive) this.reload();
    }

    @Laya.property({ type: ["string"], hidden: true, serializable: false, affectBy: "source" })
    get animationNames(): string[] { return ["", ...(this._lease?.asset.data.catalog.animations.map(a => a.name) ?? [])]; }
    @Laya.property({ type: ["string"], hidden: true, serializable: false, affectBy: "source" })
    get skinNames(): string[] { return ["", ...(this._lease?.asset.data.catalog.skins.map(a => a.name) ?? [])]; }

    @Laya.property({ type: "string", enumSource: "animationNames", caption: "动画 / Animation" })
    get animation(): string { return this._animation; }
    set animation(value: string) { this._animation = value || ""; this.configure(); }
    @Laya.property({ type: "string", enumSource: "skinNames", caption: "皮肤 / Skin" })
    get skin(): string { return this._skin; }
    set skin(value: string) { this._skin = value || ""; this.configure(); }
    @Laya.property({ type: "boolean", caption: "循环 / Loop" })
    get loop(): boolean { return this._loop; }
    set loop(value: boolean) { this._loop = value; this.configure(); }
    @Laya.property({ type: "number", min: 0, caption: "速度 / Speed" })
    get speed(): number { return this._speed; }
    set speed(value: number) {
        if (!Number.isFinite(value) || value < 0) throw new Error("Cane speed must be finite and non-negative.");
        this._speed = value;
        if (this._runtime) this._runtime.timeScale = value;
    }
    @Laya.property({ type: "boolean", caption: "自动播放 / Play on awake" })
    get playOnAwake(): boolean { return this._playOnAwake; }
    set playOnAwake(value: boolean) { this._playOnAwake = value; this.updatePlayback(); }
    @Laya.property({ type: "boolean", caption: "编辑器预览 / Preview", stripInBuild: true })
    get preview(): boolean { return this._preview; }
    set preview(value: boolean) { this._preview = value; this.updatePlayback(); }
    @Laya.property({ type: "string", readonly: true, serializable: false, caption: "状态 / Status" })
    get status(): string { return this._error || (this._runtime ? "Ready" : this._source ? "Loading" : "Select Cane data"); }

    get runtime(): CaneLayaRuntime | null { return this._runtime; }
    get ready(): Promise<void> { return this._ready; }

    onAwake(): void { this._alive = true; CaneSkeleton.instances.add(this); this.reload(); }
    onEnable(): void { this.updatePlayback(); }
    onDisable(): void { this.updatePlayback(); }
    onDestroy(): void {
        this._alive = false;
        this._generation += 1;
        CaneSkeleton.instances.delete(this);
        this.releaseCurrent();
    }
    onUpdate(): void {
        if (Laya.LayaEnv.isPlaying && this._runtime && this.owner.activeInHierarchy && this.enabled && this._playOnAwake) {
            this._runtime.update(Laya.timer.delta / 1000);
        }
    }

    /** The IDE owns Scene-view ticks; its engine Script driver is not running. */
    static updateEditor(deltaSeconds: number, root: Laya.Node): boolean {
        if (Laya.LayaEnv.isPlaying || this.editorHeadless || !root) return false;
        let updated = false;
        for (const component of this.instances) {
            if (component._runtime && component._preview && component.enabled && component.owner.activeInHierarchy
                && root.isAncestorOf(component.owner)) {
                component._runtime.update(deltaSeconds);
                updated = true;
            }
        }
        return updated;
    }

    /** Safe for source changes while an earlier load is still pending. */
    reload(): void {
        const generation = ++this._generation;
        this._error = "";
        this.releaseCurrent();
        this._ready = Promise.resolve();
        if (!this.isLive() || !this._source) return;
        // The official CLI imports/serializes scenes using a renderer without a GPU.
        if (CaneSkeleton.editorHeadless || detectCaneLayaBackendV1() === "no-render") return;
        this._ready = this.load(generation).catch(error => {
            if (generation !== this._generation || !this.isLive()) return;
            this._error = error instanceof Error ? error.message : String(error);
            CaneSkeleton.editorChanged?.(this);
            console.error(`CaneSkeleton '${this.owner.name}': ${this._error}`);
            this.owner.event("cane-error", error);
        });
    }

    static reimport(source: string): void {
        invalidateCaneLayaSkeletonAssetV1(source);
        for (const instance of this.instances) {
            if (instance.source === source) instance.reload();
        }
    }

    private async load(generation: number): Promise<void> {
        const lease = await acquireCaneLayaSkeletonAssetV1(this._source);
        if (generation !== this._generation || !this.isLive()) { await lease.release(); return; }
        try {
            const runtime = new CaneLayaRuntime({ asset: lease.asset,
                playerOptions: { executionMode: "performance" }, autoUpdate: false, validationMode: "once" });
            this._lease = lease;
            this._runtime = runtime;
            runtime.hideFlags = Laya.HideFlags.HideAndDontSave;
            (this.owner as Laya.Sprite).addChild(runtime);
            this.configure();
            CaneSkeleton.editorChanged?.(this);
            this.owner.event("cane-ready", this);
        } catch (error) {
            this.releaseCurrent();
            if (this._lease !== lease) await lease.release();
            throw error;
        }
    }

    private configure(): void {
        const runtime = this._runtime;
        if (!runtime) return;
        try {
            const defaultSkin = this._lease?.asset.data.catalog.skins.find(skin => skin.id === "default");
            runtime.setSkin(this._skin || defaultSkin?.id || null);
            if (this._animation) runtime.setAnimation(0, this._animation, this._loop);
            else runtime.clearTracks();
            runtime.timeScale = this._speed;
            this._error = "";
            this.updatePlayback();
            CaneSkeleton.editorChanged?.(this);
        } catch (error) {
            runtime.pause();
            this._error = error instanceof Error ? error.message : String(error);
            CaneSkeleton.editorChanged?.(this);
            throw error;
        }
    }
    private isLive(): boolean {
        // Laya can defer Script.onDestroy until after its owner is already gone.
        return this._alive && !this.destroyed && !!this.owner && !this.owner.destroyed;
    }
    private updatePlayback(): void {
        if (this._runtime) this._runtime.paused = !this.enabled || !this.owner.activeInHierarchy
            || !(Laya.LayaEnv.isPlaying ? this._playOnAwake : this._preview);
    }
    private releaseCurrent(): void {
        this._runtime?.destroy(true);
        this._runtime = null;
        const lease = this._lease;
        this._lease = null;
        if (lease) void lease.release().catch(error => console.error("Cane resource release failed", error));
    }
}
