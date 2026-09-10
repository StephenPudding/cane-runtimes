using System.Collections.Generic;
using Cane.Unity.URP;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Cane.Unity.Editor
{
    [InitializeOnLoad]
    internal static class CaneUrpSetup
    {
        static CaneUrpSetup()
        {
            string key = typeof(UniversalRenderPipelineAsset).FullName;
            CaneSceneSetup.PipelineIssues[key] = Issue; CaneSceneSetup.PipelineSetup[key] = Configure;
        }
        private static IEnumerable<ScriptableRendererData> Renderers()
        {
            var asset = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            if (!asset) yield break;
            var serialized = new SerializedObject(asset);
            var list = serialized.FindProperty("m_RendererDataList");
            if (list == null) throw new System.InvalidOperationException("The URP renderer catalog is unavailable in this Unity version.");
            for (int i = 0; i < list.arraySize; ++i)
                if (list.GetArrayElementAtIndex(i).objectReferenceValue is ScriptableRendererData renderer) yield return renderer;
        }
        private static string Issue()
        {
            bool found = false;
            foreach (var renderer in Renderers())
            {
                found = true; bool ready = false;
                foreach (var feature in renderer.rendererFeatures) if (feature is CaneRendererFeature && feature.isActive) ready = true;
                if (!ready) return "Add the Cane renderer feature to the URP renderers used by this project.";
            }
            return found ? null : "Assign a renderer asset to the active URP pipeline.";
        }
        private static void Configure()
        {
            foreach (var renderer in Renderers())
            {
                CaneRendererFeature existing = null;
                foreach (var feature in renderer.rendererFeatures) if (feature is CaneRendererFeature cane) { existing = cane; break; }
                if (!existing)
                {
                    Undo.RecordObject(renderer, "Add Cane renderer feature");
                    existing = ScriptableObject.CreateInstance<CaneRendererFeature>(); existing.name = "Cane final packets";
                    Undo.RegisterCreatedObjectUndo(existing, "Create Cane renderer feature");
                    AssetDatabase.AddObjectToAsset(existing, renderer); renderer.rendererFeatures.Add(existing);
                }
                Undo.RecordObject(existing, "Enable Cane renderer feature"); existing.SetActive(true); existing.RenderSceneView = true;
                EditorUtility.SetDirty(existing); EditorUtility.SetDirty(renderer); renderer.SetDirty();
            }
            AssetDatabase.SaveAssets();
        }
    }
}
