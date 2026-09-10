using System;
using System.Collections.Generic;

namespace Cane
{
    public enum TrackBlend { Replace, Additive }
    public sealed class TrackOptions
    {
        public float? Alpha { get; set; }
        public float? TimeScale { get; set; }
        public bool? Looping { get; set; }
        public TrackBlend? Blend { get; set; }
        public float? EventThreshold { get; set; }
        public float? AttachmentThreshold { get; set; }
        public float? DrawOrderThreshold { get; set; }
        public bool? HoldPrevious { get; set; }
    }
    public sealed class QueuedEntryOptions
    {
        public float? DelaySeconds { get; set; }
        public float? MixDurationSeconds { get; set; }
        public bool? Looping { get; set; }
    }
    public readonly struct SamplingOptions
    {
        public readonly bool Stepped;
        public readonly float FramesPerSecond;
        public readonly float? FrameStepSeconds;
        public SamplingOptions(bool stepped = false, float framesPerSecond = 0)
        { Stepped = stepped; FramesPerSecond = framesPerSecond; FrameStepSeconds = null; }
        private SamplingOptions(float frameStepSeconds, bool stepped)
        { Stepped = stepped; FramesPerSecond = 0; FrameStepSeconds = frameStepSeconds; }
        public static SamplingOptions FixedFrame(float frameStepSeconds, bool stepped = false) => new SamplingOptions(frameStepSeconds, stepped);
        internal float Time(float value)
        {
            if (!FrameStepSeconds.HasValue && FramesPerSecond == 0) return value;
            float step = FrameStepSeconds ?? (1 / FramesPerSecond);
            float result = (float)(Math.Floor((double)value / step + 0.5) * step);
            if (!Numeric.Finite(result)) throw new RuntimeException(RuntimeErrorCode.NonFinite, "apply", "Fixed-frame sample time became non-finite.", "sampling");
            return result;
        }
        internal void Validate(string op)
        {
            Numeric.RequireFinite(FramesPerSecond, op, "sampling.fps");
            if (FramesPerSecond < 0) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Sampling fps must be positive or zero for authored sampling.", "sampling.fps");
            if (FrameStepSeconds.HasValue || FramesPerSecond > 0)
            {
                float step = FrameStepSeconds ?? (1 / FramesPerSecond); Numeric.RequireFinite(step, op, "sampling.frameStepSeconds");
                if (step <= 0) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Frame step must be positive.", "sampling.frameStepSeconds");
            }
        }
    }
    public sealed class RuntimeStep
    {
        public bool Changed { get; }
        public float TimeSeconds { get; }
        public ulong FrameSequence { get; }
        public IReadOnlyList<RuntimeEvent> Events { get; }
        internal RuntimeStep(bool changed, RuntimeFrame frame, RuntimeEvent[] events)
        { Changed = changed; TimeSeconds = frame.TimeSeconds; FrameSequence = frame.Sequence; Events = Array.AsReadOnly(events); }
    }
    public sealed class TrackState
    {
        public int TrackIndex { get; }
        public string? AnimationId { get; }
        public float TrackTime { get; }
        public float AnimationTime { get; }
        public float AnimationStart { get; }
        public float AnimationEnd { get; }
        public float DelaySeconds { get; }
        public float? TrackEnd { get; }
        public float Alpha { get; }
        public float TimeScale { get; }
        public bool Looping { get; }
        public TrackBlend Blend { get; }
        public float MixTime { get; }
        public float MixDuration { get; }
        public float MixProgress { get; }
        public float EventThreshold { get; }
        public float AttachmentThreshold { get; }
        public float DrawOrderThreshold { get; }
        public bool HoldPrevious { get; }
        public int QueuedEntryCount { get; }
        internal TrackState(int index, Animation.Entry e, int count)
        {
            TrackIndex = index; AnimationId = e.Clip?.Id; TrackTime = e.Time; AnimationTime = e.PoseTime;
            AnimationStart = e.Start; AnimationEnd = e.End; DelaySeconds = e.Delay; TrackEnd = e.TrackEnd; Alpha = e.Alpha; TimeScale = e.Rate;
            Looping = e.Loop; Blend = e.Additive ? TrackBlend.Additive : TrackBlend.Replace; MixTime = e.MixTime;
            MixDuration = e.MixDuration; MixProgress = e.Progress; EventThreshold = e.EventThreshold;
            AttachmentThreshold = e.AttachmentThreshold; DrawOrderThreshold = e.DrawOrderThreshold;
            HoldPrevious = e.Hold; QueuedEntryCount = count;
        }
    }
    public sealed class QueuedEntry
    {
        public int TrackIndex { get; }
        public int QueueIndex { get; }
        public string? AnimationId { get; }
        public float DelaySeconds { get; }
        public float MixDuration { get; }
        public bool Looping { get; }
        internal QueuedEntry(int track, int i, Animation.Entry e)
        { TrackIndex = track; QueueIndex = i; AnimationId = e.Clip?.Id; DelaySeconds = e.Delay; MixDuration = e.MixDuration; Looping = e.Loop; }
    }
}

namespace Cane.Animation
{
    internal sealed class Entry
    {
        internal Clip? Clip;
        internal float Time, Start, End, Delay, MixTime, MixDuration, Alpha = 1, Rate = 1;
        internal float EventThreshold, AttachmentThreshold, DrawOrderThreshold;
        internal float? TrackEnd;
        internal bool Loop, Additive, Hold, CursorInitialized;
        internal Entry? From;
        internal long EventOrder;
        internal float Duration => Math.Max(0, End - Start);
        internal float Progress => From == null || MixDuration == 0 ? 1 : Numeric.Clamp(MixTime / MixDuration, 0, 1);
        internal float PoseTime
        {
            get { float d = Duration; if (d == 0) return Start; float t = Loop ? Time % d : Numeric.Clamp(Time, 0, d); if (t < 0) t += d; return Start + t; }
        }
        internal Entry(Clip? clip, bool loop, float mix)
        { Clip = clip; Loop = loop; End = clip?.Duration ?? 0; MixDuration = mix; }
        internal Entry Clone() { var next = (Entry)MemberwiseClone(); next.From = From?.Clone(); return next; }
    }
    internal sealed class Track
    {
        internal Entry Current;
        internal readonly List<Entry> Queue = new List<Entry>();
        internal Track(Entry entry) { Current = entry; }
        internal Track Clone() { var copy = new Track(Current.Clone()); foreach (Entry e in Queue) copy.Queue.Add(e.Clone()); return copy; }
    }
    internal sealed class Playback
    {
        internal readonly SortedDictionary<int, Track> Tracks = new SortedDictionary<int, Track>();
        internal readonly Dictionary<(string, string), float> Mixes = new Dictionary<(string, string), float>();
        internal float DefaultMix, DetachedTime;
        internal int AllocatedTracks;
        internal long NextEventOrder;
        internal Constraints.PhysicsStore Physics = new Constraints.PhysicsStore();
        internal Playback Clone()
        {
            var copy = new Playback { DefaultMix = DefaultMix, DetachedTime = DetachedTime, AllocatedTracks = AllocatedTracks, NextEventOrder = NextEventOrder, Physics = Physics.Clone() };
            foreach (var p in Tracks) copy.Tracks.Add(p.Key, p.Value.Clone());
            foreach (var p in Mixes) copy.Mixes.Add(p.Key, p.Value); return copy;
        }
        internal float Time => Tracks.TryGetValue(0, out Track? t) ? t.Current.PoseTime : DetachedTime;
        internal float Mix(Entry? from, Clip? to) => from?.Clip == null || to == null ? DefaultMix : Mixes.TryGetValue((from.Clip.Id, to.Id), out float m) ? m : DefaultMix;
        internal void Replace(int index, Clip? clip, bool loop, float? mix, EventSink events)
        {
            AllocatedTracks = Math.Max(AllocatedTracks, index + 1);
            Tracks.TryGetValue(index, out Track? old); float duration = old == null ? 0 : mix ?? Mix(old.Current, clip);
            var entry = new Entry(clip, loop, duration) { EventOrder = NextEventOrder++ };
            if (old != null)
            {
                events.Lifecycle("interrupt", index, old.Current, 0);
                if (duration == 0) EndChain(old.Current, index, 0, events); else entry.From = old.Current;
                foreach (var queued in old.Queue) events.Lifecycle("dispose", index, queued, 0);
            }
            Tracks[index] = new Track(entry); events.Lifecycle("start", index, entry, 0);
        }
        internal void Enqueue(int index, Clip? clip, bool loop, float delay, float? mix, EventSink events)
        {
            if (!Tracks.TryGetValue(index, out Track? track)) { Replace(index, clip, loop, 0, events); return; }
            Entry previous = track.Queue.Count == 0 ? track.Current : track.Queue[track.Queue.Count - 1];
            float duration = mix ?? Mix(previous, clip);
            track.Queue.Add(new Entry(clip, loop, duration) { EventOrder = NextEventOrder++, Delay = delay > 0 ? delay : Math.Max(0, previous.Duration - duration + delay) });
        }
        internal void Clear(int index, EventSink events, double offset = 0)
        {
            if (!Tracks.TryGetValue(index, out Track? t)) return;
            EndChain(t.Current, index, offset, events); foreach (var e in t.Queue) events.Lifecycle("dispose", index, e, offset); Tracks.Remove(index);
        }
        internal static void EndChain(Entry? e, int track, double offset, EventSink events)
        { long order = e == null ? 0 : e.EventOrder * 2 + 1; while (e != null) { events.Lifecycle("end", track, e, offset, order); events.Lifecycle("dispose", track, e, offset, order); e = e.From; } }
        internal void Apply(Pose pose, SamplingOptions sampling)
        {
            var lower = pose.LowerTrackProperties; lower.Clear();
            foreach (var track in Tracks.Values)
            {
                ApplyChain(pose, track.Current, null, 1, lower, sampling);
                for (Entry? e = track.Current; e != null; e = e.From) if (e.Clip != null) lower.UnionWith(e.Clip.Properties);
            }
        }
        private static void ApplyChain(Pose pose, Entry e, Entry? incoming, float fade, HashSet<string> lower, SamplingOptions sampling)
        {
            float progress = e.Progress;
            if (e.From != null) ApplyChain(pose, e.From, e, e.Clip == null && !e.Hold ? fade * (1 - progress) : fade, lower, sampling);
            if (e.Clip == null) return;
            float alpha = fade * e.Alpha * progress;
            var layer = new Layer { Clip = e.Clip, Time = sampling.Time(e.PoseTime), Alpha = alpha, Additive = e.Additive, Stepped = sampling.Stepped };
            if (incoming != null)
            {
                float mix = incoming.Progress;
                layer.Attachments = mix < e.AttachmentThreshold; layer.DrawOrder = mix < e.DrawOrderThreshold;
                if (incoming.Clip != null && !incoming.Hold)
                    layer.PropertyAlpha = property => incoming.Clip.Properties.Contains(property) && !lower.Contains(property) ? alpha : alpha * (1 - mix);
            }
            Sampling.Apply(pose, layer);
        }
        internal void Update(float delta, EventSink events)
        {
            DetachedTime += delta; if (!Numeric.Finite(DetachedTime)) throw new RuntimeException(RuntimeErrorCode.NonFinite, events.Operation, "Playback clock overflowed.", "deltaSeconds");
            var indices = new List<int>(Tracks.Keys);
            foreach (int index in indices)
            {
                double offset = 0, remaining = delta;
                while (Tracks.TryGetValue(index, out Track? track))
                {
                    Entry e = track.Current; double span = remaining;
                    bool promote = track.Queue.Count != 0 && e.Rate > 0;
                    double queueAt = promote ? Math.Max(0, ((double)track.Queue[0].Delay - e.Time) / e.Rate) : double.PositiveInfinity;
                    double endAt = e.TrackEnd.HasValue && e.Rate > 0 ? Math.Max(0, ((double)e.TrackEnd.Value - e.Time) / e.Rate) : double.PositiveInfinity;
                    double mixAt = NextMix(e);
                    span = Math.Min(span, Math.Min(queueAt, Math.Min(endAt, mixAt)));
                    AdvanceChain(e, null, index, offset, span, events);
                    offset += span; remaining = Math.Max(0, remaining - span);
                    bool boundary = false;
                    if (queueAt <= span && queueAt <= endAt)
                    {
                        Entry next = track.Queue[0]; track.Queue.RemoveAt(0);
                        events.Lifecycle("interrupt", index, e, offset);
                        if (next.MixDuration == 0) EndChain(e, index, offset, events); else next.From = e;
                        track.Current = next; events.Lifecycle("start", index, next, offset); boundary = true;
                    }
                    else if (endAt <= span) { Clear(index, events, offset); break; }
                    else boundary = CompleteMixes(e, index, offset, events);
                    if (remaining == 0 && !boundary) break;
                    if (span == 0 && !boundary) break;
                }
            }
        }
        private static double NextMix(Entry e)
        {
            double at = double.PositiveInfinity;
            for (Entry? entry = e; entry?.From != null; entry = entry.From) at = Math.Min(at, Math.Max(0, (double)entry.MixDuration - entry.MixTime));
            return at;
        }
        private static bool CompleteMixes(Entry e, int index, double offset, EventSink events)
        {
            if (e.From == null) return false;
            if (e.MixDuration == 0 || e.MixTime >= e.MixDuration)
            { EndChain(e.From, index, offset, events); e.From = null; return true; }
            return CompleteMixes(e.From, index, offset, events);
        }
        private static void AdvanceChain(Entry e, Entry? incoming, int index, double offset, double delta, EventSink events)
        {
            if (e.From != null) AdvanceChain(e.From, e, index, offset, delta, events);
            float previous = e.Time, next = (float)((double)previous + (float)delta * e.Rate);
            if (!e.Loop) next = Math.Max(0, next);
            if (!Numeric.Finite(next)) throw new RuntimeException(RuntimeErrorCode.NonFinite, events.Operation, "Track clock overflowed.", "timeSeconds");
            EventCrossings.Collect(e, incoming, index, previous, next, offset, delta, events);
            e.Time = next; e.MixTime += (float)delta;
            if (!Numeric.Finite(e.MixTime)) throw new RuntimeException(RuntimeErrorCode.NonFinite, events.Operation, "Mix clock overflowed.", "mixTime");
        }
    }
}
