using System;
using System.Collections.Generic;
using Cane.Format;

namespace Cane
{
    /// <summary>Owned source dependency metadata; file acquisition remains in the host.</summary>
    public sealed class RuntimeAtlasReference
    {
        public string AtlasId { get; }
        public string Path { get; }
        internal RuntimeAtlasReference(string atlasId, string path) { AtlasId = atlasId; Path = path; }
    }

    /// <summary>A renderer-neutral decode request. Missing declared dimensions stay null until the host observes pixels.</summary>
    public sealed class RuntimeTextureRequest
    {
        public TextureResourceKind Kind { get; }
        public string? ImageId { get; }
        public string? AtlasId { get; }
        public string? PageId { get; }
        public string? AtlasPath { get; }
        public string Path { get; }
        public int? DeclaredWidth { get; }
        public int? DeclaredHeight { get; }
        public string ColorSpace { get; } = "srgb";
        public string AlphaMode { get; } = "straight";
        public string PixelFormat { get; } = "rgba8";
        public string MinFilter { get; } = "linear";
        public string MagFilter { get; } = "linear";
        public string WrapU { get; } = "clamp";
        public string WrapV { get; } = "clamp";
        internal RuntimeTextureRequest(Json image)
        {
            Kind = TextureResourceKind.Direct; ImageId = image.S("imageId"); Path = image.S("path");
            DeclaredWidth = image["width"].IsNull ? (int?)null : image.I("width");
            DeclaredHeight = image["height"].IsNull ? (int?)null : image.I("height");
        }
        internal RuntimeTextureRequest(Json reference, Json atlas, Json page)
        {
            Kind = TextureResourceKind.AtlasPage; AtlasId = atlas.S("atlasId"); PageId = page.S("pageId");
            AtlasPath = reference.S("path"); Path = page.S("image"); DeclaredWidth = page.I("width"); DeclaredHeight = page.I("height");
            ColorSpace = atlas.S("colorSpace"); AlphaMode = atlas.S("alphaMode"); PixelFormat = page.S("pixelFormat");
            MinFilter = page.S("minFilter"); MagFilter = page.S("magFilter"); WrapU = page.S("wrapU"); WrapV = page.S("wrapV");
        }
    }

    /// <summary>Owned preparation input, not a playable RuntimeData. Complete model/resource validation precedes CreateData success.</summary>
    public sealed class RuntimeLoadPlan
    {
        private readonly Json document;
        private readonly Dictionary<string, string> atlases;
        private readonly string[] optionalSections;
        private readonly DecodedTextureDimensions[]? expectedDimensions;
        private readonly bool compatibilityOption;
        public IReadOnlyList<RuntimeTextureRequest> TextureRequests { get; }
        public IReadOnlyList<RuntimeWarning> Warnings { get; }

        /// <summary>Inspect declared atlas paths before supplying atlas documents to the load plan.
        /// This validates the source container/header and references; CreateData still performs full validation.</summary>
        public static IReadOnlyList<RuntimeAtlasReference> InspectAtlasReferences(byte[] source) => Wrap("inspectDependencies", () => {
            if (source == null) throw new ArgumentNullException(nameof(source));
            bool binary = source.Length >= 5 && source[0] == 'C' && source[1] == 'A' && source[2] == 'N' && source[3] == 'E' && source[4] == 'B';
            Json doc = binary ? Caneb.Decode(source, out _) : Json.Parse(source);
            Validation.Root(doc);
            var references = new List<RuntimeAtlasReference>();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (Json row in doc["atlases"].Items) {
                Validation.Closed(row, "atlasId path", "atlasId path");
                string id = Validation.Id(row, "atlasId"), path = row.S("path");
                Validation.Path(path);
                if (!ids.Add(id)) throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "inspectDependencies", "Duplicate atlas ID.", "atlasId", id);
                references.Add(new RuntimeAtlasReference(id, path));
            }
            return (IReadOnlyList<RuntimeAtlasReference>)references.AsReadOnly();
        });

        public static RuntimeLoadPlan FromJson(string json, RuntimeLoadOptions? options = null) =>
            Wrap("prepareJson", () => new RuntimeLoadPlan(Json.Parse(json), options ?? new RuntimeLoadOptions(), Array.Empty<string>()));
        public static RuntimeLoadPlan FromJson(byte[] utf8, RuntimeLoadOptions? options = null) =>
            Wrap("prepareJson", () => new RuntimeLoadPlan(Json.Parse(utf8), options ?? new RuntimeLoadOptions(), Array.Empty<string>()));
        public static RuntimeLoadPlan FromCaneb(byte[] bytes, RuntimeLoadOptions? options = null) =>
            Wrap("prepareCaneb", () => { Json doc = Caneb.Decode(bytes, out string[] sections); return new RuntimeLoadPlan(doc, options ?? new RuntimeLoadOptions(), sections); });

        private RuntimeLoadPlan(Json doc, RuntimeLoadOptions options, string[] sections)
        {
            document = doc; Validation.Root(doc);
            if (options.AtlasJson == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "prepare", "Atlas inputs are required.", "atlasJson");
            atlases = new Dictionary<string, string>(options.AtlasJson, StringComparer.Ordinal);
            compatibilityOption = options.AllowUnverifiedFeatures;
            expectedDimensions = options.DecodedTextures == null ? null : RuntimeData.CopyDecodedTextureFacts(options.DecodedTextures, "prepare");
            optionalSections = (string[])sections.Clone(); var warnings = new RuntimeWarning[sections.Length];
            for (int i = 0; i < sections.Length; ++i) warnings[i] = new RuntimeWarning(sections[i]); Warnings = Array.AsReadOnly(warnings);
            var requests = new List<RuntimeTextureRequest>();
            foreach (Json image in doc["images"].Items) {
                Validation.Image(image);
                if (image["atlasId"].IsNull) requests.Add(new RuntimeTextureRequest(image));
            }
            var referenced = new HashSet<string>(StringComparer.Ordinal);
            foreach (Json reference in doc["atlases"].Items) {
                Validation.Closed(reference, "atlasId path", "atlasId path"); Validation.Path(reference.S("path"));
                string id = Validation.Id(reference, "atlasId"); referenced.Add(id);
                if (!atlases.TryGetValue(id, out string? source)) throw new RuntimeException(RuntimeErrorCode.MissingResource, "prepare", "Atlas JSON is required.", "atlasId", id);
                Json atlas = Json.Parse(source); Validation.Atlas(atlas);
                if (atlas.S("atlasId") != id) throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "prepare", "Atlas document and reference identities differ.", "atlasId", id);
                foreach (Json page in atlas["pages"].Items) requests.Add(new RuntimeTextureRequest(reference, atlas, page));
            }
            foreach (string id in atlases.Keys) if (!referenced.Contains(id))
                throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "prepare", "Supplied Atlas ID is not declared.", "atlasId", id);
            TextureRequests = requests.AsReadOnly();
        }

        public RuntimeData CreateData(IReadOnlyList<DecodedTextureDimensions> decoded) => Wrap("completeLoad", () => {
            var observations = RuntimeData.CopyDecodedTextureFacts(decoded, "completeLoad");
            RuntimeData data = RuntimeData.Load(document, new RuntimeLoadOptions { AtlasJson = atlases, DecodedTextures = observations, AllowUnverifiedFeatures = compatibilityOption });
            if (expectedDimensions != null) data.ValidateDecodedTextureCatalog(expectedDimensions);
            data.SetLoadWarnings(optionalSections); return data;
        });
        private static T Wrap<T>(string operation, Func<T> body)
        {
            try { return body(); }
            catch (RuntimeException e) { throw new RuntimeException(e.Code, operation, e.Message, e.Field, e.EntityId); }
            catch (OutOfMemoryException) { throw new RuntimeException(RuntimeErrorCode.ResourceLimit, operation, "Unable to allocate load preparation data."); }
            catch (Exception e) when (e is ArgumentException || e is OverflowException || e is IndexOutOfRangeException)
            { throw new RuntimeException(RuntimeErrorCode.ValidationFailed, operation, e.Message); }
        }
    }
}
