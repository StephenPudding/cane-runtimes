using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane
{
    internal sealed class OrderedResources
    {
        internal readonly List<string> Order = new List<string>();
        internal readonly Dictionary<string, Json> Values = new Dictionary<string, Json>(StringComparer.Ordinal);
        internal void Upsert(string id, Json value) { if (!Values.ContainsKey(id)) Order.Add(id); Values[id] = Pose.Clone(value); }
        internal void Remove(string id) { if (Values.Remove(id)) Order.Remove(id); }
        internal IReadOnlyList<T> Snapshot<T>(Func<Json, T> convert)
        { var result = new T[Order.Count]; for (int i = 0; i < result.Length; i++) result[i] = convert(Values[Order[i]]); return Array.AsReadOnly(result); }
        internal OrderedResources Copy()
        { var result = new OrderedResources(); foreach (string id in Order) result.Upsert(id, Values[id]); return result; }
        internal Json Compose(Json source, string idField, bool atlas = false)
        {
            var result = new List<Json>(); var consumed = new HashSet<string>(StringComparer.Ordinal);
            foreach (Json original in source.Items)
            {
                string id = original.S(idField); consumed.Add(id);
                result.Add(Pose.Clone(Values.TryGetValue(id, out Json? value) ? (atlas ? value["reference"] : value) : original));
            }
            foreach (string id in Order) if (!consumed.Contains(id)) result.Add(Pose.Clone(atlas ? Values[id]["reference"] : Values[id])); return new Json(result);
        }
    }
    internal sealed class ResourceOverlay
    {
        internal readonly OrderedResources[] Catalogs = { new OrderedResources(), new OrderedResources(), new OrderedResources(), new OrderedResources() };
        internal bool Empty { get { foreach (OrderedResources r in Catalogs) if (r.Order.Count != 0) return false; return true; } }
        internal ResourceOverlay Copy()
        { var copy = new ResourceOverlay(); for (int i = 0; i < Catalogs.Length; i++) copy.Catalogs[i] = Catalogs[i].Copy(); return copy; }
        internal ResourceOverlay Stage(RuntimeResourceChanges changes)
        {
            if (changes.Count > 1000000) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "applyRuntimeResources", "Resource transaction exceeds 1,000,000 operations.", "operations");
            ResourceOverlay candidate = Copy();
            foreach (var operation in changes.Operations)
            { if (operation.Value == null) candidate.Catalogs[operation.Catalog].Remove(operation.Id); else candidate.Catalogs[operation.Catalog].Upsert(operation.Id, operation.Value); }
            return candidate;
        }
        internal RuntimeData Compose(RuntimeData source)
        {
            if (Empty) return source; Json document = Pose.Clone(source.Document);
            document.Members["images"] = Catalogs[0].Compose(source.Document["images"], "imageId");
            document.Members["atlases"] = Catalogs[1].Compose(source.Document["atlases"], "atlasId", true);
            document.Members["attachments"] = Catalogs[2].Compose(source.Document["attachments"], "id");
            document.Members["skins"] = Catalogs[3].Compose(source.Document["skins"], "id");
            FeatureUsage.IncludeOverlayRequirements(document);
            var atlases = new Dictionary<string, string>(source.AtlasSources, StringComparer.Ordinal);
            foreach (string id in Catalogs[1].Order) atlases[id] = Catalogs[1].Values[id]["atlas"].Encode();
            var directSizes = new Dictionary<string, DecodedTextureDimensions>(StringComparer.Ordinal);
            foreach (Json image in document["images"].Items)
            {
                string id = image.S("imageId");
                if (!image["atlasId"].IsNull || !source.DirectImageSizes.TryGetValue(id, out DecodedTextureDimensions? size)) continue;
                if (image.S("path") != source.Images[id].Texture.Path) continue;
                if ((!image["width"].IsNull && image.I("width") != size.Width) || (!image["height"].IsNull && image.I("height") != size.Height)) continue;
                directSizes.Add(id, size);
            }
            return RuntimeData.LoadOverlay(document, new RuntimeLoadOptions { AtlasJson = atlases, AllowUnverifiedFeatures = source.AllowUnverifiedFeatures, InheritedDirectSizes = directSizes }, source);
        }
    }
    public sealed partial class RuntimePlayer
    {
        // Resource transactions enter here without evaluating an intermediate setup frame.
        private RuntimePlayer(RuntimeData data, RuntimeData sourceData, Playback state, Playback origin, HostState configuration, ResourceOverlay overlay, ulong sequence)
        {
            this.data = data; this.sourceData = sourceData; playback = state; baseline = origin; host = configuration; resources = overlay;
            Frame = Evaluate(state, configuration, sequence, default, out publishedPose);
        }
        public RuntimeResourceSnapshot QueryRuntimeResources() => new RuntimeResourceSnapshot(resources);
        public RuntimeFrame ApplyRuntimeResources(RuntimeResourceChanges changes) => ApplyRuntimeResources(changes, null);
        /// <summary>Prepares host resources synchronously before committing the candidate. Throw to reject; same-player mutation is forbidden.</summary>
        public RuntimeFrame ApplyRuntimeResources(RuntimeResourceChanges changes, Action<RuntimeData, RuntimeFrame, RuntimeResourceSnapshot>? validate)
        {
            RequireIdle("applyRuntimeResources");
            if (changes == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "applyRuntimeResources", "Resource changes are required.", "changes");
            return ReplaceResources(resources.Stage(changes), "applyRuntimeResources", validate);
        }
        public RuntimeFrame ClearRuntimeResources() => ClearRuntimeResources(null);
        public RuntimeFrame ClearRuntimeResources(Action<RuntimeData, RuntimeFrame, RuntimeResourceSnapshot>? validate) => ReplaceResources(new ResourceOverlay(), "clearRuntimeResources", validate);
        private RuntimeFrame ReplaceResources(ResourceOverlay overlay, string operation, Action<RuntimeData, RuntimeFrame, RuntimeResourceSnapshot>? validate)
        {
            RequireIdle(operation);
            try
            {
                ulong sequence = NextSequence(operation); RuntimeData effective = overlay.Compose(sourceData); HostState configuration = ReconcileResourceHost(effective);
                configuration.Geometry.Validate(effective, operation);
                RuntimePlayer candidate;
                callbackActive = true;
                try {
                    candidate = new RuntimePlayer(effective, sourceData, Rebind(playback, effective), Rebind(baseline, effective), configuration, overlay, sequence);
                    if (validate != null) {
                        try { validate(candidate.data, candidate.Frame, candidate.QueryRuntimeResources()); }
                        catch (RuntimeException) { throw; }
                        catch (OutOfMemoryException) { throw new RuntimeException(RuntimeErrorCode.ResourceLimit, operation, "Resource validation allocation failed."); }
                        catch (Exception e) { throw new RuntimeException(RuntimeErrorCode.Internal, operation, "Resource validation callback failed: " + e.Message); }
                    }
                }
                finally { callbackActive = false; }
                data = candidate.data; host = candidate.host; playback = candidate.playback; baseline = candidate.baseline; resources = overlay;
                AdoptEvaluation(candidate); return Frame;
            }
            catch (RuntimeException e) { throw Reframe(e, operation); }
        }
        private static Playback Rebind(Playback playback, RuntimeData data)
        {
            Playback next = playback.Clone();
            foreach (Track track in next.Tracks.Values) { Bind(track.Current); foreach (Entry entry in track.Queue) Bind(entry); } return next;
            void Bind(Entry entry) { for (Entry? current = entry; current != null; current = current.From) if (current.Clip != null) current.Clip = data.Clips[current.Clip.Id]; }
        }
        private HostState ReconcileResourceHost(RuntimeData next)
        {
            HostState result = host.Clone(); var skins = new List<string>(); foreach (string id in result.Skins) if (next.SkinDocuments.ContainsKey(id)) skins.Add(id); result.Skins = skins.ToArray();
            result.Regions.Clear();
            foreach (var region in host.Regions)
            {
                string id = data.AttachmentData[region.Key].Id;
                if (next.AttachmentIndex.TryGetValue(id, out int i) && next.AttachmentData[i].Kind == "region") result.Regions.Add(i, region.Value);
            }
            foreach (var attachment in host.Attachments)
                if (attachment.Value != null && (!next.AttachmentIndex.TryGetValue(attachment.Value, out int i) || next.AttachmentData[i].Slot != attachment.Key)) result.Attachments.Remove(attachment.Key);
            foreach (var deform in host.Deforms)
            {
                if (!CompatibleDeform(data, next, deform.Key, deform.Value)) result.Deforms.Remove(deform.Key);
            }
            return result;
        }
    }
}
