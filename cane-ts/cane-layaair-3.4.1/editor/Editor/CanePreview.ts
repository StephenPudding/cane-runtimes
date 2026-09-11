import { CaneSkeleton } from "../CaneSkeleton";

/** Scene-view scheduling and Inspector refresh, separate from asset processing. */
export class CanePreview {
    private static previousTime = 0;

    @IEditorEnv.onLoad
    static start(): void {
        // The desktop IDE also uses cliMode for --script while keeping its GPU.
        CaneSkeleton.editorHeadless = Boolean(EditorEnv.cliMode) && typeof createImageBitmap !== "function";
        CaneSkeleton.editorChanged = component => {
            const scene = (component.owner as unknown as IEditorEnv.IMyNode)._extra?.scene;
            scene?.setObjectChanged(component, "animationNames", "skinNames", "status");
        };
        this.previousTime = performance.now();
        EditorEnv.onUpdate.add(this.update, this);
    }

    @IEditorEnv.onUnload
    static stop(): void {
        EditorEnv.onUpdate.remove(this.update, this);
        CaneSkeleton.editorChanged = null;
    }

    private static update(): void {
        const now = performance.now();
        const delta = Math.max(0, (now - this.previousTime) / 1000);
        this.previousTime = now;
        const scene = EditorEnv.scene;
        if (scene && CaneSkeleton.updateEditor(delta, scene.rootNode2D as unknown as Laya.Node)) {
            EditorEnv.d3Manager.requestTempRealtimeRefresh();
        }
    }
}
