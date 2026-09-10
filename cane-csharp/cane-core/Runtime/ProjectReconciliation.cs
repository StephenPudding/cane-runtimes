using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane
{
    /// <summary>Owned, read-only candidate data for synchronous host preparation before project commit.</summary>
    public sealed class RuntimeProjectPreview
    {
        public RuntimeData SourceData { get; }
        public RuntimeData Data { get; }
        public RuntimeFrame Frame { get; }
        public RuntimeResourceSnapshot Resources { get; }
        public IReadOnlyList<SlotState> SlotStates { get; }
        internal RuntimeProjectPreview(RuntimePlayer candidate)
        {
            SourceData = candidate.SourceData; Data = candidate.Data; Frame = candidate.Frame;
            Resources = candidate.QueryRuntimeResources(); SlotStates = candidate.QuerySlotStates();
        }
    }

    public sealed partial class RuntimePlayer
    {
        /// <summary>Atomically rebinds compatible live state to new immutable input and publishes one complete frame.</summary>
        public RuntimeFrame ReplaceProject(RuntimeData replacement) => ReplaceProject(replacement, null);

        /// <summary>Prepares host resources before commit. Throw to reject; the original player remains readable but cannot mutate.</summary>
        public RuntimeFrame ReplaceProject(RuntimeData replacement, Action<RuntimeProjectPreview>? validate)
        {
            const string operation = "replaceProject";
            RequireIdle(operation);
            if (replacement == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Replacement data is required.", "data");
            try
            {
                ulong sequence = NextSequence(operation);
                ResourceOverlay overlay = resources.Copy();
                RuntimeData effective = overlay.Compose(replacement);
                HostState configuration = ReconcileProjectHost(effective);
                configuration.Geometry.Validate(effective, operation);
                Playback live = ReconcilePlayback(playback, effective), origin = ReconcilePlayback(baseline, effective);
                ReconcilePhysics(live, effective); ReconcilePhysics(origin, effective);
                RuntimePlayer candidate;
                callbackActive = true;
                try
                {
                    candidate = new RuntimePlayer(effective, replacement, live, origin, configuration, overlay, sequence);
                    if (validate != null)
                    {
                        try { validate(new RuntimeProjectPreview(candidate)); }
                        catch (RuntimeException) { throw; }
                        catch (OutOfMemoryException) { throw new RuntimeException(RuntimeErrorCode.ResourceLimit, operation, "Project validation allocation failed."); }
                        catch (Exception e) { throw new RuntimeException(RuntimeErrorCode.Internal, operation, "Project validation callback failed: " + e.Message); }
                    }
                }
                finally { callbackActive = false; }
                // No intermediate setup frame, callback or partially rebound state escapes before this commit.
                data = candidate.data; sourceData = replacement; resources = overlay;
                host = candidate.host; playback = candidate.playback; baseline = candidate.baseline;
                AdoptEvaluation(candidate);
                // Pending events are owned occurrences which already happened, independent of the replacement catalog.
                return Frame;
            }
            catch (RuntimeException e) { throw Reframe(e, operation); }
        }

        public RuntimeFrame ReconcileProject(RuntimeData replacement) => ReplaceProject(replacement);
        public RuntimeFrame ReconcileProject(RuntimeData replacement, Action<RuntimeProjectPreview>? validate) => ReplaceProject(replacement, validate);

        private static Playback ReconcilePlayback(Playback previous, RuntimeData next)
        {
            Playback result = previous.Clone();
            foreach (var pair in previous.Mixes)
                if (!next.Clips.ContainsKey(pair.Key.Item1) || !next.Clips.ContainsKey(pair.Key.Item2)) result.Mixes.Remove(pair.Key);
            foreach (var pair in previous.Tracks)
            {
                Track track = result.Tracks[pair.Key];
                Entry? current = Bind(track.Current);
                if (current == null) { result.Tracks.Remove(pair.Key); continue; }
                track.Current = current;
                for (int i = track.Queue.Count - 1; i >= 0; i--)
                { Entry? queued = Bind(track.Queue[i]); if (queued == null) track.Queue.RemoveAt(i); else track.Queue[i] = queued; }
            }
            return result;

            Entry? Bind(Entry entry)
            {
                if (entry.Clip != null)
                {
                    if (!next.Clips.TryGetValue(entry.Clip.Id, out Clip? clip)) return null;
                    bool fullRange = entry.Start == 0 && entry.End == entry.Clip.Duration;
                    entry.Clip = clip;
                    if (fullRange) { entry.Start = 0; entry.End = clip.Duration; }
                    else { entry.Start = Math.Min(entry.Start, clip.Duration); entry.End = Math.Min(entry.End, clip.Duration); }
                    // Keep elapsed track time, loop count, mix progress, event cursor and stable entry identity.
                }
                if (entry.From != null) entry.From = Bind(entry.From);
                return entry;
            }
        }

        private void ReconcilePhysics(Playback state, RuntimeData next)
        {
            var compatible = new HashSet<string>(StringComparer.Ordinal);
            foreach (Json before in data.Constraints)
            {
                if (before.S("type") != "physics") continue;
                string id = before.S("id");
                foreach (Json after in next.Constraints)
                    if (after.S("id") == id && after.S("type") == "physics" && before.S("boneId") == after.S("boneId")) { compatible.Add(id); break; }
            }
            var remove = new List<string>();
            foreach (string id in state.Physics.States.Keys) if (!compatible.Contains(id)) remove.Add(id);
            foreach (string id in remove) state.Physics.States.Remove(id);
        }

        private HostState ReconcileProjectHost(RuntimeData next)
        {
            var result = new HostState { Root = host.Root, RootLocal = host.RootLocal, Environment = host.Environment, Geometry = host.Geometry.Copy() };
            var skins = new List<string>(); foreach (string id in host.Skins) if (next.SkinDocuments.ContainsKey(id)) skins.Add(id);
            result.Skins = skins.ToArray();
            foreach (var bone in host.Bones)
                if (next.BoneIndex.TryGetValue(data.BoneData[bone.Key].Id, out int index)) result.Bones.Add(index, bone.Value);
            foreach (var region in host.Regions)
                if (next.AttachmentIndex.TryGetValue(data.AttachmentData[region.Key].Id, out int index) && next.AttachmentData[index].Kind == "region") result.Regions.Add(index, region.Value);
            if (host.Order != null && host.Order.Length == next.SlotData.Length)
            {
                var order = new int[host.Order.Length]; bool compatible = true;
                for (int i = 0; i < order.Length; i++) if (!next.SlotIndex.TryGetValue(data.SlotData[host.Order[i]].Id, out order[i])) { compatible = false; break; }
                if (compatible) result.Order = order;
            }
            foreach (var attachment in host.Attachments)
                if (next.SlotIndex.TryGetValue(data.SlotData[attachment.Key].Id, out int index) &&
                    (attachment.Value == null || next.AttachmentIndex.TryGetValue(attachment.Value, out int at) && next.AttachmentData[at].Slot == index)) result.Attachments.Add(index, attachment.Value);
            foreach (var tint in host.Tints)
                if (next.SlotIndex.TryGetValue(data.SlotData[tint.Key].Id, out int index)) result.Tints.Add(index, tint.Value);
            foreach (var deform in host.Deforms)
                if (CompatibleDeform(data, next, deform.Key, deform.Value)) result.Deforms.Add(deform.Key, (float[])deform.Value.Clone());
            foreach (var constraint in host.Constraints)
            {
                Json before = data.Constraints[constraint.Key]; string id = before.S("id");
                int index = Array.FindIndex(next.Constraints, c => c.S("id") == id && c.S("type") == before.S("type"));
                if (index < 0) continue;
                Json merged = Pose.Clone(next.Constraints[index]);
                foreach (var field in constraint.Value.Members) merged.Members[field.Key] = Pose.Clone(field.Value);
                try { Validation.Constraint(merged, next); }
                catch (RuntimeException e) when (e.Code == RuntimeErrorCode.ValidationFailed || e.Code == RuntimeErrorCode.MissingReference || e.Code == RuntimeErrorCode.NotFound) { continue; }
                result.Constraints.Add(index, Pose.Clone(constraint.Value));
            }
            return result;
        }

        private static bool CompatibleDeform(RuntimeData previous, RuntimeData next, string id, float[] values)
        {
            if (!previous.AttachmentIndex.TryGetValue(id, out int beforeIndex) || !next.AttachmentIndex.TryGetValue(id, out int afterIndex)) return false;
            AttachmentData before = previous.AttachmentData[beforeIndex], after = next.AttachmentData[afterIndex];
            if (before.Kind != after.Kind || after.Kind == "region" || after.Kind == "point" || after.DeformSourceId != id) return false;
            AttachmentData from = before.GeometrySource, to = after.GeometrySource;
            if (from.Vertices.Length != to.Vertices.Length) return false;
            var oldWeights = from.Raw["weights"].ArrayOrEmpty; var newWeights = to.Raw["weights"].ArrayOrEmpty;
            if (oldWeights.Count != newWeights.Count) return false;
            if (newWeights.Count == 0) return values.Length == to.Vertices.Length;
            int count = 0;
            for (int i = 0; i < newWeights.Count; i++)
            {
                if (oldWeights[i].Items.Count != newWeights[i].Items.Count) return false;
                for (int j = 0; j < newWeights[i].Items.Count; j++)
                    if (oldWeights[i][j].S("boneId") != newWeights[i][j].S("boneId")) return false;
                count += newWeights[i].Items.Count * 2;
            }
            return values.Length == count;
        }
    }
}
