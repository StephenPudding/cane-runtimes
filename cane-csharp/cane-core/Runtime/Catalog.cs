using System;
using System.Collections.Generic;
using System.Threading;
using Cane.Format;

namespace Cane
{
    public readonly struct RuntimeVersion
    {
        public readonly int Major, Minor;
        internal RuntimeVersion(Json version) { Major = version.I("major"); Minor = version.I("minor"); }
        public override string ToString() => Major + "." + Minor;
    }
    public enum RuntimeWarningCode { UnknownOptionalCanebSectionIgnored = 1 }
    public sealed class RuntimeWarning
    {
        public RuntimeWarningCode Code => RuntimeWarningCode.UnknownOptionalCanebSectionIgnored;
        public string Operation => "loadCaneb";
        public string Message => "Ignored unknown optional CANEB section '" + SectionTag + "'.";
        public string SectionTag { get; }
        internal RuntimeWarning(string tag) { SectionTag = tag; }
    }
    /// <summary>An immutable catalog declaration. ToJson returns the complete native definition, including optional metadata.</summary>
    public sealed class RuntimeCatalogEntry
    {
        private readonly Json definition;
        public string Id { get; }
        public string Name { get; }
        public string? Kind { get; }
        internal RuntimeCatalogEntry(Json row, string idField) { definition = row; Id = row.S(idField); Name = row.S("name"); Kind = row["type"].StringOrNull; }
        public string ToJson() => definition.Encode();
    }
    public sealed class RuntimeCatalog
    {
        public RuntimeVersion FormatVersion { get; }
        public RuntimeVersion RuntimeApiVersion { get; }
        public string GeneratorName { get; }
        public string GeneratorVersion { get; }
        public string SkeletonId { get; }
        public string Name { get; }
        public float ReferenceScale { get; }
        public IReadOnlyList<string> RequiredFeatures { get; }
        public IReadOnlyList<RuntimeWarning> Warnings { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Atlases { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Images { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Audios { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Fonts { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Bones { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Slots { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Attachments { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Constraints { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Skins { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Events { get; }
        public IReadOnlyList<RuntimeCatalogEntry> Animations { get; }
        internal RuntimeCatalog(RuntimeData data)
        {
            Json doc = data.Document; FormatVersion = new RuntimeVersion(doc["formatVersion"]); RuntimeApiVersion = new RuntimeVersion(doc["runtimeApiVersion"]);
            GeneratorName = doc["generator"].S("name"); GeneratorVersion = doc["generator"].S("version");
            SkeletonId = data.SkeletonId; Name = data.Name; ReferenceScale = data.ReferenceScale; RequiredFeatures = data.RequiredFeatures; Warnings = data.Warnings;
            Atlases = Entries(doc["atlases"], "atlasId"); Images = Entries(doc["images"], "imageId"); Audios = Entries(doc["audios"], "audioId"); Fonts = Entries(doc["fonts"], "fontId");
            Bones = Entries(doc["bones"]); Slots = Entries(doc["slots"]); Attachments = Entries(doc["attachments"]); Constraints = Entries(doc["constraints"]);
            Skins = Entries(doc["skins"]); Events = Entries(doc["events"]); Animations = Entries(doc["animations"]);
        }
        private static IReadOnlyList<RuntimeCatalogEntry> Entries(Json rows, string field = "id")
        { var result = new RuntimeCatalogEntry[rows.Items.Count]; for (int i = 0; i < result.Length; i++) result[i] = new RuntimeCatalogEntry(rows[i], field); return Array.AsReadOnly(result); }
    }

    public enum TextureResourceKind { Direct, AtlasPage }
    /// <summary>One external decoded image resource. Atlas pages appear once, including pages unused by the current frame.</summary>
    public sealed class RuntimeTextureResource
    {
        public TextureResourceKind Kind { get; }
        public string? ImageId { get; }
        public string? AtlasId { get; }
        public string? PageId { get; }
        public string? AtlasPath { get; }
        public string Path { get; }
        public int Width { get; }
        public int Height { get; }
        public string ColorSpace { get; }
        public string AlphaMode { get; }
        public string PixelFormat { get; } = "rgba8";
        public string MinFilter { get; } = "linear";
        public string MagFilter { get; } = "linear";
        public string WrapU { get; } = "clamp";
        public string WrapV { get; } = "clamp";
        internal RuntimeTextureResource(TextureDescriptor direct)
        { Kind = TextureResourceKind.Direct; ImageId = direct.ImageId; Path = direct.Path; Width = direct.Width; Height = direct.Height; ColorSpace = direct.ColorSpace; AlphaMode = direct.AlphaMode; }
        internal RuntimeTextureResource(Json reference, Json atlas, Json page)
        {
            Kind = TextureResourceKind.AtlasPage; AtlasId = atlas.S("atlasId"); PageId = page.S("pageId"); AtlasPath = reference.S("path"); Path = page.S("image");
            Width = page.I("width"); Height = page.I("height"); ColorSpace = atlas.S("colorSpace"); AlphaMode = atlas.S("alphaMode");
            PixelFormat = page.S("pixelFormat"); MinFilter = page.S("minFilter"); MagFilter = page.S("magFilter"); WrapU = page.S("wrapU"); WrapV = page.S("wrapV");
        }
        internal (TextureResourceKind, string?, string?) Key => (Kind, Kind == TextureResourceKind.Direct ? ImageId : AtlasId, PageId);
    }
    public sealed class DecodedTextureDimensions
    {
        public TextureResourceKind Kind { get; }
        public string? ImageId { get; }
        public string? AtlasId { get; }
        public string? PageId { get; }
        public int Width { get; }
        public int Height { get; }
        private DecodedTextureDimensions(TextureResourceKind kind, string? imageId, string? atlasId, string? pageId, int width, int height)
        { Kind = kind; ImageId = imageId; AtlasId = atlasId; PageId = pageId; Width = width; Height = height; }
        public static DecodedTextureDimensions Direct(string imageId, int width, int height) => new DecodedTextureDimensions(TextureResourceKind.Direct, imageId, null, null, width, height);
        public static DecodedTextureDimensions AtlasPage(string atlasId, string pageId, int width, int height) => new DecodedTextureDimensions(TextureResourceKind.AtlasPage, null, atlasId, pageId, width, height);
        internal (TextureResourceKind, string?, string?) Key => (Kind, Kind == TextureResourceKind.Direct ? ImageId : AtlasId, PageId);
    }
    public sealed partial class RuntimeData
    {
        private RuntimeCatalog? catalog;
        private IReadOnlyList<RuntimeTextureResource>? textureResources;
        public IReadOnlyList<RuntimeWarning> Warnings { get; private set; } = Array.AsReadOnly(Array.Empty<RuntimeWarning>());
        public RuntimeCatalog QueryCatalog()
        {
            RuntimeCatalog? current = Volatile.Read(ref catalog); if (current != null) return current;
            var created = new RuntimeCatalog(this); return Interlocked.CompareExchange(ref catalog, created, null) ?? created;
        }
        public IReadOnlyList<RuntimeTextureResource> QueryTextureResources()
        {
            IReadOnlyList<RuntimeTextureResource>? current = Volatile.Read(ref textureResources); if (current != null) return current;
            var result = new List<RuntimeTextureResource>();
            foreach (Json row in Document["images"].Items) if (row["atlasId"].IsNull) result.Add(new RuntimeTextureResource(Images[row.S("imageId")].Texture));
            foreach (Json reference in Document["atlases"].Items)
            {
                Json atlas = AtlasDocuments[reference.S("atlasId")];
                foreach (Json page in atlas["pages"].Items) result.Add(new RuntimeTextureResource(reference, atlas, page));
            }
            IReadOnlyList<RuntimeTextureResource> created = result.AsReadOnly();
            return Interlocked.CompareExchange(ref textureResources, created, null) ?? created;
        }
        /// <summary>Validates all decoded resources before a host changes GPU state. Performs no resource I/O and retains no engine objects.</summary>
        public void ValidateDecodedTextureCatalog(IReadOnlyList<DecodedTextureDimensions> resources)
        {
            const string op = "validateDecodedTextureCatalog";
            ValidateDecodedTextureFacts(CopyDecodedTextureFacts(resources, op), op);
        }
        internal static DecodedTextureDimensions[] CopyDecodedTextureFacts(IReadOnlyList<DecodedTextureDimensions> resources, string op)
        {
            if (resources == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Decoded texture catalog is required.", "resources");
            var seen = new HashSet<(TextureResourceKind, string?, string?)>();
            var copy = new DecodedTextureDimensions[resources.Count];
            for (int i = 0; i < copy.Length; i++)
            {
                DecodedTextureDimensions value = resources[i]; string field = "resources[" + i + "]";
                if (value == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Decoded resource is required.", field);
                string? id = value.Kind == TextureResourceKind.Direct ? value.ImageId : value.PageId;
                if (string.IsNullOrEmpty(id) || id!.IndexOf('\0') >= 0 || value.Kind == TextureResourceKind.AtlasPage && (string.IsNullOrEmpty(value.AtlasId) || value.AtlasId!.IndexOf('\0') >= 0))
                    throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Decoded resource IDs must be non-empty and NUL-free.", field, id);
                if (!seen.Add(value.Key)) throw new RuntimeException(RuntimeErrorCode.ValidationFailed, op, "Decoded resource is duplicated.", field, id);
                if (value.Width <= 0 || value.Height <= 0) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Decoded dimensions must be positive.", field + (value.Width <= 0 ? ".width" : ".height"), id);
                copy[i] = value;
            }
            return copy;
        }
        private void ValidateDecodedTextureFacts(DecodedTextureDimensions[] resources, string op)
        {
            var expected = new Dictionary<(TextureResourceKind, string?, string?), RuntimeTextureResource>();
            foreach (RuntimeTextureResource resource in QueryTextureResources()) expected.Add(resource.Key, resource);
            for (int i = 0; i < resources.Length; i++)
            {
                DecodedTextureDimensions value = resources[i]; string field = "resources[" + i + "]";
                string? id = value.Kind == TextureResourceKind.Direct ? value.ImageId : value.PageId;
                if (!expected.TryGetValue(value.Key, out RuntimeTextureResource? declaration)) throw new RuntimeException(RuntimeErrorCode.ValidationFailed, op, "Decoded resource is not declared.", field, id);
                if (value.Width != declaration.Width || value.Height != declaration.Height)
                    throw new RuntimeException(RuntimeErrorCode.ValidationFailed, op, "Decoded dimensions differ from the runtime resource declaration.", field, id);
                expected.Remove(value.Key);
            }
            foreach (var pair in expected) throw new RuntimeException(RuntimeErrorCode.MissingResource, op, "Decoded texture catalog is incomplete.", "resources", pair.Value.ImageId ?? pair.Value.PageId);
        }
    }
}
