using Cane.Unity.HDRP;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Cane.Unity.Editor
{
    [InitializeOnLoad]
    internal static class CaneHdrpSetup
    {
        static CaneHdrpSetup()
        {
            string key = typeof(HDRenderPipelineAsset).FullName;
            CaneSceneSetup.PipelineIssues[key] = Issue; CaneSceneSetup.PipelineSetup[key] = Configure;
        }
        private static CustomPassVolume Volume()
        {
            foreach (var volume in Object.FindObjectsByType<CustomPassVolume>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
                if (volume.isGlobal && volume.enabled && volume.injectionPoint == CustomPassInjectionPoint.BeforePostProcess)
                    foreach (var pass in volume.customPasses) if (pass is CaneCustomPass && pass.enabled) return volume;
            return null;
        }
        private static string Issue()
        {
            var asset = (HDRenderPipelineAsset)GraphicsSettings.currentRenderPipeline;
            if (!asset.currentPlatformRenderPipelineSettings.supportCustomPass) return "Enable Custom Pass in HDRP to render Cane skeletons.";
            return Volume() ? null : "Add a Cane Custom Pass Volume to this scene.";
        }
        private static void Configure()
        {
            var asset = (HDRenderPipelineAsset)GraphicsSettings.currentRenderPipeline;
            Undo.RecordObject(asset, "Enable HDRP Custom Pass");
            var settings = asset.currentPlatformRenderPipelineSettings; settings.supportCustomPass = true;
            asset.currentPlatformRenderPipelineSettings = settings; EditorUtility.SetDirty(asset);
            if (!Volume())
            {
                var go = new GameObject("Cane rendering"); Undo.RegisterCreatedObjectUndo(go, "Create Cane rendering pass");
                var volume = Undo.AddComponent<CustomPassVolume>(go); volume.isGlobal = true;
                volume.injectionPoint = CustomPassInjectionPoint.BeforePostProcess; volume.customPasses.Add(new CaneCustomPass { RenderSceneView = true });
                EditorUtility.SetDirty(volume);
            }
            AssetDatabase.SaveAssets();
        }
    }
}
