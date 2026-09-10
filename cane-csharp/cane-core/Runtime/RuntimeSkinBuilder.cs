using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane
{
    /// <summary>Detached mutable Skin. Installation snapshots all mappings and membership.</summary>
    public sealed class RuntimeSkinBuilder : IDisposable
    {
        private readonly List<Json> mappings = new List<Json>();
        private readonly List<string> bones = new List<string>(), constraints = new List<string>();
        private string name;
        private bool export;
        public string Id { get; }
        public bool IsDisposed { get; private set; }
        public RuntimeSkinBuilder(string id, string? name = null, bool export = false)
        { Id = ResourceValues.CheckId(id, "id"); this.name = ResourceValues.CheckId(name ?? id, "name"); this.export = export; }
        public static RuntimeSkinBuilder Copy(RuntimeSkinResource source, string id, string? name = null)
        { if (source == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "copyRuntimeSkin", "Source Skin is required."); return new RuntimeSkinBuilder(id, name ?? source.Name, source.Document.B("export")).Merge(source); }
        public RuntimeSkinBuilder SetName(string value) { Live(); name = ResourceValues.CheckId(value, "name"); return this; }
        public RuntimeSkinBuilder SetExport(bool value) { Live(); export = value; return this; }
        public RuntimeSkinBuilder SetAttachment(string slotId, string? name, string? attachmentId)
        {
            Live(); Key(slotId, name); if (attachmentId != null) ResourceValues.CheckId(attachmentId, "attachmentId");
            var row = new Json(new Dictionary<string, Json> { ["slotId"] = new Json(slotId), ["name"] = new Json(name), ["attachmentId"] = new Json(attachmentId) });
            int i = Index(slotId, name); if (i < 0) mappings.Add(row); else mappings[i] = row; return this;
        }
        public bool TryGetAttachment(string slotId, string? name, out string? attachmentId)
        { Live(); Key(slotId, name); int index = Index(slotId, name); attachmentId = index < 0 ? null : mappings[index]["attachmentId"].StringOrNull; return index >= 0; }
        public bool RemoveAttachment(string slotId, string? name)
        { Live(); Key(slotId, name); int index = Index(slotId, name); if (index < 0) return false; mappings.RemoveAt(index); return true; }
        public RuntimeSkinBuilder AddBone(string boneId) { Live(); Add(bones, boneId); return this; }
        public bool RemoveBone(string boneId) { Live(); return bones.Remove(ResourceValues.CheckId(boneId, "boneId")); }
        public RuntimeSkinBuilder AddConstraint(string constraintId) { Live(); Add(constraints, constraintId); return this; }
        public bool RemoveConstraint(string constraintId) { Live(); return constraints.Remove(ResourceValues.CheckId(constraintId, "constraintId")); }
        public RuntimeSkinBuilder Merge(RuntimeSkinResource source)
        {
            Live(); if (source == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "mergeRuntimeSkin", "Source Skin is required.");
            foreach (Json mapping in source.Document["attachments"].Items) SetAttachment(mapping.S("slotId"), mapping["name"].StringOrNull, mapping["attachmentId"].StringOrNull);
            foreach (string id in source.Document["boneIds"].Strings()) AddBone(id); foreach (string id in source.Document["constraintIds"].Strings()) AddConstraint(id); return this;
        }
        public RuntimeSkinBuilder Clear() { Live(); mappings.Clear(); bones.Clear(); constraints.Clear(); return this; }
        public RuntimeSkinResource Snapshot()
        {
            Live(); var copy = new List<Json>(); foreach (Json row in mappings) copy.Add(Pose.Clone(row));
            return new RuntimeSkinResource(new Json(new Dictionary<string, Json> { ["id"] = new Json(Id), ["name"] = new Json(name), ["export"] = new Json(export),
                ["attachments"] = new Json(copy), ["boneIds"] = Strings(bones), ["constraintIds"] = Strings(constraints) }));
        }
        public void Dispose() { mappings.Clear(); bones.Clear(); constraints.Clear(); IsDisposed = true; }
        private static Json Strings(List<string> values) { var array = new List<Json>(); foreach (string value in values) array.Add(new Json(value)); return new Json(array); }
        private static void Key(string slotId, string? name) { ResourceValues.CheckId(slotId, "slotId"); if (name != null) ResourceValues.CheckId(name, "name"); }
        private int Index(string slot, string? key) => mappings.FindIndex(row => row.S("slotId") == slot && row["name"].StringOrNull == key);
        private static void Add(List<string> list, string id) { ResourceValues.CheckId(id, "id"); if (!list.Contains(id)) list.Add(id); }
        private void Live() { if (IsDisposed) throw new RuntimeException(RuntimeErrorCode.InvalidState, "runtimeSkin", "Skin builder is disposed.", entityId: Id); }
    }
}
