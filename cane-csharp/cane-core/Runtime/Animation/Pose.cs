using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using Cane.Format;

namespace Cane.Animation
{
    internal sealed class Pose
    {
        internal readonly RuntimeData Data;
        internal readonly BoneLocal[] Locals, Regions;
        internal readonly string[] Modes;
        internal readonly Affine[] World;
        internal readonly SlotPose[] Slots;
        internal readonly Json[] Constraints;
        internal readonly Dictionary<string, float[]> Deforms = new Dictionary<string, float[]>(StringComparer.Ordinal);
        internal readonly Dictionary<string, ConstraintDiagnostic> Diagnostics = new Dictionary<string, ConstraintDiagnostic>(StringComparer.Ordinal);
        internal readonly Dictionary<string, float> SliderTimes = new Dictionary<string, float>(StringComparer.Ordinal);
        internal readonly HashSet<string> LowerTrackProperties = new HashSet<string>(StringComparer.Ordinal);
        internal readonly int[] SequenceIndices;
        internal string[] Skins;
        internal int[] Order;
        internal bool OrderSampled;
        private readonly int[] setupOrder, orderStorage;
        private readonly Json?[] constraintTargets;
        private struct WorldTransformCache
        {
            internal bool Valid;
            internal BoneLocal Local;
            internal Affine Parent, Axes, Result;
            internal string? Mode;
        }
        private readonly WorldTransformCache[] worldTransforms;
        internal Pose(RuntimeData data, string[] skins)
        {
            Data = data; Skins = skins; Locals = new BoneLocal[data.BoneData.Length]; World = new Affine[Locals.Length]; Modes = new string[Locals.Length];
            worldTransforms = new WorldTransformCache[Locals.Length];
            Slots = new SlotPose[data.SlotData.Length]; Order = orderStorage = new int[Slots.Length];
            for (int i = 0; i < Slots.Length; i++) { Slots[i] = new SlotPose(data.SlotData[i]); Order[i] = i; }
            Array.Sort(Order, (a, b) => { int z = data.SlotData[a].ZIndex.CompareTo(data.SlotData[b].ZIndex); return z == 0 ? a.CompareTo(b) : z; });
            setupOrder = (int[])Order.Clone();
            Regions = new BoneLocal[data.AttachmentData.Length]; SequenceIndices = new int[Regions.Length];
            Constraints = new Json[data.Constraints.Length]; constraintTargets = new Json?[Constraints.Length];
            for (int i = 0; i < Constraints.Length; i++)
            { Constraints[i] = CopyConstraintState(data.Constraints[i]); if (data.Constraints[i]["target"].IsObject) constraintTargets[i] = Constraints[i]["target"]; }
            Reset(skins);
        }
        internal void Reset(string[] skins)
        {
            // Host skin arrays are immutable after installation; sampled skin keys replace this
            // reference. Owned public frame/query arrays are constructed separately.
            Skins = skins; Order = orderStorage; Array.Copy(setupOrder, Order, Order.Length); OrderSampled = false;
            Deforms.Clear(); Diagnostics.Clear(); SliderTimes.Clear();
            for (int i = 0; i < Locals.Length; i++) { Locals[i] = Data.BoneData[i].Setup; Modes[i] = Data.BoneData[i].TransformMode; World[i] = default; }
            for (int i = 0; i < Slots.Length; i++) Slots[i].Reset(Data.SlotData[i]);
            for (int i = 0; i < Regions.Length; i++) { Regions[i] = Data.AttachmentData[i].Setup; SequenceIndices[i] = Data.AttachmentData[i].Raw["sequence"].I("setupIndex"); }
            for (int i = 0; i < Constraints.Length; i++)
            {
                Json setup = Data.Constraints[i], current = Constraints[i]; current.Members.Clear();
                foreach (var member in setup.Members) current.Members.Add(member.Key, member.Value);
                Json? target = constraintTargets[i];
                if (target != null)
                {
                    target.Members.Clear(); foreach (var member in setup["target"].Members) target.Members.Add(member.Key, member.Value);
                    current.Members["target"] = target;
                }
            }
        }
        internal static Json CopyConstraintState(Json constraint)
        {
            // Sampling and overrides replace top-level values. Only the IK target is
            // edited in place; bone lists, mappings and other nested setup data stay read-only.
            // Each pose (including a failed evaluation) owns its writable dictionaries.
            var members = new Dictionary<string, Json>(constraint.Members, StringComparer.Ordinal);
            if (constraint.Has("target")) members["target"] = Clone(constraint["target"]);
            return new Json(members);
        }
        internal static Json Clone(Json j)
        {
            if (j.IsArray) { var a = new List<Json>(j.Items.Count); foreach (var v in j.Items) a.Add(Clone(v)); return new Json(a); }
            if (j.IsObject) { var o = new Dictionary<string, Json>(j.Members.Count, StringComparer.Ordinal); foreach (var p in j.Members) o.Add(p.Key, Clone(p.Value)); return new Json(o); }
            return j;
        }
        internal static void Set(Json j, string key, float value) { j.Members[key] = new Json((double)value); }
        internal void UpdateWorld(Affine root)
        {
            for (int i = 0; i < World.Length; i++)
            {
                int parent = Data.BoneData[i].Parent;
                Affine parentWorld = parent < 0 ? root : World[parent]; BoneLocal local = Locals[i];
                ref WorldTransformCache cached = ref worldTransforms[i];
                bool localChanged = !cached.Valid || !Same(in cached.Local, in local);
                if (localChanged) { cached.Local = local; cached.Axes = Affine.FromLocal(local); }
                if (localChanged || cached.Mode != Modes[i] || !Same(in cached.Parent, in parentWorld))
                {
                    cached.Result = parent < 0 || Modes[i] == "normal" ? parentWorld * cached.Axes : Affine.Child(parentWorld, local, Modes[i]);
                    cached.Parent = parentWorld; cached.Mode = Modes[i]; cached.Valid = true;
                }
                // Always assign the reconstructed result. A constraint may have written a
                // different world matrix since the previous full hierarchy update.
                World[i] = cached.Result;
                if (!World[i].IsFinite) throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Bone world transform overflowed.", "bones", Data.BoneData[i].Id);
            }
        }
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static bool Same(float a, float b) => a == b && (a != 0 || BitConverter.SingleToInt32Bits(a) == BitConverter.SingleToInt32Bits(b));
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static bool Same(in Affine a, in Affine b) => Same(a.A, b.A) && Same(a.B, b.B) && Same(a.C, b.C) && Same(a.D, b.D) && Same(a.Tx, b.Tx) && Same(a.Ty, b.Ty);
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        private static bool Same(in BoneLocal a, in BoneLocal b) => Same(a.RotationDegrees, b.RotationDegrees) && Same(a.X, b.X) && Same(a.Y, b.Y) &&
            Same(a.ShearXDegrees, b.ShearXDegrees) && Same(a.ShearYDegrees, b.ShearYDegrees) && Same(a.ScaleX, b.ScaleX) && Same(a.ScaleY, b.ScaleY);
        internal void ResolveAttachments()
        {
            for (int slot = 0; slot < Slots.Length; slot++)
            {
                var value = Slots[slot]; value.ResolvedAttachment = -1;
                if (value.Key == null) continue;
                if (Data.AttachmentIndex.TryGetValue(value.Key, out int direct) && Data.AttachmentData[direct].Slot == slot) value.ResolvedAttachment = direct;
            }
            // Rows affect only their own Slot and never its key, so preserve row/skin order
            // while visiting each mapping once instead of scanning every skin per Slot.
            if (Skins.Length != 0 && Data.SkinIds.Count != 0 && Array.IndexOf(Skins, Data.SkinIds[0]) < 0) ApplySkinMappings(Data.SkinMappings[Data.SkinIds[0]]);
            foreach (var skinId in Skins) ApplySkinMappings(Data.SkinMappings[skinId]);
        }
        private void ApplySkinMappings(SkinMapping[] mappings)
        {
            foreach (SkinMapping mapping in mappings)
            {
                SlotPose value = Slots[mapping.Slot];
                if (value.Key != null && (mapping.Name == null || mapping.Name == value.Key)) value.ResolvedAttachment = mapping.Attachment;
            }
        }
        internal bool IsActive(string id, string memberField)
        {
            var owners = memberField == "boneIds" ? Data.SkinBoneOwners : Data.SkinConstraintOwners;
            if (!owners.TryGetValue(id, out HashSet<string>? skins)) return true;
            foreach (string skinId in Skins) if (skins.Contains(skinId)) return true;
            return false;
        }
    }
    internal sealed class SlotPose
    {
        internal string? Key;
        internal int ResolvedAttachment = -1;
        internal Rgb Light;
        internal Rgb? Dark;
        internal float Alpha;
        internal SlotPose(SlotData setup) => Reset(setup);
        internal void Reset(SlotData setup) { Key = setup.Attachment; ResolvedAttachment = -1; Light = setup.Color; Dark = setup.Dark; Alpha = setup.Alpha; }
    }

    internal sealed class Clip
    {
        internal readonly Json Raw;
        internal readonly string Id;
        internal readonly float Duration;
        internal readonly List<BoneTimeline> Bones = new List<BoneTimeline>();
        internal readonly Dictionary<Json, Dictionary<string, Channel>> Channels = new Dictionary<Json, Dictionary<string, Channel>>();
        internal readonly HashSet<string> Properties = new HashSet<string>(StringComparer.Ordinal);
        internal Clip(RuntimeData data, Json animation)
        {
            Raw = animation; Id = animation.S("id"); Duration = animation.F("duration");
            foreach (Json timeline in GroupBoneTimelines(animation["boneTimelines"]))
            {
                int index = data.BoneIndex[timeline.S("boneId")]; var channels = new[] {
                    Channel.Merged(timeline["translate"], timeline["translateX"], "x"), Channel.Merged(timeline["translate"], timeline["translateY"], "y"),
                    Channel.From(timeline["rotate"], "angle", "rotation"), Channel.Merged(timeline["scale"], timeline["scaleX"], "x"), Channel.Merged(timeline["scale"], timeline["scaleY"], "y"),
                    Channel.Merged(timeline["shear"], timeline["shearX"], "x"), Channel.Merged(timeline["shear"], timeline["shearY"], "y") };
                var bone = new BoneTimeline(index, channels, timeline["inherit"]); Bones.Add(bone);
                for (int i = 0; i < channels.Length; i++) if (channels[i].HasKeys) Properties.Add(bone.Properties[i]);
                if (timeline["inherit"].ArrayOrEmpty.Count != 0) Properties.Add(bone.InheritProperty);
            }
            foreach (Json t in animation["slotTimelines"].Items)
            {
                var set = new Dictionary<string, Channel>(); Channels.Add(t, set); int index = data.SlotIndex[t.S("slotId")];
                string[] rgb = { "color_r", "color_g", "color_b", "dark_r", "dark_g", "dark_b" };
                for (int i = 0; i < 6; i++)
                {
                    int component = i;
                    set[rgb[i]] = Channel.From(t["color"], "", rgb[i], k => ColorComponent(k, component));
                    if (set[rgb[i]].HasKeys) Properties.Add("slot:" + index + ":" + rgb[i]);
                }
                set["color_alpha"] = Channel.From(t["color"], "alpha", "alpha"); set["alpha"] = Channel.From(t["alpha"], "alpha", "alpha");
                if (set["color_alpha"].HasKeys || set["alpha"].HasKeys) Properties.Add("slot:" + index + ":alpha");
                if (t["attachment"].ArrayOrEmpty.Count != 0) Properties.Add("slot:" + index + ":attachment");
            }
            foreach (Json t in animation["attachmentTimelines"].Items)
            {
                var set = new Dictionary<string, Channel>(); Channels.Add(t, set); int index = data.AttachmentIndex[t.S("attachmentId")];
                string[] fields = { "x", "y", "rotation", "scaleX", "scaleY" }, props = { "x", "y", "rotation", "scale_x", "scale_y" };
                for (int i = 0; i < fields.Length; i++)
                { set[fields[i]] = Channel.From(t["region"], fields[i], props[i]); if (set[fields[i]].HasKeys) Properties.Add("attachment:" + index + ":" + fields[i]); }
                if (t["deform"].ArrayOrEmpty.Count != 0)
                {
                    int length = t["deform"][0]["vertices"].Items.Count;
                    for (int i = 0; i < length; i++) { int component = i; set["d" + i] = Channel.From(t["deform"], "", i % 2 == 0 ? "x" : "y", k => k["vertices"][component].Float); }
                    Properties.Add("attachment:" + index + ":deform");
                }
                if (t["sequence"].ArrayOrEmpty.Count != 0) Properties.Add("attachment:" + index + ":sequence");
            }
            foreach (Json t in animation["constraintTimelines"].Items)
            {
                var set = new Dictionary<string, Channel>(); Channels.Add(t, set);
                foreach (Json k in t["keys"].Items) foreach (var pair in k.Members)
                {
                    if (pair.Key == "time" || pair.Key == "curve") continue;
                    Properties.Add("constraint:" + t.S("constraintId") + ":" + pair.Key);
                    if (pair.Value.IsNumber && !set.ContainsKey(pair.Key)) set.Add(pair.Key, Channel.From(t["keys"], pair.Key, CurveProperty(pair.Key)));
                }
            }
            if (animation["drawOrder"].Items.Count != 0 || animation["drawOrderFolders"].Items.Count != 0) Properties.Add("drawOrder");
            if (animation["skins"].Items.Count != 0) Properties.Add("skin");
        }
        private static IEnumerable<Json> GroupBoneTimelines(Json timelines)
        {
            var groups = new List<Json>(); var byBone = new Dictionary<string, Json>(StringComparer.Ordinal);
            foreach (Json timeline in timelines.Items)
            {
                string id = timeline.S("boneId");
                if (!byBone.TryGetValue(id, out Json? combined))
                {
                    combined = new Json(new Dictionary<string, Json>(StringComparer.Ordinal) { ["boneId"] = timeline["boneId"] });
                    byBone.Add(id, combined); groups.Add(combined);
                }
                foreach (var channel in timeline.Members)
                {
                    if (channel.Key == "boneId" || channel.Value.IsNull) continue;
                    if (combined.Has(channel.Key)) Validation.Fail("Duplicate bone timeline channel.");
                    combined.Members.Add(channel.Key, channel.Value);
                }
            }
            return groups;
        }
        private static float ColorComponent(Json k, int component)
        {
            string key = component < 3 ? "color" : "darkColor"; Rgb rgb = k[key].IsNull ? default : Rgb.Parse(k.S(key));
            return (component % 3 == 0 ? rgb.R : component % 3 == 1 ? rgb.G : rgb.B) / 255f;
        }
        internal static string CurveProperty(string field)
        {
            switch (field)
            { case "targetX": return "target_x"; case "targetY": return "target_y"; case "mixRotate": return "mix_rotate"; case "mixX": return "mix_x"; case "mixY": return "mix_y"; case "mixScaleX": return "mix_scale_x"; case "mixScaleY": return "mix_scale_y"; case "mixShearY": return "mix_shear_y"; case "sliderTime": return "slider_time"; default: return field; }
        }
    }
    internal sealed class BoneTimeline
    {
        internal readonly int Index;
        internal readonly Channel[] Channels;
        internal readonly Json Inherit;
        internal readonly string[] Properties;
        internal readonly string InheritProperty;
        internal BoneTimeline(int index, Channel[] channels, Json inherit)
        {
            Index = index; Channels = channels; Inherit = inherit; Properties = new string[channels.Length];
            for (int i = 0; i < Properties.Length; i++) Properties[i] = "bone:" + index + ":" + i;
            InheritProperty = "bone:" + index + ":inherit";
        }
    }
}
