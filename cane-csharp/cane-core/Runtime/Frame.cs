using System;
using System.Collections.Generic;

namespace Cane
{
    public readonly struct Rgb
    {
        public readonly byte R, G, B;
        public Rgb(byte r, byte g, byte b) { R = r; G = g; B = b; }
        public static Rgb White => new Rgb(255, 255, 255);
        internal static Rgb Parse(string s)
        {
            string digits = s.StartsWith("#", StringComparison.Ordinal) ? s.Substring(1) : s;
            if (digits.Length != 6 || !int.TryParse(digits, System.Globalization.NumberStyles.HexNumber,
                System.Globalization.CultureInfo.InvariantCulture, out int n))
                throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "loadJson", "Color must be #RRGGBB.");
            return new Rgb((byte)(n >> 16), (byte)(n >> 8), (byte)n);
        }
        internal static Rgb Compose(Rgb slot, Rgb attachment) => new Rgb(
            (byte)((slot.R * attachment.R + 127) / 255), (byte)((slot.G * attachment.G + 127) / 255), (byte)((slot.B * attachment.B + 127) / 255));
    }

    public readonly struct FinalTint
    {
        public readonly Rgb Light;
        public readonly Rgb? Dark;
        public readonly float Alpha;
        public bool TwoColor => Dark.HasValue;
        public FinalTint(Rgb light, float alpha, Rgb? dark = null) { Light = light; Alpha = alpha; Dark = dark; }
    }

    public sealed class TextureDescriptor
    {
        public string ImageId { get; }
        public string Path { get; }
        public string? AtlasId { get; }
        public string? PageId { get; }
        public string? RegionId { get; }
        public string ColorSpace { get; }
        public string AlphaMode { get; }
        public int Width { get; }
        public int Height { get; }
        internal TextureDescriptor(string imageId, string path, int width, int height, string? atlasId = null,
            string? pageId = null, string? regionId = null, string colorSpace = "srgb", string alphaMode = "straight")
        { ImageId = imageId; Path = path; Width = width; Height = height; AtlasId = atlasId; PageId = pageId; RegionId = regionId; ColorSpace = colorSpace; AlphaMode = alphaMode; }
    }

    public sealed class BonePose
    {
        public string Id { get; }
        public Affine Matrix { get; }
        public BoneLocal Local { get; }
        public float RotationDegrees => Numeric.Atan2(Matrix.B, Matrix.A) * Numeric.RadToDeg;
        public float ScaleX => Numeric.Hypot(Matrix.A, Matrix.B);
        public float ScaleY => Numeric.Hypot(Matrix.C, Matrix.D);
        internal BonePose(string id, Affine matrix, BoneLocal local) { Id = id; Matrix = matrix; Local = local; }
    }

    public sealed class RenderAttachment
    {
        public int DrawIndex { get; }
        public long SourceZIndex { get; }
        public string SlotId { get; }
        public string AttachmentId { get; }
        public string ImageId => Texture.ImageId;
        public string GeometryKind { get; }
        public string BlendMode { get; }
        public TextureDescriptor Texture { get; }
        public FinalTint Tint { get; }
        public Affine SourceAffine { get; }
        public IReadOnlyList<float> WorldVerticesXy { get; }
        public IReadOnlyList<float> Uvs { get; }
        public IReadOnlyList<int> Indices { get; }
        public IReadOnlyList<string> AuthoredTriangleFacing { get; }
        public string FrontFace => "counterClockwise";
        internal RenderAttachment(int drawIndex, long sourceZIndex, string slotId, string attachmentId,
            string geometryKind, string blendMode, TextureDescriptor texture, FinalTint tint, Affine affine,
            float[] vertices, float[] uvs, int[] indices, string[] facing)
            : this(drawIndex, sourceZIndex, slotId, attachmentId, geometryKind, blendMode, texture, tint, affine,
                Array.AsReadOnly(vertices), Array.AsReadOnly(uvs), Array.AsReadOnly(indices), Array.AsReadOnly(facing)) { }
        // Callers may share previously published immutable views, never mutable work buffers.
        internal RenderAttachment(int drawIndex, long sourceZIndex, string slotId, string attachmentId,
            string geometryKind, string blendMode, TextureDescriptor texture, FinalTint tint, Affine affine,
            IReadOnlyList<float> vertices, IReadOnlyList<float> uvs, IReadOnlyList<int> indices, IReadOnlyList<string> facing)
        {
            DrawIndex = drawIndex; SourceZIndex = sourceZIndex; SlotId = slotId; AttachmentId = attachmentId;
            GeometryKind = geometryKind; BlendMode = blendMode; Texture = texture; Tint = tint; SourceAffine = affine;
            WorldVerticesXy = vertices; Uvs = uvs; Indices = indices; AuthoredTriangleFacing = facing;
        }
    }

    public sealed class RenderPacket
    {
        public IReadOnlyList<RenderAttachment> Attachments { get; }
        public string UvOrigin => "topLeft";
        public string TintColorSpace => "srgb";
        public string TintAlphaMode => "straight";
        internal RenderPacket(RenderAttachment[] attachments) { Attachments = Array.AsReadOnly(attachments); }
    }

    public sealed class RuntimeFrame
    {
        internal EvaluationStats Stats = new EvaluationStats();
        internal GeometryModifierStats GeometryStats = new GeometryModifierStats();
        public ulong Sequence { get; }
        public float TimeSeconds { get; }
        public IReadOnlyList<BonePose> Bones { get; }
        public IReadOnlyList<string> ActiveSkinIds { get; }
        public IReadOnlyList<string> SampledSkinIds { get; }
        public RenderPacket RenderPacket { get; }
        internal RuntimeFrame(ulong sequence, float time, BonePose[] bones, string[] activeSkins, string[] sampledSkins, RenderPacket packet)
        { Sequence = sequence; TimeSeconds = time; Bones = Array.AsReadOnly(bones); ActiveSkinIds = Array.AsReadOnly(activeSkins); SampledSkinIds = Array.AsReadOnly(sampledSkins); RenderPacket = packet; }
    }

    public sealed class AnimationInfo
    {
        public string Id { get; }
        public string Name { get; }
        public float Duration { get; }
        public float Fps { get; }
        internal AnimationInfo(string id, string name, float duration, float fps) { Id = id; Name = name; Duration = duration; Fps = fps; }
    }

    public sealed class RuntimeEvent
    {
        public string Kind { get; }
        public int TrackIndex { get; }
        public string? AnimationId { get; }
        public string? EventId { get; }
        public string Name { get; }
        public float TimeSeconds { get; }
        public long? IntegerValue { get; }
        public float? NumberValue { get; }
        public string? StringValue { get; }
        public string? AudioId { get; }
        public float Volume { get; }
        public float Balance { get; }
        internal RuntimeEvent(string kind, int track, string? animation, float time, string name = "", string? eventId = null,
            long? integer = null, float? number = null, string? text = null, string? audioId = null, float volume = 1, float balance = 0)
        { Kind = kind; TrackIndex = track; AnimationId = animation; TimeSeconds = time; Name = name; EventId = eventId; IntegerValue = integer; NumberValue = number; StringValue = text; AudioId = audioId; Volume = volume; Balance = balance; }
    }
}
