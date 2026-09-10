using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Cane.Unity.Editor
{
    public static class CaneSceneSetup
    {
        // Optional pipeline assemblies register their editor integrations without coupling the base package to SRP.
        public static readonly Dictionary<string, Func<string>> PipelineIssues = new Dictionary<string, Func<string>>();
        public static readonly Dictionary<string, Action> PipelineSetup = new Dictionary<string, Action>();
        public static string Pipeline => GraphicsSettings.currentRenderPipeline ? GraphicsSettings.currentRenderPipeline.GetType().FullName : "Built-in";
        public static string GetIssue()
        {
            if (PlayerSettings.colorSpace != ColorSpace.Linear) return "Cane requires Linear color space. Setup updates Player Settings and the scene renderer.";
            if (GraphicsSettings.currentRenderPipeline)
                return PipelineIssues.TryGetValue(Pipeline, out var issue) ? issue() : "Install a supported Cane render-pipeline integration for this project.";
            bool found = false;
            foreach (var camera in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
                if (camera.gameObject.scene.IsValid() && camera.cameraType == CameraType.Game)
                { found = true; var pass = camera.GetComponent<CaneCameraRenderer>(); if (!pass || !pass.enabled) return "Add the Cane camera pass to render skeletons in this scene."; }
            return found ? null : "Create a camera with the Cane rendering pass.";
        }
        [MenuItem("Tools/Cane/Configure scene rendering")]
        public static void Configure()
        {
            if (GraphicsSettings.currentRenderPipeline && !PipelineSetup.ContainsKey(Pipeline))
            { Debug.LogError("The active render pipeline does not have a supported Cane integration installed."); return; }
            PlayerSettings.colorSpace = ColorSpace.Linear;
            if (GraphicsSettings.currentRenderPipeline) PipelineSetup[Pipeline]();
            else
            {
                var cameras = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
                if (cameras.Length == 0)
                {
                    var go = new GameObject("Cane Camera"); Undo.RegisterCreatedObjectUndo(go, "Create Cane camera");
                    var camera = Undo.AddComponent<Camera>(go); camera.orthographic = true; camera.orthographicSize = 4;
                    camera.transform.position = new Vector3(0, 2, -10); camera.clearFlags = CameraClearFlags.SolidColor;
                    camera.backgroundColor = new Color(.12f, .13f, .15f, 1); cameras = new[] { camera };
                }
                foreach (var camera in cameras)
                    if (camera.gameObject.scene.IsValid() && camera.cameraType == CameraType.Game)
                    {
                        var pass = camera.GetComponent<CaneCameraRenderer>();
                        if (!pass) pass = Undo.AddComponent<CaneCameraRenderer>(camera.gameObject);
                        else if (!pass.enabled) { Undo.RecordObject(pass, "Enable Cane renderer"); pass.enabled = true; }
                    }
            }
            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene()); SceneView.RepaintAll();
        }
    }

    [InitializeOnLoad]
    internal static class CaneSceneViewRenderer
    {
        private static readonly Dictionary<Camera, CommandBuffer> buffers = new Dictionary<Camera, CommandBuffer>();
        private static readonly List<Camera> removed = new List<Camera>();
        private static readonly CaneSceneRenderer renderer = new CaneSceneRenderer();
        static CaneSceneViewRenderer()
        {
            Camera.onPreCull += Prepare; AssemblyReloadEvents.beforeAssemblyReload += Clear; EditorApplication.quitting += Clear;
            EditorApplication.update += Prune;
        }
        private static void Prune()
        {
            foreach (var pair in buffers) if (!pair.Key) { pair.Value.Dispose(); removed.Add(pair.Key); }
            foreach (var camera in removed) buffers.Remove(camera); removed.Clear();
        }
        private static void Prepare(Camera camera)
        {
            if (GraphicsSettings.currentRenderPipeline || QualitySettings.activeColorSpace != ColorSpace.Linear) { Clear(); return; }
            if (!camera || camera.cameraType != CameraType.SceneView || camera.GetComponent<CaneCameraRenderer>()) return;
            if (!buffers.TryGetValue(camera, out var commands))
            {
                commands = new CommandBuffer { name = "Cane scene preview" }; buffers.Add(camera, commands);
                camera.AddCommandBuffer(CameraEvent.AfterForwardAlpha, commands);
            }
            commands.Clear(); renderer.Record(commands, camera);
        }
        private static void Clear()
        {
            foreach (var pair in buffers)
            { if (pair.Key) pair.Key.RemoveCommandBuffer(CameraEvent.AfterForwardAlpha, pair.Value); pair.Value.Dispose(); }
            buffers.Clear();
        }
    }
}
