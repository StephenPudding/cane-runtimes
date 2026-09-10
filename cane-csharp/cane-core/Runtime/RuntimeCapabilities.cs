using System;
using System.Collections.Generic;

namespace Cane
{
    public readonly struct RuntimeVersionRange
    {
        public uint MinimumMajor { get; }
        public uint MinimumMinor { get; }
        public uint MaximumMajor { get; }
        public uint MaximumMinor { get; }
        internal RuntimeVersionRange(uint minimumMajor, uint minimumMinor, uint maximumMajor, uint maximumMinor)
        { MinimumMajor = minimumMajor; MinimumMinor = minimumMinor; MaximumMajor = maximumMajor; MaximumMinor = maximumMinor; }
        public bool Contains(uint major, uint minor) =>
            (major > MinimumMajor || (major == MinimumMajor && minor >= MinimumMinor)) &&
            (major < MaximumMajor || (major == MaximumMajor && minor <= MaximumMinor));
    }

    public sealed class RuntimeConformanceInfo
    {
        public string SuiteVersion => "1.8.0";
        public string ManifestSha256 => "ddcd7bb2b5e9dadc00a95d8997886e87c31bc4e5eb5d43811eeabbb2ce98b696";
        public int RequiredCaseCount => 95;
        internal RuntimeConformanceInfo() { }
    }

    /// <summary>Immutable Core metadata. This conformance result does not certify an engine or complete SDK.</summary>
    public sealed class RuntimeCapabilities
    {
        private readonly string[] features = {
            "attachment.bounding-box", "attachment.clipping", "attachment.mesh", "attachment.path", "attachment.point",
            "attachment.region", "attachment.sequence", "blend.add", "blend.multiply", "blend.screen", "constraint.ik",
            "constraint.path", "constraint.physics", "constraint.slider", "constraint.transform", "event", "mesh.deform",
            "mesh.weighted", "skin", "timeline.draw-order", "timeline.skin", "tint.two-color"
        };
        public static RuntimeCapabilities Current { get; } = new RuntimeCapabilities();
        public string ImplementationName => "cane-csharp-runtime";
        public string ImplementationVersion => "0.1.0-alpha.5";
        public string NumericPrecision => "binary32";
        public RuntimeVersionRange RuntimeJson { get; } = new RuntimeVersionRange(1, 0, 1, 0);
        public RuntimeVersionRange Caneb { get; } = new RuntimeVersionRange(1, 0, 1, 0);
        public RuntimeVersionRange Atlas { get; } = new RuntimeVersionRange(1, 0, 1, 0);
        public RuntimeVersionRange RuntimeApi { get; } = new RuntimeVersionRange(1, 0, 1, 3);
        public IReadOnlyList<string> SupportedRuntimeFeatures { get; }
        public ulong ApiFeatureBits => (1UL << 42) - 1;
        public RuntimeConformanceInfo LastPassedConformance { get; } = new RuntimeConformanceInfo();
        private RuntimeCapabilities() { SupportedRuntimeFeatures = Array.AsReadOnly(features); }
        public bool SupportsRuntimeFeature(string? name) => name != null && Array.BinarySearch(features, name, StringComparer.Ordinal) >= 0;
    }
}
