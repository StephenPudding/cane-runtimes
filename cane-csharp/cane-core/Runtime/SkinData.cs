using System;
using System.Collections.Generic;
using Cane.Format;

namespace Cane
{
    public sealed partial class RuntimeData
    {
        internal readonly Dictionary<string, SkinMapping[]> SkinMappings = new Dictionary<string, SkinMapping[]>(StringComparer.Ordinal);
        internal readonly Dictionary<string, HashSet<string>> SkinBoneOwners = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        internal readonly Dictionary<string, HashSet<string>> SkinConstraintOwners = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        private void CompileSkin(string id, Json skin)
        {
            var rows = skin["attachments"].Items; var mappings = new SkinMapping[rows.Count];
            for (int i = 0; i < rows.Count; i++)
            {
                Json row = rows[i];
                mappings[i] = new SkinMapping(SlotIndex[row.S("slotId")], row["name"].StringOrNull,
                    row["attachmentId"].IsNull ? -1 : AttachmentIndex[row.S("attachmentId")]);
            }
            SkinMappings.Add(id, mappings);
            AddOwners(SkinBoneOwners, skin["boneIds"], id);
            AddOwners(SkinConstraintOwners, skin["constraintIds"], id);
        }

        private static void AddOwners(Dictionary<string, HashSet<string>> owners, Json members, string skinId)
        {
            foreach (Json member in members.Items)
            {
                if (!owners.TryGetValue(member.String, out HashSet<string>? skins))
                    owners.Add(member.String, skins = new HashSet<string>(StringComparer.Ordinal));
                skins.Add(skinId);
            }
        }
    }

    internal readonly struct SkinMapping
    {
        internal readonly int Slot, Attachment;
        internal readonly string? Name;
        internal SkinMapping(int slot, string? name, int attachment) { Slot = slot; Name = name; Attachment = attachment; }
    }
}
