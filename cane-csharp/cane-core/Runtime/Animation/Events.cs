using System;
using System.Collections.Generic;
using Cane.Format;

namespace Cane.Animation
{
    // A dry counting pass validates the complete batch before the publishing pass allocates event DTOs.
    internal sealed class EventSink
    {
        internal const int Limit = 1000000;
        internal readonly string Operation;
        internal readonly RuntimeData Data;
        internal int Count { get; private set; }
        private readonly int capacity;
        private readonly List<TimedEvent>? items;
        internal EventSink(RuntimeData data, string operation, bool collect, int capacity = Limit)
        { Data = data; Operation = operation; this.capacity = capacity; if (collect) items = new List<TimedEvent>(); }
        internal void Require(double minimum)
        { if (minimum > capacity - Count) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, Operation, "The operation would emit more than 1,000,000 events.", Operation == "seek" ? "timeSeconds" : "deltaSeconds"); }
        private bool Add()
        { Require(1); Count++; return items != null; }
        internal void Lifecycle(string kind, int track, Entry e, double offset, long? entryOrder = null)
        {
            if (!Add()) return;
            items!.Add(new TimedEvent(offset, track, entryOrder ?? e.EventOrder * 2 + (kind == "interrupt" ? 1 : 0), Count, new RuntimeEvent(kind, track, e.Clip?.Id, 0)));
        }
        internal void User(int track, Entry e, Json key, double offset)
        {
            if (!Add()) return;
            string id = key.S("eventId"); Json setup = Data.EventDocuments[id];
            long? integer = key["integerValue"].IsNull ? setup["integerValue"].IsNull ? (long?)null : setup.L("integerValue") : key.L("integerValue");
            float? number = key["numberValue"].IsNull ? setup["numberValue"].IsNull ? (float?)null : setup.F("numberValue") : key.F("numberValue");
            string? text = key["stringValue"].StringOrNull ?? setup["stringValue"].StringOrNull;
            string? audio = key["audioId"].StringOrNull ?? setup["audioId"].StringOrNull;
            var value = new RuntimeEvent("user", track, e.Clip!.Id, key.F("time"), setup.S("name"), id, integer, number, text, audio,
                key.F("volume", setup.F("volume", 1)), key.F("balance", setup.F("balance")));
            items!.Add(new TimedEvent(offset, track, e.EventOrder * 2, Count, value));
        }
        internal RuntimeEvent[] Finish()
        {
            if (items == null) return Array.Empty<RuntimeEvent>();
            items.Sort((a, b) => { int c = a.Offset.CompareTo(b.Offset); if (c != 0) return c; c = a.Track.CompareTo(b.Track); if (c != 0) return c; c = a.EntryOrder.CompareTo(b.EntryOrder); return c == 0 ? a.Order.CompareTo(b.Order) : c; });
            var result = new RuntimeEvent[items.Count]; for (int i = 0; i < result.Length; i++) result[i] = items[i].Value; return result;
        }
        private readonly struct TimedEvent
        {
            internal readonly double Offset;
            internal readonly int Track, Order;
            internal readonly long EntryOrder;
            internal readonly RuntimeEvent Value;
            internal TimedEvent(double offset, int track, long entryOrder, int order, RuntimeEvent value) { Offset = offset; Track = track; EntryOrder = entryOrder; Order = order; Value = value; }
        }
    }

    internal static class EventCrossings
    {
        private static float Adjacent(float value, bool up)
        {
            if (value == 0) return up ? float.Epsilon : -float.Epsilon;
            int bits = BitConverter.SingleToInt32Bits(value);
            return BitConverter.Int32BitsToSingle(bits + ((value > 0) == up ? 1 : -1));
        }
        // Quotient floor can disagree with a loaded binary32 boundary. Search the neighboring
        // rounding cell for the first integer cycle whose projected boundary owns this endpoint.
        private static double BoundaryIndex(float value, double duration, bool inclusive)
        {
            double center = value; float before = Adjacent(value, false), after = Adjacent(value, true);
            double lowerGap = Numeric.Finite(before) ? center - before : (double)after - center;
            double upperGap = Numeric.Finite(after) ? (double)after - center : lowerGap;
            double low = Math.Floor((center - lowerGap) / duration) - 2, high = Math.Ceiling((center + upperGap) / duration) + 2;
            while (low < high)
            {
                double mid = low + Math.Floor((high - low) * .5); float raw = (float)(mid * duration);
                if (inclusive ? raw >= value : raw > value) high = mid; else low = mid + 1;
            }
            return low;
        }
        internal static void Collect(Entry entry, Entry? incoming, int track, float previous, float current, double offset, double delta, EventSink sink)
        {
            if (previous == current) return;
            bool initialize = !entry.CursorInitialized && previous == 0;
            entry.CursorInitialized = true;
            if (entry.Clip == null) return;
            double duration = entry.Duration;
            bool forward = current > previous;
            var keys = entry.Clip.Raw["events"].Items;
            double RelativeWall(double raw) => (raw - previous) / ((double)current - previous) * delta;
            double Wall(double raw) => offset + RelativeWall(raw);
            bool Enabled(double relativeWall)
            {
                if (incoming == null) return true;
                double progress = incoming.MixDuration == 0 ? 1 : Math.Max(0, Math.Min(1, (incoming.MixTime + relativeWall) / incoming.MixDuration));
                return progress < entry.EventThreshold;
            }
            void User(Json key, double raw)
            { double relative = RelativeWall(raw); if (Enabled(relative)) sink.User(track, entry, key, offset + relative); }
            void Boundary(double raw)
            {
                if (forward)
                {
                    foreach (Json k in keys) if (k.F("time") == entry.End) User(k, raw);
                    sink.Lifecycle("complete", track, entry, Wall(raw));
                    foreach (Json k in keys) if (k.F("time") == entry.Start) User(k, raw);
                }
                else
                {
                    for (int i = keys.Count - 1; i >= 0; i--) if (keys[i].F("time") == entry.Start) User(keys[i], raw);
                    sink.Lifecycle("complete", track, entry, Wall(raw));
                    for (int i = keys.Count - 1; i >= 0; i--) if (keys[i].F("time") == entry.End) User(keys[i], raw);
                }
            }
            if (initialize && Enabled(0)) foreach (Json k in keys) if (k.F("time") == entry.Start) sink.User(track, entry, k, offset);
            if (entry.Duration == 0) return;
            if (!entry.Loop)
            {
                if (forward)
                {
                    foreach (Json k in keys)
                    { double raw = (float)(k.F("time") - entry.Start); if (raw >= 0 && raw <= duration && raw > previous && raw <= current) User(k, raw); }
                    if (previous < duration && current >= duration) sink.Lifecycle("complete", track, entry, Wall(duration));
                }
                else
                {
                    for (int i = keys.Count - 1; i >= 0; i--)
                    { Json k = keys[i]; double raw = (float)(k.F("time") - entry.Start); if (raw >= 0 && raw <= duration && raw >= current && raw < previous) User(k, raw); }
                    if (previous > 0 && current <= 0) sink.Lifecycle("complete", track, entry, Wall(0));
                }
                return;
            }
            // First reject enormous intervals using a conservative rounding-cell lower bound.
            // Remaining integer cycle indices fit exactly in binary64; count actual binary32
            // crossings before iteration, including boundaries aliased onto one raw endpoint.
            sink.Require(Math.Max(0, Math.Floor(Math.Abs((double)current - previous) / duration * .25) - 2));
            double first = BoundaryIndex(previous, duration, !forward), after = BoundaryIndex(current, duration, !forward);
            double completeCount = forward ? after - first : first - after;
            sink.Require(completeCount);
            double cycle = first - 1;
            int iterations = (int)completeCount + 1;
            for (int n = 0; n < iterations; n++, cycle += forward ? 1 : -1)
            {
                if (forward)
                {
                    foreach (Json key in keys)
                    {
                        float time = key.F("time"); if (time <= entry.Start || time >= entry.End) continue;
                        double raw = (float)(cycle * duration + (float)(time - entry.Start));
                        if (raw > previous && raw <= current) User(key, raw);
                    }
                    double boundary = (float)((cycle + 1) * duration);
                    if (boundary > previous && boundary <= current) Boundary(boundary);
                }
                else
                {
                    for (int i = keys.Count - 1; i >= 0; i--)
                    {
                        Json key = keys[i]; float time = key.F("time"); if (time <= entry.Start || time >= entry.End) continue;
                        double raw = (float)(cycle * duration + (float)(time - entry.Start));
                        if (raw >= current && raw < previous) User(key, raw);
                    }
                    double boundary = (float)(cycle * duration);
                    if (boundary >= current && boundary < previous) Boundary(boundary);
                }
            }
        }
    }
}
