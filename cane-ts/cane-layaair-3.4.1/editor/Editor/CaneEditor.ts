/** UI process only. Engine objects and resource decoding stay in the Scene process. */
export class CaneEditor {
    @IEditor.onLoad
    static start(): void {
        Editor.extensionManager.setFileType(["caneb"], "CaneSkeleton");
        Editor.extensionManager.setFileType(["caneasset"], "CaneSkeletonData");
        Editor.extensionManager.setFileIcon(["caneb", "caneasset"], "editorResources/cane.svg");
        const create: IEditor.IFileActions["onCreateNode"] = async (asset, props, parent, options) => {
                const data = await Editor.scene.runScript("CaneAssetPipeline.describe", asset.id);
                const node = await Editor.scene.createNode("Sprite", { name: data.name, ...props }, parent, options);
                if (!node) throw new Error("Laya could not create the Cane skeleton node.");
                const component = await Editor.scene.addComponent(node, data.componentType, {
                    source: `res://${data.id}`, animation: data.catalog?.animations[0]?.name ?? "", loop: true,
                });
                if (!component) throw new Error("CaneSkeleton component is unavailable. Reinstall the Cane package.");
                return node;
        };
        Editor.extensionManager.addFileActions(["CaneSkeleton", "caneb", "caneasset"], { onCreateNode: create });
        const jsonActions = { ...Editor.assetDb.getFileActionsByType("json") };
        Editor.extensionManager.addFileActions(["json"], {
            ...jsonActions,
            onCreateNode: (asset, props, parent, options) => asset.subType === "CaneSkeleton"
                ? create(asset, props, parent, options)
                : jsonActions.onCreateNode?.(asset, props, parent, options) ?? Promise.resolve(null),
        });
    }
}
