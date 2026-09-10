using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;
using Cane.Geometry;

namespace Cane
{
    /// <summary>Renderer-neutral player. Mutations publish only after a detached candidate fully evaluates.</summary>
    public sealed partial class RuntimePlayer
    {
        private RuntimeData data;
        private RuntimeData sourceData;
        private ResourceOverlay resources = new ResourceOverlay();
        private Playback playback = new Playback(), baseline = new Playback();
        private HostState host;
        private Pose publishedPose;
        private Pose? firstPoseWorkspace, secondPoseWorkspace;
        private readonly RenderingWorkspace renderingWorkspace = new RenderingWorkspace();
        private readonly List<RuntimeEvent> pending = new List<RuntimeEvent>();
        private bool callbackActive;
        public RuntimeData Data => data;
        public RuntimeData SourceData => sourceData;
        public RuntimeFrame Frame { get; private set; }
        public Affine RootTransform => host.Root;
        public int TrackCount => playback.AllocatedTracks;
        public float DefaultMixSeconds => playback.DefaultMix;
        internal RuntimePlayer(RuntimeData data)
        {
            this.data = sourceData = data; host = new HostState { Skins = data.SkinIds.Count == 0 ? Array.Empty<string>() : new[] { data.SkinIds[0] } };
            Frame = Evaluate(playback, host, 1, default, out publishedPose);
        }
        private ulong NextSequence(string op)
        { RequireIdle(op); if (Frame.Sequence == ulong.MaxValue) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, op, "Frame sequence is exhausted."); return Frame.Sequence + 1; }
        private void RequireIdle(string operation)
        { if (callbackActive) throw new RuntimeException(RuntimeErrorCode.InvalidState, operation, "A modifier callback cannot mutate or clone the player being evaluated."); }
        private Pose PreparePose(string[] skins)
        {
            // Queries continue to read the last successful pose while a detached workspace is
            // evaluated. Failed evaluations and intermediate replay steps cannot reset it.
            if (firstPoseWorkspace == null || !ReferenceEquals(firstPoseWorkspace.Data, data)) firstPoseWorkspace = new Pose(data, skins);
            Pose result;
            if (!ReferenceEquals(firstPoseWorkspace, publishedPose)) result = firstPoseWorkspace;
            else
            {
                if (secondPoseWorkspace == null || !ReferenceEquals(secondPoseWorkspace.Data, data)) secondPoseWorkspace = new Pose(data, skins);
                result = secondPoseWorkspace;
            }
            result.Reset(skins); return result;
        }
        private void AdoptEvaluation(RuntimePlayer candidate)
        {
            // Commit the candidate's scratch together with its publication. Leaving the old
            // scratch behind keeps a replaced RuntimeData alive until another evaluation.
            firstPoseWorkspace = candidate.firstPoseWorkspace;
            secondPoseWorkspace = candidate.secondPoseWorkspace;
            publishedPose = candidate.publishedPose; Frame = candidate.Frame;
        }
        private RuntimeFrame Evaluate(Playback state, HostState configuration, ulong sequence, SamplingOptions sampling, out Pose pose, Json? modifiers = null, string operation = "apply", Constraints.PhysicsBudget? physicsBudget = null, GeometryModifiers? geometryModifiers = null, float? physicsDeltaOverride = null)
        {
            var stats = new EvaluationStats(); pose = PreparePose(configuration.Skins); state.Apply(pose, sampling); stats.AnimationSamples++;
            foreach (var bone in configuration.Bones) pose.Locals[bone.Key] = bone.Value;
            foreach (var region in configuration.Regions) pose.Regions[region.Key] = region.Value;
            if (configuration.Order != null) { pose.Order = (int[])configuration.Order.Clone(); pose.OrderSampled = true; }
            foreach (var attachment in configuration.Attachments) pose.Slots[attachment.Key].Key = attachment.Value;
            foreach (var tint in configuration.Tints) { pose.Slots[tint.Key].Light = tint.Value.Light; pose.Slots[tint.Key].Dark = tint.Value.Dark; pose.Slots[tint.Key].Alpha = tint.Value.Alpha; }
            foreach (var deform in configuration.Deforms) pose.Deforms[deform.Key] = (float[])deform.Value.Clone();
            foreach (var patch in configuration.Constraints)
                foreach (var value in patch.Value.Members) pose.Constraints[patch.Key].Members[value.Key] = Pose.Clone(value.Value);
            ApplyTransient(pose, modifiers, operation); pose.ResolveAttachments(); pose.UpdateWorld(configuration.Root);
            float physicsDelta = state.Physics.Advance(state, pose, sampling);
            if (physicsDeltaOverride.HasValue) physicsDelta = physicsDeltaOverride.Value;
            Constraints.Solvers.Solve(pose, configuration.Root, sampling, state.Physics, physicsDelta, configuration.Environment, configuration.RootLocal.ScaleX, configuration.RootLocal.ScaleY, physicsBudget ?? new Constraints.PhysicsBudget());
            var bones = new BonePose[pose.World.Length]; for (int i = 0; i < bones.Length; i++) bones[i] = new BonePose(data.BoneData[i].Id, pose.World[i], pose.Locals[i]);
            RenderPacket packet = Rendering.Packet(pose, renderingWorkspace, Frame?.RenderPacket); stats.ConstraintGeometrySolves++;
            GeometryModifierStats geometryStats;
            callbackActive = true;
            try { packet = GeometryEffects.Apply(packet, configuration.Geometry, geometryModifiers, sequence, state.Time, out geometryStats); }
            catch (Exception e) when (!(e is RuntimeException)) { throw new RuntimeException(RuntimeErrorCode.Internal, operation, "Geometry modifier callback failed: " + e.Message); }
            finally { callbackActive = false; }
            var frame = new RuntimeFrame(sequence, state.Time, bones, (string[])configuration.Skins.Clone(), (string[])pose.Skins.Clone(), packet); stats.FramesPublished++; frame.Stats = stats; frame.GeometryStats = geometryStats; return frame;
        }
        private RuntimeFrame Configure(string op, Action<Playback, EventSink>? clocks = null, Action<HostState>? configure = null, bool publish = true, SamplingOptions sampling = default, Action<Playback>? configureBaseline = null)
        {
            RequireIdle(op);
            try
            {
                // Preflight notifications without event DTO allocation. No shared state is changed here.
                var count = new EventSink(data, op, false); clocks?.Invoke(playback.Clone(), count);
                Playback state = playback.Clone(), origin = baseline.Clone(); HostState configuration = host.Clone();
                var events = new EventSink(data, op, true); clocks?.Invoke(state, events);
                if (configureBaseline == null) clocks?.Invoke(origin, new EventSink(data, op, false)); else configureBaseline(origin);
                configure?.Invoke(configuration);
                Pose pose = publishedPose; RuntimeFrame frame = publish ? Evaluate(state, configuration, NextSequence(op), sampling, out pose) : Frame;
                playback = state; baseline = origin; host = configuration; Frame = frame; publishedPose = pose; pending.AddRange(events.Finish()); return frame;
            }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }
        private static RuntimeException Reframe(RuntimeException e, string op) => e.Operation == op ? e : new RuntimeException(e.Code, op, e.Message, e.Field, e.EntityId);
        private static int Index(int index, string op)
        { if (index < 0 || index > 4095) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Track index must be in 0..4095.", "trackIndex"); return index; }
        private static float Nonnegative(float value, string op, string field)
        { Numeric.RequireFinite(value, op, field); if (value < 0) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Expected a non-negative value.", field); return value; }
        private static float Unit(float value, string op, string field)
        { Nonnegative(value, op, field); if (value > 1) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Expected a value in [0,1].", field); return value; }
        private Clip Animation(string id, string op)
        { if (id == null || !data.Clips.TryGetValue(id, out Clip? clip)) throw new RuntimeException(RuntimeErrorCode.NotFound, op, "Animation is missing.", "animationId", id); return clip; }
        private static Entry Current(Playback state, int index, string op)
        { if (!state.Tracks.TryGetValue(index, out Track? t)) throw new RuntimeException(RuntimeErrorCode.NotFound, op, "Track has no active entry.", "trackIndex"); return t.Current; }
        public RuntimeFrame SetAnimation(string animationId, bool looping = true, int trackIndex = 0, float? mixSeconds = null)
        {
            const string op = "setAnimation"; Index(trackIndex, op); Clip clip = Animation(animationId, op); if (mixSeconds.HasValue) Nonnegative(mixSeconds.Value, op, "mixSeconds");
            return Configure(op, (s, e) => s.Replace(trackIndex, clip, looping, mixSeconds, e));
        }
        public RuntimeFrame QueueAnimation(string animationId, float delaySeconds = 0, bool looping = true, int trackIndex = 0)
        {
            const string op = "queueAnimation"; Index(trackIndex, op); Clip clip = Animation(animationId, op); Numeric.RequireFinite(delaySeconds, op, "delaySeconds");
            return Configure(op, (s, e) => s.Enqueue(trackIndex, clip, looping, delaySeconds, null, e));
        }
        public RuntimeFrame SetEmptyAnimation(float mixSeconds, int trackIndex = 0)
        { const string op = "setEmptyAnimation"; Index(trackIndex, op); Nonnegative(mixSeconds, op, "mixSeconds"); return Configure(op, (s, e) => s.Replace(trackIndex, null, false, mixSeconds, e)); }
        public RuntimeFrame QueueEmptyAnimation(float mixSeconds, float delaySeconds = 0, int trackIndex = 0)
        { const string op = "queueEmptyAnimation"; Index(trackIndex, op); Nonnegative(mixSeconds, op, "mixSeconds"); Numeric.RequireFinite(delaySeconds, op, "delaySeconds"); return Configure(op, (s, e) => s.Enqueue(trackIndex, null, false, delaySeconds, mixSeconds, e)); }
        public void SetDefaultMix(float durationSeconds)
        { Nonnegative(durationSeconds, "setDefaultMix", "durationSeconds"); Configure("setDefaultMix", (s, _) => s.DefaultMix = durationSeconds, publish: false); }
        public void SetMix(string fromAnimationId, string toAnimationId, float durationSeconds)
        {
            Animation(fromAnimationId, "setMix"); Animation(toAnimationId, "setMix"); Nonnegative(durationSeconds, "setMix", "durationSeconds");
            Configure("setMix", (s, _) => s.Mixes[(fromAnimationId, toAnimationId)] = durationSeconds, publish: false);
        }
        public RuntimeFrame ClearTrack(int trackIndex = 0)
        { Index(trackIndex, "clearTrack"); return Configure("clearTrack", (s, e) => s.Clear(trackIndex, e)); }
        public RuntimeFrame ClearTracks() => Configure("clearTracks", (s, e) => { foreach (int i in new List<int>(s.Tracks.Keys)) s.Clear(i, e); });
        public RuntimeFrame SetTrackTime(int trackIndex, float timeSeconds)
        {
            const string op = "setTrackTime"; Index(trackIndex, op); Nonnegative(timeSeconds, op, "timeSeconds");
            return ConfigureCurrent(op, trackIndex, e => { e.Time = timeSeconds; e.CursorInitialized = true; });
        }
        public RuntimeFrame SetTrackOptions(int trackIndex, TrackOptions options)
        {
            const string op = "setTrackOptions"; Index(trackIndex, op); if (options == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Options are required.");
            float? alpha = options.Alpha, rate = options.TimeScale, events = options.EventThreshold, attachments = options.AttachmentThreshold, order = options.DrawOrderThreshold;
            bool? loop = options.Looping, hold = options.HoldPrevious; TrackBlend? blend = options.Blend;
            if (alpha.HasValue) Unit(alpha.Value, op, "alpha"); if (rate.HasValue) Numeric.RequireFinite(rate.Value, op, "timeScale");
            if (events.HasValue) Unit(events.Value, op, "eventThreshold"); if (attachments.HasValue) Unit(attachments.Value, op, "attachmentThreshold"); if (order.HasValue) Unit(order.Value, op, "drawOrderThreshold");
            if (blend.HasValue && blend != TrackBlend.Replace && blend != TrackBlend.Additive) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Unknown blend mode.", "blend");
            return ConfigureCurrent(op, trackIndex, e => {
                if (alpha.HasValue) e.Alpha = alpha.Value; if (rate.HasValue) e.Rate = rate.Value;
                if (events.HasValue) e.EventThreshold = events.Value; if (attachments.HasValue) e.AttachmentThreshold = attachments.Value;
                if (order.HasValue) e.DrawOrderThreshold = order.Value; if (loop.HasValue) e.Loop = loop.Value;
                if (hold.HasValue) e.Hold = hold.Value; if (blend.HasValue) e.Additive = blend == TrackBlend.Additive;
            });
        }
        public TrackState? QueryTrackState(int trackIndex = 0)
        { Index(trackIndex, "queryTrackState"); return playback.Tracks.TryGetValue(trackIndex, out Track? t) ? new TrackState(trackIndex, t.Current, t.Queue.Count) : null; }
        public IReadOnlyList<QueuedEntry> QueryQueuedEntries(int trackIndex = 0)
        {
            Index(trackIndex, "queryQueuedEntries"); if (!playback.Tracks.TryGetValue(trackIndex, out Track? t)) return Array.AsReadOnly(Array.Empty<QueuedEntry>());
            var entries = new QueuedEntry[t.Queue.Count]; for (int i = 0; i < entries.Length; i++) entries[i] = new QueuedEntry(trackIndex, i, t.Queue[i]); return Array.AsReadOnly(entries);
        }
        public RuntimeFrame SetTrackAnimationRange(int trackIndex, float? start, float? end)
        {
            const string op = "setTrackAnimationRange"; Index(trackIndex, op);
            if (start.HasValue) Nonnegative(start.Value, op, "start"); if (end.HasValue) Nonnegative(end.Value, op, "end");
            return ConfigureCurrent(op, trackIndex, e => { float a = start ?? 0, b = end ?? e.Clip?.Duration ?? 0;
                if (a > b || b > (e.Clip?.Duration ?? 0)) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Invalid animation range.", "range"); e.Start = a; e.End = b; });
        }
        public RuntimeFrame SetTrackEnd(int trackIndex, float? end)
        { const string op = "setTrackEnd"; Index(trackIndex, op); if (end.HasValue) Nonnegative(end.Value, op, "trackEnd"); return ConfigureCurrent(op, trackIndex, e => e.TrackEnd = end); }
        public RuntimeFrame SetTrackMixDuration(int trackIndex, float duration)
        { const string op = "setTrackMixDuration"; Index(trackIndex, op); Nonnegative(duration, op, "mixDuration"); return ConfigureCurrent(op, trackIndex, e => e.MixDuration = duration); }
        public RuntimeFrame SetSkins(IReadOnlyList<string> skinIds)
        {
            const string op = "setSkins"; if (skinIds == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Skin IDs are required.");
            var ids = new string[skinIds.Count]; var unique = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < ids.Length; i++) { string id = skinIds[i]; if (id == null || !data.SkinDocuments.ContainsKey(id)) throw new RuntimeException(RuntimeErrorCode.NotFound, op, "Skin is missing.", "skinIds", id); if (!unique.Add(id)) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Duplicate skin ID.", "skinIds", id); ids[i] = id; }
            return Configure(op, configure: h => h.Skins = ids);
        }
        public RuntimeFrame SetRootTransform(BoneLocal transform, PhysicsHostMotionMode physicsMode = PhysicsHostMotionMode.Move, string? constraintId = null)
        {
            if (!Enum.IsDefined(typeof(PhysicsHostMotionMode), physicsMode)) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "setRootTransform", "Unknown Physics host motion mode.", "physicsMode", constraintId);
            if (constraintId != null)
            {
                Json? constraint = Array.Find(data.Constraints, c => c.S("id") == constraintId);
                if (constraint == null) throw new RuntimeException(RuntimeErrorCode.NotFound, "setRootTransform", "Physics constraint is missing.", "constraintId", constraintId);
                if (constraint.S("type") != "physics") throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "setRootTransform", "Constraint is not Physics.", "constraintId", constraintId);
            }
            for (int i = 0; i < 7; i++) Numeric.RequireFinite(transform.Get(i), "setRootTransform", "rootTransform");
            Affine matrix = Affine.FromLocal(transform); if (!matrix.IsFinite) throw new RuntimeException(RuntimeErrorCode.NonFinite, "setRootTransform", "Root transform overflowed.", "rootTransform");
            Affine previous = host.Root;
            return Configure("setRootTransform", (s, _) => s.Physics.ApplyHostMotion(previous, matrix, physicsMode, constraintId), h => { h.Root = matrix; h.RootLocal = transform; });
        }
        public RuntimeFrame SetPhysicsEnvironment(PhysicsEnvironment environment)
        {
            const string op = "setPhysicsEnvironment"; Numeric.RequireFinite(environment.WindX, op, "windX"); Numeric.RequireFinite(environment.WindY, op, "windY"); Numeric.RequireFinite(environment.GravityX, op, "gravityX"); Numeric.RequireFinite(environment.GravityY, op, "gravityY");
            return Configure(op, configure: h => h.Environment = environment);
        }
        public RuntimeFrame ResetPhysics() => Configure("resetPhysics", (s, _) => s.Physics.Reset());
        public bool ResetPhysicsConstraint(string constraintId)
        {
            Json? definition = Array.Find(data.Constraints, c => c.S("id") == constraintId);
            if (definition == null) throw new RuntimeException(RuntimeErrorCode.NotFound, "resetPhysicsConstraint", "Physics constraint is missing.", entityId: constraintId);
            if (definition.S("type") != "physics") throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "resetPhysicsConstraint", "Constraint is not Physics.", entityId: constraintId);
            bool hadState = playback.Physics.States.ContainsKey(constraintId); Configure("resetPhysicsConstraint", (s, _) => s.Physics.Reset(constraintId)); return hadState;
        }
        private static int Id(Dictionary<string, int> index, string id, string op, string? field)
        { if (id == null || !index.TryGetValue(id, out int i)) throw new RuntimeException(RuntimeErrorCode.NotFound, op, "Unknown entity ID.", field, id); return i; }
        public RuntimeFrame SetBoneLocalOverride(string boneId, BoneLocal local)
        {
            int i = Id(data.BoneIndex, boneId, "setBoneLocalOverride", "boneId"); for (int c = 0; c < 7; c++) Numeric.RequireFinite(local.Get(c), "setBoneLocalOverride", "local");
            return Configure("setBoneLocalOverride", configure: h => h.Bones[i] = local);
        }
        public RuntimeFrame ClearBoneLocalOverride(string boneId)
        { int i = Id(data.BoneIndex, boneId, "clearBoneLocalOverride", "boneId"); return Configure("clearBoneLocalOverride", configure: h => h.Bones.Remove(i)); }
        public RuntimeFrame SetSlotAttachmentOverride(string slotId, string? attachmentId)
        {
            const string op = "setSlotAttachmentOverride"; int i = Id(data.SlotIndex, slotId, op, "slotId");
            if (attachmentId != null && (!data.AttachmentIndex.TryGetValue(attachmentId, out int a) || data.AttachmentData[a].Slot != i)) throw new RuntimeException(RuntimeErrorCode.NotFound, op, "Attachment is missing from the slot.", "attachmentId", attachmentId);
            return Configure(op, configure: h => h.Attachments[i] = attachmentId);
        }
        public RuntimeFrame ClearSlotAttachmentOverride(string slotId)
        { int i = Id(data.SlotIndex, slotId, "clearSlotAttachmentOverride", "slotId"); return Configure("clearSlotAttachmentOverride", configure: h => h.Attachments.Remove(i)); }
        public RuntimeFrame SetSlotTintOverride(string slotId, FinalTint tint)
        { int i = Id(data.SlotIndex, slotId, "setSlotTintOverride", "slotId"); Unit(tint.Alpha, "setSlotTintOverride", "alpha"); return Configure("setSlotTintOverride", configure: h => h.Tints[i] = tint); }
        public RuntimeFrame ClearSlotTintOverride(string slotId)
        { int i = Id(data.SlotIndex, slotId, "clearSlotTintOverride", "slotId"); return Configure("clearSlotTintOverride", configure: h => h.Tints.Remove(i)); }
        public RuntimeStep Update(float deltaSeconds) => AdvanceInternal(deltaSeconds, false, default);
        public RuntimeStep Advance(float deltaSeconds, SamplingOptions sampling = default) => AdvanceInternal(deltaSeconds, true, sampling);
        private RuntimeStep AdvanceInternal(float delta, bool publish, SamplingOptions sampling, Json? modifiers = null, string? operation = null, GeometryModifiers? geometryModifiers = null)
        {
            string op = operation ?? (publish ? "advance" : "update"); Nonnegative(delta, op, "deltaSeconds"); sampling.Validate(op);
            RequireIdle(op);
            try
            {
                playback.Clone().Update(delta, new EventSink(data, op, false));
                Playback state = playback.Clone(); var events = new EventSink(data, op, true); state.Update(delta, events);
                Pose pose = publishedPose; RuntimeFrame frame = publish ? Evaluate(state, host, NextSequence(op), sampling, out pose, modifiers, op, geometryModifiers: geometryModifiers) : Frame;
                RuntimeEvent[] batch = events.Finish(); playback = state; Frame = frame; publishedPose = pose; pending.AddRange(batch);
                return new RuntimeStep(delta != 0 || batch.Length != 0, frame, batch);
            }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }
        public RuntimeFrame Apply(SamplingOptions sampling = default)
        {
            sampling.Validate("apply"); Playback state = playback.Clone(); RuntimeFrame frame = Evaluate(state, host, NextSequence("apply"), sampling, out Pose pose);
            playback = state; Frame = frame; publishedPose = pose; return frame;
        }
        public RuntimeStep SampleAt(float timeSeconds, float fixedStepSeconds = 1f / 60, SamplingOptions sampling = default)
        {
            const string op = "seek"; Nonnegative(timeSeconds, op, "timeSeconds"); Nonnegative(fixedStepSeconds, op, "fixedStepSeconds"); sampling.Validate(op);
            if (fixedStepSeconds == 0) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Fixed step must be positive.", "fixedStepSeconds");
            double steps = Math.Ceiling((double)timeSeconds / fixedStepSeconds);
            if (steps > 1000000) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, op, "Absolute sampling exceeds 1,000,000 steps.", "fixedStepSeconds");
            try
            {
                ulong sequence = NextSequence(op); Playback countState = baseline.Clone(); var count = new EventSink(data, op, false);
                float previous = 0;
                for (int i = 1; i <= steps; i++) { float target = i == steps ? timeSeconds : (float)Math.Min((double)i * fixedStepSeconds, timeSeconds); countState.Update(target - previous, count); previous = target; }
                Playback state = baseline.Clone(); state.Physics.Reset(); var budget = new Constraints.PhysicsBudget(); var replay = new List<RuntimeEvent>(count.Count); RuntimeFrame frame = Evaluate(state, host, sequence, sampling, out Pose pose, physicsBudget: budget); previous = 0;
                for (int i = 1; i <= steps; i++)
                {
                    float target = i == steps ? timeSeconds : (float)Math.Min((double)i * fixedStepSeconds, timeSeconds);
                    var events = new EventSink(data, op, true, EventSink.Limit - replay.Count); state.Update(target - previous, events); replay.AddRange(events.Finish());
                    frame = Evaluate(state, host, sequence, sampling, out pose, physicsBudget: budget); previous = target;
                }
                playback = state; Frame = frame; publishedPose = pose; return new RuntimeStep(steps != 0, frame, replay.ToArray());
            }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }
        public RuntimeStep Seek(float timeSeconds, float fixedStepSeconds = 1f / 60, SamplingOptions sampling = default) => SampleAt(timeSeconds, fixedStepSeconds, sampling);
        public IReadOnlyList<RuntimeEvent> DrainEvents()
        { RequireIdle("drainEvents"); RuntimeEvent[] result = pending.ToArray(); pending.Clear(); return Array.AsReadOnly(result); }
        public RuntimeFrame Reset()
        {
            const string operation = "reset";
            try {
                ulong sequence = NextSequence(operation); var state = new Playback(); var origin = new Playback();
                var configuration = new HostState { Skins = data.SkinIds.Count == 0 ? Array.Empty<string>() : new[] { data.SkinIds[0] } };
                RuntimeFrame frame = Evaluate(state, configuration, sequence, default, out Pose pose);
                playback = state; baseline = origin; host = configuration; Frame = frame; publishedPose = pose; pending.Clear(); return frame;
            }
            catch (RuntimeException e) { throw Reframe(e, operation); }
        }
        public RuntimePlayer CloneConfiguration()
        {
            RequireIdle("cloneConfiguration");
            // Configuration excludes entries, clocks, pending events, and solver history.
            var state = new Playback { DefaultMix = playback.DefaultMix };
            foreach (var mix in playback.Mixes) state.Mixes.Add(mix.Key, mix.Value);
            callbackActive = true;
            try { return new RuntimePlayer(data, sourceData, state, state.Clone(), host.Clone(), resources.Copy(), 1); }
            finally { callbackActive = false; }
        }
    }
    internal sealed class HostState
    {
        internal Affine Root = Affine.Identity;
        internal BoneLocal RootLocal = BoneLocal.Identity;
        internal PhysicsEnvironment Environment = PhysicsEnvironment.Default;
        internal GeometryModifiers Geometry = new GeometryModifiers();
        internal string[] Skins = Array.Empty<string>();
        internal int[]? Order;
        internal readonly Dictionary<int, BoneLocal> Bones = new Dictionary<int, BoneLocal>(), Regions = new Dictionary<int, BoneLocal>();
        internal readonly Dictionary<int, string?> Attachments = new Dictionary<int, string?>();
        internal readonly Dictionary<int, FinalTint> Tints = new Dictionary<int, FinalTint>();
        internal readonly Dictionary<string, float[]> Deforms = new Dictionary<string, float[]>(StringComparer.Ordinal);
        internal readonly Dictionary<int, Json> Constraints = new Dictionary<int, Json>();
        internal HostState Clone()
        {
            var h = new HostState { Root = Root, RootLocal = RootLocal, Environment = Environment, Geometry = Geometry.Copy(), Skins = (string[])Skins.Clone(), Order = Order == null ? null : (int[])Order.Clone() };
            foreach (var p in Bones) h.Bones.Add(p.Key, p.Value); foreach (var p in Regions) h.Regions.Add(p.Key, p.Value);
            foreach (var p in Attachments) h.Attachments.Add(p.Key, p.Value); foreach (var p in Tints) h.Tints.Add(p.Key, p.Value);
            foreach (var p in Deforms) h.Deforms.Add(p.Key, (float[])p.Value.Clone()); foreach (var p in Constraints) h.Constraints.Add(p.Key, Pose.Clone(p.Value)); return h;
        }
    }
}
