using System;
using System.Collections.Generic;
using UnityEngine;

namespace Cane.Unity
{
    public sealed partial class CaneAsset
    {
        internal IReadOnlyList<Material> MaterialTemplates { get; set; }
        /// <summary>Use raw textures owned by Unity assets. Disposal never destroys the supplied textures.</summary>
        public static CaneAsset LoadTextures(byte[] runtimeBytes, IReadOnlyDictionary<string, string> atlasJson,
            Func<RuntimeTextureRequest, Texture2D> resolve)
        {
            if (runtimeBytes == null) throw new ArgumentNullException(nameof(runtimeBytes));
            if (resolve == null) throw new ArgumentNullException(nameof(resolve));
            var options = new RuntimeLoadOptions();
            if (atlasJson != null) options.AtlasJson = atlasJson;
            bool binary = runtimeBytes.Length >= 5 && runtimeBytes[0] == 'C' && runtimeBytes[1] == 'A' && runtimeBytes[2] == 'N'
                && runtimeBytes[3] == 'E' && runtimeBytes[4] == 'B';
            RuntimeLoadPlan plan = binary ? RuntimeLoadPlan.FromCaneb(runtimeBytes, options) : RuntimeLoadPlan.FromJson(runtimeBytes, options);
            var resources = new Dictionary<(string, string), TextureStorage>();
            try
            {
                var dimensions = new List<DecodedTextureDimensions>();
                foreach (RuntimeTextureRequest request in plan.TextureRequests)
                {
                    Texture2D texture = resolve(request);
                    if (!texture) throw UnityObjects.Error("loadTexture", "The imported texture reference is missing: " + request.Path, "path", request.ImageId ?? request.PageId);
                    if (texture.isDataSRGB) throw UnityObjects.Error("loadTexture", "Imported Cane textures require raw linear storage.", "colorSpace", request.Path);
                    resources.Add(Key(request), new TextureStorage(texture, false));
                    dimensions.Add(request.Kind == TextureResourceKind.Direct
                        ? DecodedTextureDimensions.Direct(request.ImageId, texture.width, texture.height)
                        : DecodedTextureDimensions.AtlasPage(request.AtlasId, request.PageId, texture.width, texture.height));
                }
                RuntimeData data = plan.CreateData(dimensions);
                var entries = new Dictionary<(string, string), TextureEntry>();
                foreach (RuntimeTextureResource resource in data.QueryTextureResources())
                    entries.Add(Key(resource), new TextureEntry(resource, resources[Key(resource)]));
                return new CaneAsset(data, entries);
            }
            catch { foreach (TextureStorage storage in resources.Values) storage.Release(); throw; }
        }
    }
}
