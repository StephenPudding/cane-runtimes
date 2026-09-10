using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace Cane.Unity
{
    /// <summary>Immutable Core data plus owned raw engine textures. Create and release on the Unity main thread.</summary>
    public sealed partial class CaneAsset : IDisposable
    {
        internal sealed class TextureStorage
        {
            internal readonly Texture2D Texture;
            private int references = 1;
            private readonly bool owned;
            internal TextureStorage(Texture2D texture, bool owned = true) { Texture = texture; this.owned = owned; }
            internal void Retain()
            {
                if (!Texture || references == 0) throw UnityObjects.Error("prepareResources", "A shared texture was destroyed outside its owner.");
                checked { references++; }
            }
            internal void Release() { if (--references == 0 && owned) UnityObjects.Release(Texture); }
        }

        internal sealed class TextureEntry
        {
            internal readonly RuntimeTextureResource Descriptor;
            private readonly TextureStorage storage;
            internal Texture2D Texture => storage.Texture;
            internal TextureEntry(RuntimeTextureResource descriptor, TextureStorage storage)
            { Descriptor = descriptor; this.storage = storage; }
            internal TextureEntry Share(RuntimeTextureResource descriptor)
            {
                var entry = new TextureEntry(descriptor, storage);
                storage.Retain(); return entry;
            }
            internal void Release() => storage.Release();
        }

        public RuntimeData Data { get; }
        private readonly Dictionary<(string, string), TextureEntry> textures;
        private int references = 1;
        private bool disposed;

        private CaneAsset(RuntimeData data, Dictionary<(string, string), TextureEntry> textures)
        { Data = data; this.textures = textures; }

        /// <summary>The atlas map uses stable atlas IDs and actual file paths. Atlas pages resolve beside their atlas.</summary>
        public static CaneAsset LoadFiles(string runtimePath, IReadOnlyDictionary<string, string> atlasPaths = null,
            bool allowUnverifiedFeatures = false, IReadOnlyList<DecodedTextureDimensions> decodedDimensions = null)
        {
            string absolute = Path.GetFullPath(runtimePath);
            var atlases = new Dictionary<string, string>(StringComparer.Ordinal);
            var directories = new Dictionary<string, string>(StringComparer.Ordinal);
            if (atlasPaths != null) foreach (var entry in atlasPaths)
            {
                string path = Path.GetFullPath(entry.Value);
                atlases.Add(entry.Key, new UTF8Encoding(false, true).GetString(File.ReadAllBytes(path)));
                directories.Add(entry.Key, Path.GetDirectoryName(path));
            }
            return Load(File.ReadAllBytes(absolute), atlases, descriptor => File.ReadAllBytes(Path.Combine(
                descriptor.Kind == TextureResourceKind.Direct ? Path.GetDirectoryName(absolute) : directories[descriptor.AtlasId], descriptor.Path)),
                allowUnverifiedFeatures, decodedDimensions);
        }

        /// <summary>The host supplies bytes; all decoding is raw (no implicit sRGB conversion). No I/O enters Core.</summary>
        public static CaneAsset Load(byte[] runtimeBytes, IReadOnlyDictionary<string, string> atlasJson,
            Func<RuntimeTextureRequest, byte[]> imageBytes, bool allowUnverifiedFeatures = false,
            IReadOnlyList<DecodedTextureDimensions> decodedDimensions = null)
        {
            if (runtimeBytes == null) throw new ArgumentNullException(nameof(runtimeBytes));
            if (imageBytes == null) throw new ArgumentNullException(nameof(imageBytes));
            var options = new RuntimeLoadOptions { AllowUnverifiedFeatures = allowUnverifiedFeatures, DecodedTextures = decodedDimensions };
            if (atlasJson != null) options.AtlasJson = atlasJson;
            bool binary = runtimeBytes.Length >= 5 && runtimeBytes[0] == 'C' && runtimeBytes[1] == 'A' && runtimeBytes[2] == 'N'
                && runtimeBytes[3] == 'E' && runtimeBytes[4] == 'B';
            RuntimeLoadPlan plan = binary ? RuntimeLoadPlan.FromCaneb(runtimeBytes, options) : RuntimeLoadPlan.FromJson(runtimeBytes, options);
            var decodedTextures = new Dictionary<(string, string), TextureStorage>();
            try
            {
                var dimensions = new List<DecodedTextureDimensions>();
                foreach (RuntimeTextureRequest resource in plan.TextureRequests)
                {
                    TextureStorage storage = Decode(imageBytes(resource), resource.Path, resource.ImageId ?? resource.PageId);
                    try { decodedTextures.Add(Key(resource), storage); }
                    catch { storage.Release(); throw; }
                    Texture2D texture = storage.Texture;
                    dimensions.Add(resource.Kind == TextureResourceKind.Direct
                        ? DecodedTextureDimensions.Direct(resource.ImageId, texture.width, texture.height)
                        : DecodedTextureDimensions.AtlasPage(resource.AtlasId, resource.PageId, texture.width, texture.height));
                }
                RuntimeData data = plan.CreateData(dimensions);
                var textures = new Dictionary<(string, string), TextureEntry>();
                foreach (RuntimeTextureResource resource in data.QueryTextureResources())
                    textures.Add(Key(resource), new TextureEntry(resource, decodedTextures[Key(resource)]));
                return new CaneAsset(data, textures);
            }
            catch { foreach (TextureStorage storage in decodedTextures.Values) storage.Release(); throw; }
        }

        private static TextureStorage Decode(byte[] bytes, string path, string id)
        {
            if (bytes == null) throw new RuntimeException(RuntimeErrorCode.MissingResource, "loadTexture", "The host did not supply image bytes.", "path", id);
            var texture = UnityObjects.Own(new Texture2D(2, 2, TextureFormat.RGBA32, false, true) {
                name = "Cane: " + path, hideFlags = HideFlags.HideAndDontSave,
                filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp
            });
            try
            {
                if (!ImageConversion.LoadImage(texture, bytes, true))
                    throw new RuntimeException(RuntimeErrorCode.MalformedInput, "loadTexture", "Unity could not decode the image: " + path, "path", id);
                if (texture.isDataSRGB) throw UnityObjects.Error("loadTexture", "Cane requires raw linear texture storage.", "colorSpace", id);
                return new TextureStorage(texture);
            }
            catch { UnityObjects.Release(texture); throw; }
        }

        private static (string, string) Key(RuntimeTextureRequest value)
            => value.Kind == TextureResourceKind.Direct ? (null, value.ImageId) : (value.AtlasId, value.PageId);
        internal static (string, string) Key(RuntimeTextureResource value)
            => value.Kind == TextureResourceKind.Direct ? (null, value.ImageId) : (value.AtlasId, value.PageId);
        internal TextureEntry Resolve(TextureDescriptor value)
        {
            if (!textures.TryGetValue(value.AtlasId == null ? (null, value.ImageId) : (value.AtlasId, value.PageId), out TextureEntry entry))
                throw new RuntimeException(RuntimeErrorCode.MissingResource, "projectPacket", "The frame needs a texture absent from this asset.", "imageId", value.ImageId);
            if (!entry.Texture) throw UnityObjects.Error("projectPacket", "An owned texture was destroyed outside the asset.", "imageId", value.ImageId);
            if (entry.Texture.width != value.Width || entry.Texture.height != value.Height || entry.Descriptor.ColorSpace != value.ColorSpace || entry.Descriptor.AlphaMode != value.AlphaMode || entry.Descriptor.Path != value.Path)
                throw UnityObjects.Error("projectPacket", "The frame's resource descriptor differs from the loaded texture catalog.", "imageId", value.ImageId);
            return entry;
        }
        internal void Retain()
        {
            if (disposed) throw new ObjectDisposedException(nameof(CaneAsset));
            checked { references++; }
        }
        internal void Release()
        {
            if (--references != 0) return;
            foreach (TextureEntry entry in textures.Values) entry.Release();
            textures.Clear();
        }
        public void Dispose() { if (disposed) return; disposed = true; Release(); }
    }
}
