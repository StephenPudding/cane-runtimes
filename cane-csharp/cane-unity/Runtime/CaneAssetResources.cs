using System;
using System.Collections.Generic;
using System.IO;

namespace Cane.Unity
{
    public sealed partial class CaneAsset
    {
        // These identify decoded host bindings, not animation or resource-composition semantics.
        private Dictionary<string, string> imageOverlays = new Dictionary<string, string>(StringComparer.Ordinal);
        private Dictionary<string, string> atlasOverlays = new Dictionary<string, string>(StringComparer.Ordinal);

        internal static CaneAsset PrepareResources(RuntimeData data, RuntimeResourceSnapshot snapshot,
            CaneAsset source, CaneAsset previous, Func<RuntimeTextureResource, byte[]> imageBytes)
        {
            var images = Definitions(snapshot.Images);
            var atlases = Definitions(snapshot.Atlases);
            var entries = new Dictionary<(string, string), TextureEntry>();
            try
            {
                var dimensions = new List<DecodedTextureDimensions>();
                foreach (RuntimeTextureResource resource in data.QueryTextureResources())
                {
                    bool direct = resource.Kind == TextureResourceKind.Direct;
                    string id = direct ? resource.ImageId : resource.AtlasId;
                    bool overlay = (direct ? images : atlases).TryGetValue(id, out string definition);
                    TextureEntry entry;
                    if (!overlay)
                    {
                        // Always use the original pixels, even when an overlay reused the same declaration.
                        entry = ShareFrom(source, resource);
                    }
                    else
                    {
                        byte[] bytes = ReadReplacement(imageBytes, resource);
                        if (bytes != null)
                        {
                            TextureStorage storage = Decode(bytes, resource.Path, resource.ImageId ?? resource.PageId);
                            try { entry = new TextureEntry(resource, storage); }
                            catch { storage.Release(); throw; }
                        }
                        else if ((direct ? previous.imageOverlays : previous.atlasOverlays).TryGetValue(id, out string installed)
                            && installed == definition)
                            entry = ShareFrom(previous, resource);
                        else throw new RuntimeException(RuntimeErrorCode.MissingResource, "prepareResources",
                            "New or changed runtime textures require host image bytes: " + resource.Path, "path", resource.ImageId ?? resource.PageId);
                    }
                    try { entries.Add(Key(resource), entry); }
                    catch { entry.Release(); throw; }
                    dimensions.Add(direct
                        ? DecodedTextureDimensions.Direct(resource.ImageId, entry.Texture.width, entry.Texture.height)
                        : DecodedTextureDimensions.AtlasPage(resource.AtlasId, resource.PageId, entry.Texture.width, entry.Texture.height));
                }
                data.ValidateDecodedTextureCatalog(dimensions);
                return new CaneAsset(data, entries) { imageOverlays = images, atlasOverlays = atlases };
            }
            catch { foreach (TextureEntry entry in entries.Values) entry.Release(); throw; }
        }

        private static Dictionary<string, string> Definitions<T>(IReadOnlyList<T> values) where T : RuntimeResourceValue
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (T value in values) result.Add(value.Id, value.ToJson());
            return result;
        }

        private static TextureEntry ShareFrom(CaneAsset owner, RuntimeTextureResource resource)
        {
            if (!owner.textures.TryGetValue(Key(resource), out TextureEntry entry))
                throw new RuntimeException(RuntimeErrorCode.MissingResource, "prepareResources", "The retained texture catalog is incomplete.", "path", resource.ImageId ?? resource.PageId);
            return entry.Share(resource);
        }

        private static byte[] ReadReplacement(Func<RuntimeTextureResource, byte[]> provider, RuntimeTextureResource resource)
        {
            if (provider == null) return null;
            try { return provider(resource); }
            catch (FileNotFoundException) { throw MissingFile(resource); }
            catch (DirectoryNotFoundException) { throw MissingFile(resource); }
        }
        private static RuntimeException MissingFile(RuntimeTextureResource resource)
            => new RuntimeException(RuntimeErrorCode.MissingResource, "prepareResources", "The host texture file is missing: " + resource.Path, "path", resource.ImageId ?? resource.PageId);
    }
}
