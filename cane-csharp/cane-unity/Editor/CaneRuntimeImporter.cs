using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.AssetImporters;
using UnityEngine;
using UnityEngine.Rendering;

namespace Cane.Unity.Editor
{
    [ScriptedImporter(2, new[] { "caneb" }, new[] { "json" })]
    public sealed class CaneRuntimeImporter : ScriptedImporter
    {
        [Serializable] private sealed class Header { public string format; }
        internal static bool Recognizes(string path)
        {
            if (!path.StartsWith("Assets/", StringComparison.Ordinal) || path.StartsWith("Assets/StreamingAssets/", StringComparison.OrdinalIgnoreCase) ||
                !path.EndsWith(".json", StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return false;
            try { string format = JsonUtility.FromJson<Header>(File.ReadAllText(path))?.format; return format == "cane-runtime" || format == "cane-atlas"; }
            catch (ArgumentException) { return false; }
        }

        public override void OnImportAsset(AssetImportContext context)
        {
            CaneImportRecovery.Forget(context.assetPath);
            try { Import(context); }
            catch (FileNotFoundException error)
            {
                CaneImportRecovery.Remember(context.assetPath, error.FileName);
                throw;
            }
        }

        private static void Import(AssetImportContext context)
        {
            byte[] bytes = File.ReadAllBytes(context.assetPath);
            if (context.assetPath.EndsWith(".json", StringComparison.OrdinalIgnoreCase) &&
                JsonUtility.FromJson<Header>(Encoding.UTF8.GetString(bytes))?.format == "cane-atlas")
            {
                var atlas = new TextAsset(Encoding.UTF8.GetString(bytes)) { name = Path.GetFileNameWithoutExtension(context.assetPath) };
                context.AddObjectToAsset("atlas", atlas); context.SetMainObject(atlas); return;
            }
            var sources = new List<CaneSkeletonData.AtlasSource>();
            var documents = new Dictionary<string, string>(StringComparer.Ordinal);
            var directories = new Dictionary<string, string>(StringComparer.Ordinal);
            var digest = new StringBuilder();
            string root = Path.GetDirectoryName(context.assetPath);
            foreach (RuntimeAtlasReference reference in RuntimeLoadPlan.InspectAtlasReferences(bytes))
            {
                string path = Resolve(root, reference.Path);
                context.DependsOnSourceAsset(path);
                if (!File.Exists(path)) throw new FileNotFoundException("Cane Atlas is missing: " + path, path);
                string json = File.ReadAllText(path);
                var text = new TextAsset(json) { name = reference.AtlasId };
                context.AddObjectToAsset("atlas:" + reference.AtlasId, text);
                sources.Add(new CaneSkeletonData.AtlasSource { Id = reference.AtlasId, Document = text });
                documents.Add(reference.AtlasId, json); directories.Add(reference.AtlasId, Path.GetDirectoryName(path));
                digest.Append(Hash(Encoding.UTF8.GetBytes(json)));
            }
            var options = new RuntimeLoadOptions { AtlasJson = documents };
            RuntimeLoadPlan plan = bytes.Length >= 5 && Encoding.ASCII.GetString(bytes, 0, 5) == "CANEB"
                ? RuntimeLoadPlan.FromCaneb(bytes, options) : RuntimeLoadPlan.FromJson(bytes, options);
            var images = new List<CaneSkeletonData.TextureSource>();
            foreach (RuntimeTextureRequest request in plan.TextureRequests)
            {
                string path = Resolve(request.Kind == TextureResourceKind.Direct ? root : directories[request.AtlasId], request.Path);
                context.DependsOnSourceAsset(path);
                if (!File.Exists(path)) throw new FileNotFoundException("Cane image is missing: " + path, path);
                byte[] pixels = File.ReadAllBytes(path); digest.Append(Hash(pixels));
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false, true) {
                    name = Path.GetFileNameWithoutExtension(path), filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp
                };
                if (!ImageConversion.LoadImage(texture, pixels, true)) { DestroyImmediate(texture); throw new InvalidDataException("Cane image cannot be decoded: " + path); }
                string key = request.Kind == TextureResourceKind.Direct ? "image:" + request.ImageId :
                    "atlas-page:" + request.AtlasId.Length + ":" + request.AtlasId + ":" + request.PageId;
                context.AddObjectToAsset(key, texture);
                images.Add(new CaneSkeletonData.TextureSource { ImageId = request.ImageId, AtlasId = request.AtlasId, PageId = request.PageId, Texture = texture });
            }
            const string shaderPath = "Packages/com.cane.runtime.unity/Runtime/Resources/CaneFinalPacket.shader";
            context.DependsOnArtifact(shaderPath);
            Shader shader = AssetDatabase.LoadAssetAtPath<Shader>(shaderPath);
            if (!shader) throw new InvalidDataException("Cane final-packet shader is missing. Reinstall the Cane Unity package.");
            var materials = new Material[4];
            string[] modes = { "Normal", "Add", "Multiply", "Screen" };
            for (int i = 0; i < materials.Length; ++i)
            {
                var material = new Material(shader) { name = "Cane " + modes[i] };
                material.SetInt("_CaneSrcRgb", (int)(i == 2 ? BlendMode.DstColor : BlendMode.One));
                material.SetInt("_CaneDstRgb", (int)(i == 1 ? BlendMode.One : i == 3 ? BlendMode.OneMinusSrcColor : BlendMode.OneMinusSrcAlpha));
                material.SetInt("_CaneDstAlpha", (int)(i == 1 ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
                materials[i] = material; context.AddObjectToAsset("material:" + modes[i], material);
            }
            var data = ScriptableObject.CreateInstance<CaneSkeletonData>();
            data.name = Path.GetFileNameWithoutExtension(context.assetPath);
            context.AddObjectToAsset("skeleton-data", data);
            data.Import(bytes, sources.ToArray(), images.ToArray(), materials, Hash(bytes) + digest);
            var prefab = new GameObject(data.name);
            var skeleton = prefab.AddComponent<CaneSkeleton>(); skeleton.SkeletonData = data;
            skeleton.InitialAnimation = data.AnimationIds.Count == 0 ? "" : data.AnimationIds[0];
            foreach (string id in data.AnimationIds) if (id == "run" || id == "idle") { skeleton.InitialAnimation = id; break; }
            skeleton.InitialSkins = data.SkinIds.Count == 0 ? Array.Empty<string>() : new[] { data.SkinIds[0] };
            prefab.transform.localScale = Vector3.one / Math.Max(1, data.GetAsset().Data.ReferenceScale);
            context.AddObjectToAsset("prefab", prefab); context.SetMainObject(prefab);
        }
        private static string Resolve(string directory, string relative)
        {
            string absolute = Path.GetFullPath(Path.Combine(directory, relative));
            string project = Path.GetFullPath(".") + Path.DirectorySeparatorChar;
            if (!absolute.StartsWith(project, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Cane dependency leaves the Unity project: " + relative);
            return absolute.Substring(project.Length).Replace('\\', '/');
        }
        private static string Hash(byte[] bytes)
        { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    }

    internal sealed class CaneJsonDiscovery : AssetPostprocessor
    {
        private static readonly HashSet<string> pending = new HashSet<string>(StringComparer.Ordinal);
        private static bool scheduled;
        [InitializeOnLoadMethod]
        private static void DiscoverExisting() => EditorApplication.delayCall += () => {
            foreach (string guid in AssetDatabase.FindAssets("t:TextAsset", new[] { "Assets" })) Queue(AssetDatabase.GUIDToAssetPath(guid));
            if (pending.Count > 0 && !scheduled) { scheduled = true; EditorApplication.delayCall += Apply; }
        };
        private static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] previous)
        {
            CaneImportRecovery.Changed(imported, deleted, moved, previous);
            foreach (string path in imported) Queue(path);
            foreach (string path in moved) Queue(path);
            if (pending.Count == 0 || scheduled) return;
            scheduled = true; EditorApplication.delayCall += Apply;
        }
        private static void Queue(string path)
        {
            if (CaneRuntimeImporter.Recognizes(path) && AssetDatabase.GetImporterOverride(path) != typeof(CaneRuntimeImporter)) pending.Add(path);
        }
        private static void Apply()
        {
            scheduled = false; string[] paths = new string[pending.Count]; pending.CopyTo(paths); pending.Clear();
            foreach (string path in paths) if (CaneRuntimeImporter.Recognizes(path) && AssetDatabase.GetImporterOverride(path) != typeof(CaneRuntimeImporter))
                AssetDatabase.SetImporterOverride<CaneRuntimeImporter>(path);
        }
    }
}
