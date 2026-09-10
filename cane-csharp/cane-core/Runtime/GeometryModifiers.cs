using System;
using System.Collections.Generic;
using Cane.Animation;
using Cane.Format;

namespace Cane
{
    public readonly struct GeometryModifierContext
    {
        public readonly ulong Sequence;
        public readonly float TimeSeconds;
        public readonly bool Persistent;
        public readonly int OperationIndex;
        internal GeometryModifierContext(ulong sequence, float time, bool persistent, int index)
        { Sequence = sequence; TimeSeconds = time; Persistent = persistent; OperationIndex = index; }
    }
    public sealed class GeometryModifierStats
    {
        public int PersistentOperations { get; internal set; }
        public int TransientOperations { get; internal set; }
        public long AttachmentVisits { get; internal set; }
        public long VertexWrites { get; internal set; }
        public long UvWrites { get; internal set; }
        public long TintWrites { get; internal set; }
        internal GeometryModifierStats Copy() => (GeometryModifierStats)MemberwiseClone();
    }
    internal sealed class GeometryOperation
    {
        internal string Kind = "";
        internal string[] Attachments = Array.Empty<string>(), Slots = Array.Empty<string>();
        internal uint Seed;
        internal double X, Y, AmplitudeX, AmplitudeY, Frequency, Wavelength, Phase, Radius;
        internal Action<GeometryEditor, GeometryModifierContext>? Callback;
        internal bool Matches(RenderAttachment a) => (Attachments.Length == 0 || Array.IndexOf(Attachments, a.AttachmentId) >= 0) && (Slots.Length == 0 || Array.IndexOf(Slots, a.SlotId) >= 0);
        internal GeometryOperation Copy()
        { var copy = (GeometryOperation)MemberwiseClone(); copy.Attachments = (string[])Attachments.Clone(); copy.Slots = (string[])Slots.Clone(); return copy; }
    }
    /// <summary>Ordered Core effects. Configuration copies this builder; subsequent edits cannot change an installed list.</summary>
    public sealed class GeometryModifiers
    {
        internal readonly List<GeometryOperation> Operations = new List<GeometryOperation>();
        public int Count => Operations.Count;
        public void Clear() => Operations.Clear();
        public GeometryModifiers DeterministicJitter(uint seed, double amplitudeX, double amplitudeY, double frequencyHz = 0,
            IReadOnlyList<string>? attachmentIds = null, IReadOnlyList<string>? slotIds = null)
        { Add(new GeometryOperation { Kind = "deterministicJitter", Seed = seed, AmplitudeX = amplitudeX, AmplitudeY = amplitudeY, Frequency = frequencyHz }, attachmentIds, slotIds); return this; }
        public GeometryModifiers RadialWave(double centerX, double centerY, double radialAmplitude, double angularAmplitudeDegrees, double wavelength,
            double phaseDegrees = 0, double speedHz = 0, double radius = 0, IReadOnlyList<string>? attachmentIds = null, IReadOnlyList<string>? slotIds = null)
        { Add(new GeometryOperation { Kind = "radialWave", X = centerX, Y = centerY, AmplitudeX = radialAmplitude, AmplitudeY = angularAmplitudeDegrees, Wavelength = wavelength, Phase = phaseDegrees, Frequency = speedHz, Radius = radius }, attachmentIds, slotIds); return this; }
        public GeometryModifiers Custom(Action<GeometryEditor, GeometryModifierContext> callback, IReadOnlyList<string>? attachmentIds = null, IReadOnlyList<string>? slotIds = null)
        { Add(new GeometryOperation { Kind = "custom", Callback = callback }, attachmentIds, slotIds); return this; }
        private void Add(GeometryOperation operation, IReadOnlyList<string>? attachments, IReadOnlyList<string>? slots)
        { operation.Attachments = CopyIds(attachments); operation.Slots = CopyIds(slots); Operations.Add(operation); }
        private static string[] CopyIds(IReadOnlyList<string>? ids)
        { if (ids == null) return Array.Empty<string>(); var copy = new string[ids.Count]; for (int i = 0; i < copy.Length; i++) copy[i] = ids[i]; return copy; }
        internal GeometryModifiers Copy()
        { var copy = new GeometryModifiers(); foreach (GeometryOperation o in Operations) copy.Operations.Add(o.Copy()); return copy; }
        internal void Validate(RuntimeData data, string operation)
        {
            if (Count > 1000000) throw Invalid(operation, "geometryModifiers.operations", "Too many geometry modifier operations.");
            for (int i = 0; i < Count; i++)
            {
                GeometryOperation o = Operations[i]; string field = "geometryModifiers.operations[" + i + "]";
                ValidateIds(o.Attachments, data.AttachmentIndex, operation, field + ".attachmentIds"); ValidateIds(o.Slots, data.SlotIndex, operation, field + ".slotIds");
                if (o.Kind == "custom") { if (o.Callback == null) throw Invalid(operation, field + ".apply", "A callback is required."); continue; }
                if (o.Kind == "deterministicJitter")
                {
                    Finite(o.AmplitudeX, operation, field + ".amplitudeX"); Finite(o.AmplitudeY, operation, field + ".amplitudeY"); Finite(o.Frequency, operation, field + ".frequencyHz");
                    if (o.Frequency < 0) throw Invalid(operation, field + ".frequencyHz", "Frequency must be non-negative.");
                }
                else
                {
                    Finite(o.X, operation, field + ".centerX"); Finite(o.Y, operation, field + ".centerY"); Finite(o.AmplitudeX, operation, field + ".radialAmplitude");
                    Finite(o.AmplitudeY, operation, field + ".angularAmplitudeDegrees"); Finite(o.Wavelength, operation, field + ".wavelength"); Finite(o.Phase, operation, field + ".phaseDegrees"); Finite(o.Frequency, operation, field + ".speedHz"); Finite(o.Radius, operation, field + ".radius");
                    if (o.Wavelength <= 0) throw Invalid(operation, field + ".wavelength", "Wavelength must be positive.");
                    if (o.Radius < 0) throw Invalid(operation, field + ".radius", "Radius must be non-negative.");
                }
            }
        }
        private static void ValidateIds(string[] ids, Dictionary<string, int> catalog, string op, string field)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < ids.Length; i++)
            {
                string id = ids[i]; string path = field + "[" + i + "]";
                if (string.IsNullOrEmpty(id) || id.IndexOf('\0') >= 0) throw Invalid(op, path, "ID must be non-empty and NUL-free.");
                if (!seen.Add(id)) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, op, "Duplicate target ID.", path, id);
                if (!catalog.ContainsKey(id)) throw new RuntimeException(RuntimeErrorCode.NotFound, op, "Geometry modifier target is missing.", path, id);
            }
        }
        internal static void Finite(double value, string op, string field)
        { if (double.IsNaN(value) || double.IsInfinity(value)) throw Invalid(op, field, "Expected a finite value."); }
        private static RuntimeException Invalid(string op, string field, string message) => new RuntimeException(RuntimeErrorCode.InvalidArgument, op, message, field);
        internal static GeometryModifiers FromDocument(Json document)
        {
            Validation.Closed(document, "operations", "operations"); var result = new GeometryModifiers();
            foreach (Json row in document["operations"].Items)
            {
                string filters = "type attachmentIds slotIds "; string[] a = row["attachmentIds"].Strings(), s = row["slotIds"].Strings();
                if (row.S("type") == "deterministicJitter")
                {
                    Validation.Closed(row, filters + "seed amplitudeX amplitudeY frequencyHz", "type seed amplitudeX amplitudeY"); double seed = row["seed"].Number;
                    if (seed < 0 || seed > uint.MaxValue || Math.Truncate(seed) != seed) throw Invalid("geometryModifier", "seed", "Seed must be uint32.");
                    result.DeterministicJitter((uint)seed, row["amplitudeX"].Number, row["amplitudeY"].Number, row.Has("frequencyHz") ? row["frequencyHz"].Number : 0, a, s);
                }
                else if (row.S("type") == "radialWave")
                {
                    Validation.Closed(row, filters + "centerX centerY radialAmplitude angularAmplitudeDegrees wavelength phaseDegrees speedHz radius", "type centerX centerY radialAmplitude angularAmplitudeDegrees wavelength");
                    result.RadialWave(row["centerX"].Number, row["centerY"].Number, row["radialAmplitude"].Number, row["angularAmplitudeDegrees"].Number, row["wavelength"].Number,
                        row.Has("phaseDegrees") ? row["phaseDegrees"].Number : 0, row.Has("speedHz") ? row["speedHz"].Number : 0, row.Has("radius") ? row["radius"].Number : 0, a, s);
                }
                else throw Invalid("geometryModifier", "type", "Unknown serialized geometry modifier type.");
            }
            return result;
        }
    }
    public sealed partial class RuntimePlayer
    {
        public GeometryModifierStats LastGeometryModifierStats => Frame.GeometryStats.Copy();
        public GeometryModifiers QueryGeometryModifiers() => host.Geometry.Copy();
        public RuntimeFrame SetGeometryModifiers(GeometryModifiers modifiers)
        {
            if (modifiers == null) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, "setGeometryModifiers", "Modifiers are required.");
            GeometryModifiers copy = modifiers.Copy(); copy.Validate(data, "setGeometryModifiers"); return Configure("setGeometryModifiers", configure: h => h.Geometry = copy);
        }
        public RuntimeFrame ClearGeometryModifiers() => SetGeometryModifiers(new GeometryModifiers());
        public RuntimeFrame ApplyWithGeometryModifiers(GeometryModifiers modifiers, SamplingOptions sampling = default) => ApplyFrameModifiers(null, modifiers, sampling, "applyWithGeometryModifiers");
        public RuntimeFrame ApplyWithFrameModifiers(PoseModifiers? poseModifiers, GeometryModifiers? geometryModifiers, SamplingOptions sampling = default)
            => ApplyFrameModifiers(poseModifiers?.Document, geometryModifiers, sampling, "applyWithFrameModifiers");
        internal RuntimeFrame ApplyFrameModifiers(Json? poseModifiers, GeometryModifiers? geometryModifiers, SamplingOptions sampling, string op)
        {
            sampling.Validate(op); GeometryModifiers? geometry = geometryModifiers?.Copy(); geometry?.Validate(data, op);
            try
            {
                Playback state = playback.Clone(); RuntimeFrame frame = Evaluate(state, host, NextSequence(op), sampling, out Pose pose, poseModifiers, op, geometryModifiers: geometry);
                playback = state; Frame = frame; publishedPose = pose; return frame;
            }
            catch (RuntimeException e) { throw Reframe(e, op); }
        }
        public RuntimeStep AdvanceWithGeometryModifiers(float deltaSeconds, GeometryModifiers modifiers, SamplingOptions sampling = default)
            => AdvanceWithFrameModifiers(deltaSeconds, null, modifiers, sampling);
        public RuntimeStep AdvanceWithFrameModifiers(float deltaSeconds, PoseModifiers? poseModifiers, GeometryModifiers? geometryModifiers, SamplingOptions sampling = default)
        {
            GeometryModifiers? geometry = geometryModifiers?.Copy(); geometry?.Validate(data, "advanceWithFrameModifiers");
            return AdvanceInternal(deltaSeconds, true, sampling, poseModifiers?.Document, "advanceWithFrameModifiers", geometry);
        }
    }
}
