using System;
using System.Collections.Generic;
using Cane.Format;

namespace Cane
{
    public sealed class RuntimeLoadOptions
    {
        /// <summary>Atlas JSON documents, keyed by their stable atlas ID. Resource I/O belongs to the host.</summary>
        public IReadOnlyDictionary<string, string> AtlasJson { get; set; } = new Dictionary<string, string>();
        /// <summary>Optional complete decoded texture catalog. Resolves omitted direct-image dimensions and verifies every direct image and atlas page.</summary>
        public IReadOnlyList<DecodedTextureDimensions>? DecodedTextures { get; set; }
        internal IReadOnlyDictionary<string, DecodedTextureDimensions>? InheritedDirectSizes;
        /// <summary>Retained for source compatibility. Known features load by default; unknown features always fail.</summary>
        public bool AllowUnverifiedFeatures { get; set; }
    }

    public sealed partial class RuntimeData
    {
        internal readonly Json Document;
        internal readonly Dictionary<string, string> AtlasSources = new Dictionary<string, string>(StringComparer.Ordinal);
        internal readonly Dictionary<string, Json> AtlasDocuments = new Dictionary<string, Json>(StringComparer.Ordinal);
        internal readonly Dictionary<string, DecodedTextureDimensions> DirectImageSizes = new Dictionary<string, DecodedTextureDimensions>(StringComparer.Ordinal);
        internal readonly bool AllowUnverifiedFeatures;
        internal readonly BoneData[] BoneData;
        internal readonly SlotData[] SlotData;
        internal readonly AttachmentData[] AttachmentData;
        internal readonly Dictionary<string, int> BoneIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        internal readonly Dictionary<string, int> SlotIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        internal readonly Dictionary<string, int> AttachmentIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        internal readonly Dictionary<string, Json> AnimationDocuments = new Dictionary<string, Json>(StringComparer.Ordinal);
        internal readonly Dictionary<string, Animation.Clip> Clips = new Dictionary<string, Animation.Clip>(StringComparer.Ordinal);
        internal readonly Dictionary<string, Json> SkinDocuments = new Dictionary<string, Json>(StringComparer.Ordinal);
        internal readonly Dictionary<string, Json> EventDocuments = new Dictionary<string, Json>(StringComparer.Ordinal);
        internal readonly Dictionary<string, ImageData> Images = new Dictionary<string, ImageData>(StringComparer.Ordinal);
        internal readonly Json[] Constraints;
        public string SkeletonId { get; }
        public string Name { get; }
        public float ReferenceScale { get; }
        public IReadOnlyList<AnimationInfo> Animations { get; }
        public IReadOnlyList<string> SkinIds { get; }
        public IReadOnlyList<string> RequiredFeatures { get; }
        public IReadOnlyList<string> IgnoredOptionalCanebSections { get; private set; } = Array.AsReadOnly(Array.Empty<string>());

        public static RuntimeData FromJson(string json, RuntimeLoadOptions? options = null) => Load(Json.Parse(json), options ?? new RuntimeLoadOptions());
        public static RuntimeData FromJson(byte[] utf8, RuntimeLoadOptions? options = null) => Load(Json.Parse(utf8), options ?? new RuntimeLoadOptions());
        public static RuntimeData FromCaneb(byte[] bytes, RuntimeLoadOptions? options = null)
        {
            Json document = Caneb.Decode(bytes, out string[] optionalSections);
            RuntimeData data = Load(document, options ?? new RuntimeLoadOptions());
            data.SetLoadWarnings(optionalSections); return data;
        }
        internal void SetLoadWarnings(string[] optionalSections)
        {
            IgnoredOptionalCanebSections = Array.AsReadOnly((string[])optionalSections.Clone());
            var warnings = new RuntimeWarning[optionalSections.Length];
            for (int i = 0; i < warnings.Length; i++) warnings[i] = new RuntimeWarning(optionalSections[i]);
            Warnings = Array.AsReadOnly(warnings);
        }
        public RuntimePlayer CreatePlayer() => new RuntimePlayer(this);

        internal static RuntimeData Load(Json document, RuntimeLoadOptions options)
        {
            try { return new RuntimeData(document, options); }
            catch (RuntimeException) { throw; }
            catch (Exception e) when (e is OverflowException || e is ArgumentException || e is IndexOutOfRangeException)
            { throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "loadJson", "Invalid runtime document: " + e.Message); }
        }

        internal static RuntimeData LoadOverlay(Json document, RuntimeLoadOptions options, RuntimeData source)
        {
            RuntimeData candidate = Load(document, options);
            // Immutable original load diagnostics remain owned metadata, never project JSON.
            candidate.IgnoredOptionalCanebSections = source.IgnoredOptionalCanebSections;
            candidate.Warnings = source.Warnings;
            return candidate;
        }

        private RuntimeData(Json doc, RuntimeLoadOptions options)
        {
            Document = doc;
            AllowUnverifiedFeatures = options.AllowUnverifiedFeatures;
            Validation.Root(doc);
            SkeletonId = doc["skeleton"].S("skeletonId"); Name = doc["skeleton"].S("name"); ReferenceScale = doc["skeleton"].F("referenceScale");
            RequiredFeatures = Array.AsReadOnly(doc["requiredFeatures"].Strings());
            DecodedTextureDimensions[]? decoded = options.DecodedTextures == null ? null : CopyDecodedTextureFacts(options.DecodedTextures, "loadJson");
            var directSizes = new Dictionary<string, DecodedTextureDimensions>(StringComparer.Ordinal);
            if (options.InheritedDirectSizes != null) foreach (var fact in options.InheritedDirectSizes) directSizes.Add(fact.Key, fact.Value);
            if (decoded != null) foreach (var fact in decoded) if (fact.Kind == TextureResourceKind.Direct) directSizes[fact.ImageId!] = fact;
            var bones = doc["bones"].Items;
            BoneData = new BoneData[bones.Count];
            for (int i = 0; i < bones.Count; ++i)
            {
                Json b = bones[i]; Validation.Bone(b);
                string id = Validation.Id(b, "id"), parentId = b.S("parentId");
                int parent = -1;
                if (parentId.Length != 0 && !BoneIndex.TryGetValue(parentId, out parent)) Validation.Missing("bones.parentId", parentId);
                AddId(BoneIndex, id, i); BoneData[i] = new BoneData(id, parent, b);
            }
            var slots = doc["slots"].Items; SlotData = new SlotData[slots.Count];
            for (int i = 0; i < slots.Count; ++i)
            {
                var s = slots[i]; Validation.Slot(s); string id = Validation.Id(s, "id");
                if (!BoneIndex.TryGetValue(s.S("boneId"), out int bone)) Validation.Missing("slots.boneId", s.S("boneId"));
                AddId(SlotIndex, id, i); SlotData[i] = new SlotData(id, bone, s);
            }
            var atlases = new Dictionary<string, Json>(StringComparer.Ordinal);
            var atlasIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (Json a in doc["atlases"].Items)
            {
                Validation.Closed(a, "atlasId path", "atlasId path"); Validation.Path(a.S("path"));
                var id = Validation.Id(a, "atlasId");
                if (!atlasIds.Add(id)) Validation.Fail("Duplicate atlas ID.");
                if (!options.AtlasJson.TryGetValue(id, out var source)) continue;
                Json atlas = Json.Parse(source); Validation.Atlas(atlas);
                AtlasSources.Add(id, source);
                if (atlas.S("atlasId") != id) Validation.Fail("Atlas ID does not match its reference.");
                if (atlases.ContainsKey(id)) Validation.Fail("Duplicate atlas ID."); atlases.Add(id, atlas); AtlasDocuments.Add(id, atlas);
            }
            var imageRows = new Dictionary<string, Json>(StringComparer.Ordinal);
            foreach (var image in doc["images"].Items)
            {
                Validation.Image(image); string id = Validation.Id(image, "imageId");
                if (!image["atlasId"].IsNull && !atlasIds.Contains(image.S("atlasId"))) Validation.Missing("images.atlasId", image.S("atlasId"));
                if (imageRows.ContainsKey(id)) Validation.Fail("Duplicate image ID.");
                imageRows.Add(id, image);
            }
            foreach (var atlas in atlases)
                foreach (Json region in atlas.Value["regions"].Items)
                {
                    string imageId = region.S("imageId");
                    if (!imageRows.TryGetValue(imageId, out Json? image)) Validation.Missing("atlas.regions.imageId", imageId);
                    if (image!.S("atlasId") != atlas.Key) Validation.Fail("Atlas region image belongs to another resource source.");
                }
            var attachments = doc["attachments"].Items; AttachmentData = new AttachmentData[attachments.Count];
            for (int i = 0; i < attachments.Count; ++i)
            {
                var a = attachments[i]; Validation.Attachment(a, BoneIndex, i);
                var id = Validation.Id(a, "id");
                if (!SlotIndex.TryGetValue(a.S("slotId"), out int slot)) Validation.Missing("attachments.slotId", a.S("slotId"));
                AddId(AttachmentIndex, id, i); AttachmentData[i] = new AttachmentData(id, slot, a, BoneIndex);
                if ((a.S("type") == "region" || a.S("type") == "mesh") && !imageRows.ContainsKey(a.S("imageId"))) Validation.Missing("attachments.imageId", a.S("imageId"));
                foreach (Json imageId in a["sequence"]["imageIds"].ArrayOrEmpty) if (!imageRows.ContainsKey(imageId.String)) Validation.Missing("sequence.imageIds", imageId.String);
            }
            foreach (var a in AttachmentData)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal); var current = a;
                while (!current.Raw["link"].IsNull)
                {
                    if (!seen.Add(current.Id)) Validation.Fail("Linked mesh cycle.");
                    string parentId = current.Raw["link"].S("parentMeshId");
                    if (!AttachmentIndex.TryGetValue(parentId, out int parent)) Validation.Missing("link.parentMeshId", parentId);
                    current = AttachmentData[parent]; if (current.Kind != "mesh") Validation.Fail("Linked parent must be a mesh.");
                }
                a.GeometrySource = current;
                current = a;
                while (!current.Raw["link"].IsNull && current.Raw["link"].B("inheritDeform", true)) current = AttachmentData[AttachmentIndex[current.Raw["link"].S("parentMeshId")]];
                a.DeformSourceId = current.Id;
            }
            var skins = new List<string>();
            foreach (Json skin in doc["skins"].Items)
            {
                Validation.Closed(skin, "id name attachments boneIds constraintIds export", "id name attachments boneIds constraintIds export");
                string id = Validation.Id(skin, "id"); if (SkinDocuments.ContainsKey(id)) Validation.Fail("Duplicate skin ID.");
                foreach (Json a in skin["attachments"].Items)
                {
                    Validation.Closed(a, "slotId attachmentId name", "slotId attachmentId name");
                    if (!SlotIndex.TryGetValue(a.S("slotId"), out int slot)) Validation.Missing("skins.slotId", a.S("slotId"));
                    if (!a["attachmentId"].IsNull && (!AttachmentIndex.TryGetValue(a.S("attachmentId"), out int attachment) || AttachmentData[attachment].Slot != slot)) Validation.Fail("Skin attachment must belong to its slot.");
                }
                foreach (var bone in skin["boneIds"].Strings()) if (!BoneIndex.ContainsKey(bone)) Validation.Missing("skins.boneIds", bone);
                skins.Add(id); SkinDocuments.Add(id, skin); CompileSkin(id, skin);
            }
            SkinIds = skins.AsReadOnly();
            foreach (Json e in doc["events"].Items)
            {
                Validation.Closed(e, "id name integerValue stringValue numberValue audioId volume balance", "id name integerValue stringValue numberValue audioId");
                if (!e["integerValue"].IsNull) Validation.SignedInteger(e["integerValue"], "events.integerValue");
                string id = Validation.Id(e, "id"); if (EventDocuments.ContainsKey(id)) Validation.Fail("Duplicate event ID."); EventDocuments.Add(id, e);
            }
            Constraints = doc["constraints"].Items.ToArray();
            foreach (Json constraint in Constraints) Validation.Constraint(constraint, this);
            var animations = new List<AnimationInfo>();
            foreach (Json a in doc["animations"].Items)
            {
                Validation.Animation(a, this);
                string id = Validation.Id(a, "id"); if (AnimationDocuments.ContainsKey(id)) Validation.Fail("Duplicate animation ID.");
                AnimationDocuments.Add(id, a); animations.Add(new AnimationInfo(id, a.S("name"), a.F("duration"), a.F("fps")));
            }
            Animations = animations.AsReadOnly();
            foreach (var atlasId in atlasIds) if (!atlases.ContainsKey(atlasId)) throw new RuntimeException(RuntimeErrorCode.MissingResource, "attachAtlas", "Atlas JSON is required.", entityId: atlasId);
            foreach (var row in imageRows)
            {
                directSizes.TryGetValue(row.Key, out DecodedTextureDimensions? size);
                bool direct = row.Value["atlasId"].IsNull;
                var image = new ImageData(row.Value, direct ? null : atlases[row.Value.S("atlasId")], direct ? size : null); Images.Add(row.Key, image);
                if (direct) DirectImageSizes.Add(row.Key, DecodedTextureDimensions.Direct(row.Key, image.Width, image.Height));
            }
            if (decoded != null) ValidateDecodedTextureFacts(decoded, "loadJson");
            foreach (var animation in AnimationDocuments) Clips.Add(animation.Key, new Animation.Clip(this, animation.Value));
            FeatureUsage.ValidateDeclared(doc);
        }

        private static void AddId(Dictionary<string, int> index, string id, int i)
        { if (index.ContainsKey(id)) Validation.Fail("Duplicate ID: " + id); index.Add(id, i); }
    }

    internal sealed class BoneData
    {
        internal readonly string Id, TransformMode;
        internal readonly int Parent;
        internal readonly float Length;
        internal readonly BoneLocal Setup;
        internal BoneData(string id, int parent, Json b)
        { Id = id; Parent = parent; Length = b.F("length"); TransformMode = b.S("transformMode"); Setup = Local(b); }
        internal static BoneLocal Local(Json b) => new BoneLocal(b.F("x"), b.F("y"), b.F("rotation"), b.F("scaleX", 1), b.F("scaleY", 1), b.F("shearX"), b.F("shearY"));
    }
    internal sealed class SlotData
    {
        internal readonly string Id, Blend;
        internal readonly string? Attachment;
        internal readonly int Bone;
        internal readonly long ZIndex;
        internal readonly Rgb Color;
        internal readonly Rgb? Dark;
        internal readonly float Alpha;
        internal SlotData(string id, int bone, Json s)
        { Id = id; Bone = bone; ZIndex = s.L("zIndex"); Blend = s.S("blendMode"); Attachment = s["attachmentId"].StringOrNull;
          Color = Rgb.Parse(s.S("color", "#ffffff")); Dark = s["darkColor"].IsNull ? (Rgb?)null : Rgb.Parse(s.S("darkColor")); Alpha = s.F("alpha", 1); }
    }
    internal sealed class AttachmentData
    {
        internal readonly struct Influence
        {
            internal readonly int Bone;
            internal readonly float Weight, X, Y;
            internal Influence(int bone, float weight, Point local) { Bone = bone; Weight = weight; X = local.X; Y = local.Y; }
        }
        internal readonly string Id, Kind;
        internal readonly int Slot;
        internal readonly Json Raw;
        internal readonly Rgb Color;
        internal readonly float Alpha;
        internal readonly float[] Vertices, Uvs;
        internal readonly int[] Indices;
        internal readonly int[] InfluenceStarts;
        internal readonly Influence[] Influences;
        internal readonly BoneLocal Setup;
        internal AttachmentData GeometrySource;
        internal string DeformSourceId;
        internal AttachmentData(string id, int slot, Json a, IReadOnlyDictionary<string, int> bones)
        {
            Id = id; Slot = slot; Kind = a.S("type"); Raw = a; Color = Rgb.Parse(a.S("color", "#ffffff")); Alpha = a.F("alpha", 1); Setup = BoneData.Local(a);
            Vertices = a["vertices"].Floats(); Uvs = a["uvs"].Floats(); var source = a["indices"].ArrayOrEmpty; Indices = new int[source.Count];
            for (int i = 0; i < source.Count; ++i) Indices[i] = source[i].Integer;
            var weights = a["weights"].ArrayOrEmpty;
            if (weights.Count == 0) { InfluenceStarts = Array.Empty<int>(); Influences = Array.Empty<Influence>(); }
            else
            {
                InfluenceStarts = new int[weights.Count + 1]; int count = 0;
                for (int i = 0; i < weights.Count; i++) { InfluenceStarts[i] = count; count += weights[i].Items.Count; }
                InfluenceStarts[weights.Count] = count; Influences = new Influence[count]; int cursor = 0;
                for (int vertex = 0; vertex < weights.Count; vertex++)
                    foreach (Json influence in weights[vertex].Items)
                    {
                        float weight = influence.F("weight");
                        // Zero weights still occupy deform offsets, but do not read a bone or bind position during evaluation.
                        if (weight == 0) { Influences[cursor++] = default; continue; }
                        string bone = influence.S("boneId");
                        Point local = influence["x"].IsNull
                            ? Animation.Sampling.ReadAffine(a["bindInverses"][bone]).Transform(Vertices[vertex * 2], Vertices[vertex * 2 + 1])
                            : new Point(influence.F("x"), influence.F("y"));
                        Influences[cursor++] = new Influence(bones[bone], weight, local);
                    }
            }
            GeometrySource = this; DeformSourceId = Id;
        }
    }
    internal sealed class ImageData
    {
        internal readonly TextureDescriptor Texture;
        internal readonly Json? Region;
        internal readonly Geometry.AtlasProjection? Atlas;
        internal readonly int Width, Height;
        internal ImageData(Json image, Json? atlas, DecodedTextureDimensions? decoded = null)
        {
            string id = image.S("imageId");
            if (atlas == null)
            {
                if (decoded != null && ((!image["width"].IsNull && image.I("width") != decoded.Width) || (!image["height"].IsNull && image.I("height") != decoded.Height)))
                    throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "loadJson", "Decoded direct-image dimensions differ from the resource declaration.", "images", id);
                Width = image["width"].IsNull ? decoded?.Width ?? 0 : image.I("width"); Height = image["height"].IsNull ? decoded?.Height ?? 0 : image.I("height");
                if (Width <= 0 || Height <= 0) throw new RuntimeException(RuntimeErrorCode.MissingResource, "loadJson", "Direct images require decoded width and height.", "images", id);
                Texture = new TextureDescriptor(id, image.S("path"), Width, Height); return;
            }
            foreach (var r in atlas["regions"].Items) if (r.S("imageId") == id) { if (Region != null) Validation.Fail("Duplicate atlas region for image."); Region = r; }
            if (Region == null) throw new RuntimeException(RuntimeErrorCode.MissingResource, "loadJson", "Atlas region is missing.", "images", id);
            Atlas = new Geometry.AtlasProjection(Region);
            Width = Region.I("sourceWidth"); Height = Region.I("sourceHeight");
            if ((!image["width"].IsNull && image.I("width") != Width) || (!image["height"].IsNull && image.I("height") != Height)) throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "attachAtlas", "Atlas source dimensions mismatch.", "images." + id, id);
            Json? page = null;
            foreach (var p in atlas["pages"].Items) if (p.S("pageId") == Region.S("pageId")) page = p;
            if (page == null) throw new RuntimeException(RuntimeErrorCode.MissingReference, "loadJson", "Atlas page is missing.");
            Texture = new TextureDescriptor(id, page.S("image"), page.I("width"), page.I("height"), atlas.S("atlasId"),
                page.S("pageId"), Region.S("regionId"), atlas.S("colorSpace"), atlas.S("alphaMode"));
        }
    }
}
