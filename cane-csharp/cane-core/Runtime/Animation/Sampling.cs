using System;
using System.Collections.Generic;
using Cane.Format;

namespace Cane.Animation
{
    internal sealed class Layer
    {
        internal Clip Clip = null!;
        internal float Time, Alpha;
        internal bool Additive, Attachments = true, DrawOrder = true, Stepped;
        internal Func<string, float>? PropertyAlpha;
        internal float Weight(string property) => PropertyAlpha == null ? Alpha : PropertyAlpha(property);
    }

    internal static class Sampling
    {
        private static readonly string[] RegionFields = { "x", "y", "rotation", "scaleX", "scaleY" };
        private static readonly string[] BooleanConstraintFields = { "bendPositive", "compress", "stretch" };
        internal static void Apply(Pose pose, Layer layer)
        {
            var data = pose.Data; var clip = layer.Clip;
            foreach (var t in clip.Bones)
            {
                BoneLocal current = pose.Locals[t.Index], setup = data.BoneData[t.Index].Setup;
                for (int component = 0; component < 7; component++)
                {
                    float? sample = t.Channels[component].Sample(layer.Time, component == 2 || component >= 5, layer.Stepped);
                    if (sample.HasValue) current = current.With(component, KeySampling.Blend(current.Get(component), setup.Get(component), sample.Value,
                        layer.Weight(t.Properties[component]), layer.Additive, component == 2 || component >= 5));
                }
                pose.Locals[t.Index] = current;
                Json inherit = KeySampling.Discrete(t.Inherit, layer.Time);
                if (!inherit.IsNull && layer.Weight(t.InheritProperty) >= 0.5f) pose.Modes[t.Index] = inherit.S("inherit");
            }
            foreach (Json t in clip.Raw["slotTimelines"].Items)
            {
                int index = data.SlotIndex[t.S("slotId")]; var setup = data.SlotData[index]; var slot = pose.Slots[index]; var channels = clip.Channels[t];
                Json attachment = KeySampling.Discrete(t["attachment"], layer.Time);
                if (!attachment.IsNull && layer.Attachments && layer.Weight("slot:" + index + ":attachment") >= 0.5f) slot.Key = attachment["attachmentId"].StringOrNull;
                float? colorAlpha = channels["color_alpha"].Sample(layer.Time, false, layer.Stepped);
                if (colorAlpha.HasValue)
                {
                    slot.Light = BlendRgb(channels, setup.Color, slot.Light, layer, "slot:" + index + ":", false);
                    bool dark = setup.Dark.HasValue || slot.Dark.HasValue;
                    if (!dark) dark = SampledDarkExists(t["color"], layer.Time);
                    if (dark) slot.Dark = BlendRgb(channels, setup.Dark ?? default, slot.Dark ?? default, layer, "slot:" + index + ":", true);
                }
                float? separate = channels["alpha"].Sample(layer.Time, false, layer.Stepped);
                float? alpha = channels["alpha"].HasKeys && colorAlpha.HasValue ? separate ?? setup.Alpha : separate ?? colorAlpha;
                if (alpha.HasValue) slot.Alpha = Numeric.Clamp(KeySampling.Blend(slot.Alpha, setup.Alpha, alpha.Value, layer.Weight("slot:" + index + ":alpha"), layer.Additive), 0, 1);
            }
            foreach (Json t in clip.Raw["attachmentTimelines"].Items)
            {
                int index = data.AttachmentIndex[t.S("attachmentId")]; var a = data.AttachmentData[index]; var channels = clip.Channels[t];
                BoneLocal setup = a.Setup, current = pose.Regions[index];
                string[] fields = RegionFields;
                for (int c = 0; c < 5; c++)
                {
                    float? value = channels[fields[c]].Sample(layer.Time, c == 2, layer.Stepped);
                    if (value.HasValue) current = current.With(c, KeySampling.Blend(current.Get(c), setup.Get(c), value.Value, layer.Weight("attachment:" + index + ":" + fields[c]), layer.Additive, c == 2));
                }
                pose.Regions[index] = current;
                if (t["deform"].ArrayOrEmpty.Count != 0 && channels.TryGetValue("d0", out Channel? deformChannel) && deformChannel.Sample(layer.Time).HasValue)
                {
                    int length = t["deform"][0]["vertices"].Items.Count; var sampled = new float[length];
                    for (int c = 0; c < length; c++) sampled[c] = channels["d" + c].Sample(layer.Time, false, layer.Stepped)!.Value;
                    bool weighted = a.GeometrySource.Raw["weights"].ArrayOrEmpty.Count != 0;
                    if (weighted && t.S("deformSpace", "vertexPositions") == "vertexPositions") sampled = CanonicalDeform(a.GeometrySource, sampled);
                    pose.Deforms.TryGetValue(a.DeformSourceId, out float[]? previous);
                    var values = new float[sampled.Length]; float alpha = layer.Weight("attachment:" + index + ":deform");
                    for (int c = 0; c < values.Length; c++)
                    { float baseValue = weighted ? 0 : a.GeometrySource.Vertices[c]; values[c] = KeySampling.Blend(previous == null ? baseValue : previous[c], baseValue, sampled[c], alpha, layer.Additive); }
                    pose.Deforms[a.DeformSourceId] = values;
                }
                Json sequence = KeySampling.Discrete(t["sequence"], layer.Time);
                if (!sequence.IsNull && layer.Attachments && layer.Weight("attachment:" + index + ":sequence") >= 0.5f)
                {
                    int count = a.Raw["sequence"]["imageIds"].Items.Count, value = sequence.I("index"); string mode = sequence.S("mode"); float delay = sequence.F("delay");
                    if (mode != "hold" && delay > 0)
                    {
                        double steps = Math.Floor(((double)layer.Time - sequence.F("time")) / delay + 0.00001);
                        // Reduce elapsed steps before converting to an index. Sequence playback has no signed-int time limit.
                        int LoopIndex() => (int)((steps % count + value) % count);
                        int Pingpong(bool reverse)
                        {
                            if (count <= 1) return 0;
                            double period = 2.0 * count - 2, offset = reverse ? count - 1 : 0;
                            double phase = (steps % period + value + offset) % period;
                            return (int)(phase < count ? phase : period - phase);
                        }
                        switch (mode)
                        {
                            case "once": value = steps >= count - 1 - value ? count - 1 : value + (int)steps; break;
                            case "loop": value = LoopIndex(); break;
                            case "pingpong": value = Pingpong(false); break;
                            case "onceReverse": value = steps >= count - 1 - value ? 0 : count - 1 - value - (int)steps; break;
                            case "loopReverse": value = count - 1 - LoopIndex(); break;
                            case "pingpongReverse": value = Pingpong(true); break;
                        }
                    }
                    pose.SequenceIndices[index] = Math.Min(Math.Max(value, 0), count - 1);
                }
            }
            foreach (Json t in clip.Raw["constraintTimelines"].Items)
            {
                bool wildcard = t.S("type") == "physics" && t.S("constraintId") == "*";
                for (int index = 0; index < data.Constraints.Length; index++)
                {
                Json current = pose.Constraints[index], setup = data.Constraints[index];
                if (wildcard ? setup.S("type") != "physics" : setup.S("id") != t.S("constraintId")) continue;
                foreach (var channel in clip.Channels[t])
                {
                    if (wildcard && !setup.B(channel.Key + "Global")) continue;
                    float? value = channel.Value.Sample(layer.Time, false, layer.Stepped); if (!value.HasValue) continue;
                    string field = channel.Key; float alpha = layer.Weight("constraint:" + t.S("constraintId") + ":" + field);
                    string targetField = field == "targetX" ? "x" : "y";
                    if (field == "targetX" || field == "targetY") Pose.Set(current["target"], targetField, KeySampling.Blend(current["target"].F(targetField), setup["target"].F(targetField), value.Value, alpha, layer.Additive));
                    else
                    {
                        string outputField = field == "sliderTime" ? "time" : field;
                        float sampled = KeySampling.Blend(ConstraintValue(current, outputField), ConstraintValue(setup, outputField), value.Value, alpha, field == "sliderTime" ? false : layer.Additive);
                        string kind = setup.S("type");
                        if (kind == "physics")
                        {
                            if (field == "mix" || field == "inertia" || field == "damping") sampled = Numeric.Clamp(sampled, 0, 1);
                            if (field == "strength") sampled = Math.Max(0, sampled);
                            if (field == "mass" && sampled <= 0) sampled = float.Epsilon;
                        }
                        else if (kind == "ik") { if (field == "mix") sampled = Numeric.Clamp(sampled, 0, 1); if (field == "softness") sampled = Math.Max(0, sampled); }
                        else if (kind == "path" && field.StartsWith("mix", StringComparison.Ordinal)) sampled = Numeric.Clamp(sampled, 0, 1);
                        Pose.Set(current, outputField, sampled);
                    }
                }
                foreach (var field in BooleanConstraintFields)
                {
                    Json key = KeySampling.Discrete(t["keys"], layer.Time, field);
                    if (!key.IsNull && layer.Weight("constraint:" + t.S("constraintId") + ":" + field) >= 0.5f) current.Members[field] = key[field];
                }
                }
            }
            if (layer.Attachments && layer.Weight("skin") >= 0.5f)
            {
                Json skin = KeySampling.Discrete(clip.Raw["skins"], layer.Time);
                if (!skin.IsNull) pose.Skins = skin["skinId"].IsNull ? Array.Empty<string>() : new[] { skin.S("skinId") };
            }
            if (layer.DrawOrder && layer.Weight("drawOrder") >= 0.5f)
            {
                Json order = KeySampling.Discrete(clip.Raw["drawOrder"], layer.Time);
                if (!order.IsNull)
                { pose.Order = new int[order["slotIds"].Items.Count]; for (int i = 0; i < pose.Order.Length; i++) pose.Order[i] = data.SlotIndex[order["slotIds"][i].String]; pose.OrderSampled = true; }
                foreach (Json folder in clip.Raw["drawOrderFolders"].Items)
                {
                    Json key = KeySampling.Discrete(folder["keys"], layer.Time); if (key.IsNull) continue;
                    var members = new HashSet<string>(folder["slotIds"].Strings()); int ordinal = 0;
                    for (int i = 0; i < pose.Order.Length; i++) if (members.Contains(data.SlotData[pose.Order[i]].Id)) pose.Order[i] = data.SlotIndex[key["slotIds"][ordinal++].String];
                    pose.OrderSampled = true;
                }
            }
        }
        private static bool SampledDarkExists(Json keys, float time)
        {
            IReadOnlyList<Json> rows = keys.ArrayOrEmpty; int low = 0, high = rows.Count;
            while (low < high) { int mid = low + (high - low) / 2; if (rows[mid].F("time") <= time) low = mid + 1; else high = mid; }
            if (low == 0) return false; Json current = rows[low - 1];
            return !current["darkColor"].IsNull || time != current.F("time") && low < rows.Count && !rows[low]["darkColor"].IsNull;
        }
        private static Rgb BlendRgb(Dictionary<string, Channel> channels, Rgb setup, Rgb current, Layer layer, string prefix, bool dark)
        {
            string channelPrefix = dark ? "dark_" : "color_";
            byte Blend(byte cur, byte bas, string field)
            {
                float value = channels[field].Sample(layer.Time, false, layer.Stepped) ?? cur / 255f;
                float blended = KeySampling.Blend(cur / 255f, bas / 255f, value, layer.Weight(prefix + field), layer.Additive);
                return (byte)Math.Floor(Numeric.Clamp(blended, 0, 1) * 255 + 0.5f);
            }
            return new Rgb(Blend(current.R, setup.R, channelPrefix + "r"), Blend(current.G, setup.G, channelPrefix + "g"), Blend(current.B, setup.B, channelPrefix + "b"));
        }
        internal static float ConstraintValue(Json c, string field)
        {
            if (!c[field].IsNull) return c.F(field);
            if (field.StartsWith("mix", StringComparison.Ordinal) || field == "inertia" || field == "damping" || field == "mass" || field == "timeScale") return 1;
            if (field == "strength") return 100; if (field == "fps") return 60; if (field == "limit") return 5000; return 0;
        }
        internal static float[] CanonicalDeform(AttachmentData source, float[] positions)
            => Geometry.Deformation.PositionsToOffsets(source, positions, "apply");
        internal static Affine ReadAffine(Json m) => new Affine(m.F("a"), m.F("b"), m.F("c"), m.F("d"), m.F("tx"), m.F("ty"));
    }
}
