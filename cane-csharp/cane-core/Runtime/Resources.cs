using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane
{
    /// <summary>An independently owned Runtime Format resource value. Serialization never exposes mutable Core storage.</summary>
    public abstract class RuntimeResourceValue
    {
        internal readonly Json Document;
        public string Id { get; }
        internal RuntimeResourceValue(Json document, string id) { Document = Pose.Clone(document); Id = id; }
        public string ToJson() => Document.Encode();
    }
    public sealed class RuntimeImageResource : RuntimeResourceValue
    {
        internal RuntimeImageResource(Json row) : base(row, ResourceValues.Id(row, "imageId")) { Validation.Image(Document); }
        public static RuntimeImageResource FromJson(string json) => new RuntimeImageResource(Json.Parse(json));
        public static RuntimeImageResource Direct(string imageId, string name, string path, int width, int height, string mimeType = "image/png")
            => Create(imageId, name, "path", path, width, height, mimeType);
        public static RuntimeImageResource Atlas(string imageId, string name, string atlasId, int width, int height, string mimeType = "image/png")
            => Create(imageId, name, "atlasId", atlasId, width, height, mimeType);
        private static RuntimeImageResource Create(string id, string name, string sourceKey, string source, int width, int height, string mime)
            => new RuntimeImageResource(new Json(new Dictionary<string, Json> { ["imageId"] = new Json(id), ["name"] = new Json(name), [sourceKey] = new Json(source), ["width"] = new Json((double)width, true), ["height"] = new Json((double)height, true), ["mimeType"] = new Json(mime) }));
    }
    public sealed class RuntimeAtlasResource : RuntimeResourceValue
    {
        internal RuntimeAtlasResource(Json row) : base(row, ResourceValues.Id(row["atlas"], "atlasId"))
        {
            Validation.Closed(Document, "reference atlas", "reference atlas"); Validation.Closed(Document["reference"], "atlasId path", "atlasId path");
            Validation.Path(Document["reference"].S("path")); Validation.Atlas(Document["atlas"]);
            if (Document["reference"].S("atlasId") != Id) throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "createRuntimeAtlas", "Atlas reference and document IDs differ.", "reference.atlasId", Id);
        }
        public static RuntimeAtlasResource FromJson(string referenceJson, string atlasJson) => new RuntimeAtlasResource(new Json(new Dictionary<string, Json> { ["reference"] = Json.Parse(referenceJson), ["atlas"] = Json.Parse(atlasJson) }));
        public string ReferenceJson => Document["reference"].Encode();
        public string AtlasJson => Document["atlas"].Encode();
    }
    public sealed class RuntimeAttachmentResource : RuntimeResourceValue
    {
        public string Kind => Document.S("type");
        public string SlotId => Document.S("slotId");
        internal RuntimeAttachmentResource(Json row) : base(row, ResourceValues.Id(row, "id"))
        {
            ResourceValues.Id(Document, "slotId");
            // Detached values validate shape now; catalog references are checked by the complete transaction.
            var bones = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (Json weightRow in Document["weights"].ArrayOrEmpty) foreach (Json weight in weightRow.Items) bones[weight.S("boneId")] = 0;
            if (!Document["bindInverses"].IsNull) foreach (string id in Document["bindInverses"].Members.Keys) bones[id] = 0;
            Validation.FiniteTree(Document); Validation.Attachment(Document, bones);
        }
        public static RuntimeAttachmentResource FromJson(string json) => new RuntimeAttachmentResource(Json.Parse(json));
        public RuntimeAttachmentResource Copy(string? id = null, string? name = null, string? slotId = null)
        {
            Json copy = Pose.Clone(Document); if (id != null) copy.Members["id"] = new Json(id); if (name != null) copy.Members["name"] = new Json(name); if (slotId != null) copy.Members["slotId"] = new Json(slotId);
            return new RuntimeAttachmentResource(copy);
        }
    }
    /// <summary>Creates every Runtime Format v1 attachment kind from its renderer-neutral property document.</summary>
    public static class RuntimeAttachmentFactory
    {
        public static RuntimeAttachmentResource Region(string propertiesJson) => Create("region", propertiesJson);
        public static RuntimeAttachmentResource Mesh(string propertiesJson) => Create("mesh", propertiesJson);
        public static RuntimeAttachmentResource Path(string propertiesJson) => Create("path", propertiesJson);
        public static RuntimeAttachmentResource Point(string propertiesJson) => Create("point", propertiesJson);
        public static RuntimeAttachmentResource BoundingBox(string propertiesJson) => Create("boundingbox", propertiesJson);
        public static RuntimeAttachmentResource Clipping(string propertiesJson) => Create("clipping", propertiesJson);
        private static RuntimeAttachmentResource Create(string type, string json)
        { Json row = Json.Parse(json); row.Members["type"] = new Json(type); return new RuntimeAttachmentResource(row); }
    }
    public sealed class RuntimeSkinResource : RuntimeResourceValue
    {
        public string Name => Document.S("name");
        internal RuntimeSkinResource(Json row) : base(row, ResourceValues.Id(row, "id"))
        {
            Validation.Closed(Document, "id name attachments boneIds constraintIds export", "id name attachments boneIds constraintIds export"); ResourceValues.Id(Document, "name"); _ = Document["export"].Bool;
            var mappings = new HashSet<(string, string?)>();
            foreach (Json mapping in Document["attachments"].Items)
            {
                Validation.Closed(mapping, "slotId name attachmentId", "slotId name attachmentId"); string slot = ResourceValues.Id(mapping, "slotId");
                if (!mapping["attachmentId"].IsNull) ResourceValues.Id(mapping, "attachmentId"); if (!mapping["name"].IsNull) ResourceValues.Id(mapping, "name");
                if (!mappings.Add((slot, mapping["name"].StringOrNull))) Validation.Fail("Duplicate Skin mapping.");
            }
            ResourceValues.UniqueIds(Document["boneIds"]); ResourceValues.UniqueIds(Document["constraintIds"]);
        }
        public static RuntimeSkinResource FromJson(string json) => new RuntimeSkinResource(Json.Parse(json));
    }
    internal static class ResourceValues
    {
        internal static string Id(Json row, string key) => CheckId(row.S(key), key);
        internal static string CheckId(string id, string field)
        { if (string.IsNullOrEmpty(id) || id.IndexOf('\0') >= 0) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "runtimeResource", "Resource ID/name must be non-empty and NUL-free.", field); return id; }
        internal static void UniqueIds(Json array)
        { var ids = new HashSet<string>(StringComparer.Ordinal); foreach (Json item in array.Items) if (!ids.Add(CheckId(item.String, "ids"))) Validation.Fail("Duplicate resource member ID."); }
    }
    public sealed class RuntimeResourceChanges
    {
        internal readonly List<(int Catalog, string Id, Json? Value)> Operations = new List<(int, string, Json?)>();
        public int Count => Operations.Count;
        public RuntimeResourceChanges UpsertImage(RuntimeImageResource image) => Upsert(0, image);
        public RuntimeResourceChanges UpsertAtlas(RuntimeAtlasResource atlas) => Upsert(1, atlas);
        public RuntimeResourceChanges UpsertAttachment(RuntimeAttachmentResource attachment) => Upsert(2, attachment);
        public RuntimeResourceChanges UpsertSkin(RuntimeSkinResource skin) => Upsert(3, skin);
        public RuntimeResourceChanges UpsertSkin(RuntimeSkinBuilder skin) => UpsertSkin(skin.Snapshot());
        public RuntimeResourceChanges RemoveImage(string imageId) => Remove(0, imageId);
        public RuntimeResourceChanges RemoveAtlas(string atlasId) => Remove(1, atlasId);
        public RuntimeResourceChanges RemoveAttachment(string attachmentId) => Remove(2, attachmentId);
        public RuntimeResourceChanges RemoveSkin(string skinId) => Remove(3, skinId);
        public void Clear() => Operations.Clear();
        private RuntimeResourceChanges Upsert(int catalog, RuntimeResourceValue value)
        { if (value == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "runtimeResource", "Resource value is required."); Operations.Add((catalog, value.Id, Pose.Clone(value.Document))); return this; }
        private RuntimeResourceChanges Remove(int catalog, string id)
        { Operations.Add((catalog, ResourceValues.CheckId(id, "id"), null)); return this; }
        internal static RuntimeResourceChanges FromDocument(Json changes)
        {
            Validation.Closed(changes, "operations", "operations"); var result = new RuntimeResourceChanges();
            foreach (Json operation in changes["operations"].Items)
            {
                switch (operation.S("operation"))
                {
                    case "upsertImage": Validation.Closed(operation, "operation image", "operation image"); result.UpsertImage(new RuntimeImageResource(operation["image"])); break;
                    case "upsertAtlas": Validation.Closed(operation, "operation resource", "operation resource"); result.UpsertAtlas(new RuntimeAtlasResource(operation["resource"])); break;
                    case "upsertAttachment": Validation.Closed(operation, "operation attachment", "operation attachment"); result.UpsertAttachment(new RuntimeAttachmentResource(operation["attachment"])); break;
                    case "upsertSkin": Validation.Closed(operation, "operation skin", "operation skin"); result.UpsertSkin(new RuntimeSkinResource(operation["skin"])); break;
                    case "removeImage": Validation.Closed(operation, "operation imageId", "operation imageId"); result.RemoveImage(operation.S("imageId")); break;
                    case "removeAtlas": Validation.Closed(operation, "operation atlasId", "operation atlasId"); result.RemoveAtlas(operation.S("atlasId")); break;
                    case "removeAttachment": Validation.Closed(operation, "operation attachmentId", "operation attachmentId"); result.RemoveAttachment(operation.S("attachmentId")); break;
                    case "removeSkin": Validation.Closed(operation, "operation skinId", "operation skinId"); result.RemoveSkin(operation.S("skinId")); break;
                    default: throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "applyRuntimeResources", "Unknown resource operation.", "operation");
                }
            }
            return result;
        }
    }
    public sealed class RuntimeResourceSnapshot
    {
        public IReadOnlyList<RuntimeImageResource> Images { get; }
        public IReadOnlyList<RuntimeAtlasResource> Atlases { get; }
        public IReadOnlyList<RuntimeAttachmentResource> Attachments { get; }
        public IReadOnlyList<RuntimeSkinResource> Skins { get; }
        internal RuntimeResourceSnapshot(ResourceOverlay resources)
        {
            Images = resources.Catalogs[0].Snapshot(j => new RuntimeImageResource(j)); Atlases = resources.Catalogs[1].Snapshot(j => new RuntimeAtlasResource(j));
            Attachments = resources.Catalogs[2].Snapshot(j => new RuntimeAttachmentResource(j)); Skins = resources.Catalogs[3].Snapshot(j => new RuntimeSkinResource(j));
        }
    }
}
