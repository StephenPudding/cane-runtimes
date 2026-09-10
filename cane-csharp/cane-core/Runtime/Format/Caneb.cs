using System;
using System.Collections.Generic;
using System.Text;

namespace Cane.Format
{
    internal sealed class Caneb
    {
        private readonly byte[] bytes;
        private int position, limit;
        private string[] strings = Array.Empty<string>();
        private Caneb(byte[] input) { bytes = input; limit = input.Length; }
        internal static Json Decode(byte[] bytes) => Decode(bytes, out _);
        internal static Json Decode(byte[] bytes, out string[] optionalSections)
        { var reader = new Caneb(bytes); return reader.Document(out optionalSections); }
        private RuntimeException Error(string message, RuntimeErrorCode code = RuntimeErrorCode.MalformedInput) => new RuntimeException(code, "loadCaneb", message);
        private void Need(int count) { if (count < 0 || position > limit - count) throw Error("CANEB input is truncated."); }
        private byte Byte() { Need(1); return bytes[position++]; }
        private ushort U16() { Need(2); ushort v = (ushort)(bytes[position] | bytes[position + 1] << 8); position += 2; return v; }
        private uint U32() { Need(4); uint v = (uint)bytes[position] | (uint)bytes[position + 1] << 8 | (uint)bytes[position + 2] << 16 | (uint)bytes[position + 3] << 24; position += 4; return v; }
        private ulong U64() { ulong low = U32(); return low | (ulong)U32() << 32; }
        private ulong Varint()
        {
            ulong value = 0; int shift = 0;
            while (true)
            {
                byte b = Byte(); if (shift == 63 && b > 1) throw Error("CANEB varint overflows."); value |= (ulong)(b & 127) << shift;
                if ((b & 128) == 0) { if (shift > 0 && b == 0) throw Error("CANEB varint is not shortest."); return value; }
                shift += 7; if (shift > 63) throw Error("CANEB varint is too long.");
            }
        }
        private int Count(ulong count, int maximum)
        { if (count > (ulong)maximum) throw Error("CANEB resource limit exceeded.", RuntimeErrorCode.ResourceLimit); return (int)count; }
        private void Seek(int offset, int length) { position = offset; limit = checked(offset + length); }
        private void End() { if (position != limit) throw Error("Trailing bytes in CANEB section."); }
        private string String(ulong index)
        { if (index >= (ulong)strings.Length) throw Error("Invalid CANEB string index."); return strings[(int)index]; }

        private Json Document(out string[] optionalSections)
        {
            if (bytes.Length < 32) throw Error("CANEB header is truncated.");
            byte[] magic = { 67, 65, 78, 69, 66, 13, 10, 26 };
            foreach (byte b in magic) if (Byte() != b) throw Error("Invalid CANEB magic.");
            if (U16() != 1 || U16() != 0) throw Error("Unsupported CANEB version.", RuntimeErrorCode.UnsupportedVersion);
            if (Byte() != 1) throw Error("Unsupported CANEB byte order.", RuntimeErrorCode.UnsupportedVersion);
            if (Byte() != 0 || U16() != 32) throw Error("Invalid CANEB header.");
            int count = Count(U32(), 64); if (count == 0 || U32() != 32 || U64() != (ulong)bytes.Length) throw Error("Invalid CANEB section table/header size.");
            int tableEnd = checked(32 + count * 32); Need(count * 32);
            var sections = new Dictionary<string, (int Offset, int Length, uint Flags)>(StringComparer.Ordinal);
            var intervals = new List<(int Offset, int Length)>(); var warnings = new List<string>(); string previousTag = "";
            for (int i = 0; i < count; i++)
            {
                Need(4); string tag = Encoding.ASCII.GetString(bytes, position, 4); position += 4; uint flags = U32();
                ulong offset = U64(), length = U64(), decodedLength = U64();
                if ((flags & ~1u) != 0 || Json.Utf8Compare(previousTag, tag) >= 0 || length != decodedLength || offset < (ulong)tableEnd || offset % 8 != 0 || offset > (ulong)bytes.Length || length > (ulong)bytes.Length - offset) throw Error("CANEB section range/order is invalid.");
                previousTag = tag; sections.Add(tag, ((int)offset, (int)length, flags)); intervals.Add(((int)offset, (int)length));
                if (tag != "DATA" && tag != "IDMP" && tag != "STRS")
                { if ((flags & 1) != 0) throw Error("Unknown required CANEB section: " + tag, RuntimeErrorCode.UnsupportedFeature); warnings.Add(tag); }
            }
            intervals.Sort((a, b) => a.Offset.CompareTo(b.Offset)); int consumed = tableEnd;
            foreach (var interval in intervals)
            {
                if (interval.Offset < consumed) throw Error("Overlapping CANEB sections.");
                for (int i = consumed; i < interval.Offset; i++) if (bytes[i] != 0) throw Error("Nonzero CANEB alignment padding.");
                consumed = interval.Offset + interval.Length;
            }
            for (int i = consumed; i < bytes.Length; i++) if (bytes[i] != 0) throw Error("Nonzero CANEB trailing padding.");
            foreach (var tag in new[] { "DATA", "IDMP", "STRS" }) if (!sections.TryGetValue(tag, out var section) || section.Flags != 1) throw Error("Missing required CANEB section: " + tag);
            var strs = sections["STRS"]; Seek(strs.Offset, strs.Length); ReadStrings();
            var data = sections["DATA"]; Seek(data.Offset, data.Length); Json document = Value(0); End();
            var idmp = sections["IDMP"]; Seek(idmp.Offset, idmp.Length); VerifyIds(document); End();
            optionalSections = warnings.ToArray(); return document;
        }
        private void ReadStrings()
        {
            int count = Count(U32(), 1000000); if (U32() != 0) throw Error("Invalid STRS reserved field.");
            Need(checked((count + 1) * 4)); int[] offsets = new int[count + 1];
            for (int i = 0; i <= count; i++) offsets[i] = Count(U32(), 512 * 1024 * 1024);
            int blobStart = position; if (offsets[0] != 0 || offsets[count] != limit - blobStart) throw Error("Invalid STRS offsets.");
            strings = new string[count]; var utf8 = new UTF8Encoding(false, true);
            for (int i = 0; i < count; i++)
            {
                int length = offsets[i + 1] - offsets[i]; if (length < 0 || length > 16 * 1024 * 1024) throw Error("Invalid CANEB string range.");
                try { strings[i] = utf8.GetString(bytes, blobStart + offsets[i], length); }
                catch (DecoderFallbackException) { throw Error("Invalid CANEB UTF-8.", RuntimeErrorCode.InvalidUtf8); }
                if (strings[i].IndexOf('\0') >= 0 || (i > 0 && Json.Utf8Compare(strings[i - 1], strings[i]) >= 0)) throw Error("CANEB strings are not sorted and unique.");
            }
            position = limit;
        }
        private Json Value(int depth)
        {
            if (depth > 256) throw Error("CANEB nesting limit exceeded.", RuntimeErrorCode.ResourceLimit);
            switch (Byte())
            {
                case 0: return Json.Null;
                case 1: return new Json(false);
                case 2: return new Json(true);
                case 3: { ulong v = Varint(); long n = (long)(v >> 1) ^ -(long)(v & 1); return new Json(n); }
                case 4: return new Json(Varint());
                case 5:
                    uint bits = U32(); float f = BitConverter.Int32BitsToSingle((int)bits);
                    if (!Numeric.Finite(f)) throw Error("Non-finite CANEB scalar."); return new Json((double)f);
                case 6:
                    double d = BitConverter.Int64BitsToDouble((long)U64());
                    if (double.IsNaN(d) || double.IsInfinity(d)) throw Error("Non-finite CANEB scalar."); return new Json(d);
                case 7: return new Json(String(Varint()));
                case 8:
                    int count = Count(Varint(), 16777216); Need(count); var items = new List<Json>(count);
                    for (int i = 0; i < count; i++) items.Add(Value(depth + 1)); return new Json(items);
                case 9:
                    int memberCount = Count(Varint(), 16777216); Need(checked(memberCount * 2)); var members = new Dictionary<string, Json>(memberCount, StringComparer.Ordinal); string? previous = null;
                    for (int i = 0; i < memberCount; i++)
                    { string key = String(Varint()); if (previous != null && Json.Utf8Compare(previous, key) >= 0) throw Error("CANEB object keys are not sorted and unique."); previous = key; members.Add(key, Value(depth + 1)); }
                    return new Json(members);
                default: throw Error("Invalid CANEB DATA token.");
            }
        }
        private void VerifyIds(Json doc)
        {
            int count = Count(U32(), 16777216); if (U32() != 0 || (long)count * 16 != limit - position) throw Error("Invalid IDMP section.");
            var expected = new List<(int Kind, int Index, string Id)> { (1, 0, doc["skeleton"].S("skeletonId")) };
            string[] arrays = { "atlases", "images", "audios", "fonts", "bones", "slots", "attachments", "constraints", "skins", "events", "animations" };
            for (int kind = 2; kind <= 12; kind++)
            {
                string idKey = kind == 2 ? "atlasId" : kind == 3 ? "imageId" : kind == 4 ? "audioId" : kind == 5 ? "fontId" : "id"; int index = 0;
                foreach (Json item in doc[arrays[kind - 2]].ArrayOrEmpty) expected.Add((kind, index++, item.S(idKey)));
            }
            if (count != expected.Count) throw Error("IDMP record count does not match DATA.");
            for (int i = 0; i < count; i++)
            {
                int kind = U16(); if (U16() != 0) throw Error("Invalid IDMP reserved field."); uint index = U32(); string id = String(U32()); if (U32() != 0) throw Error("Invalid IDMP reserved field.");
                var e = expected[i]; if (kind != e.Kind || index != e.Index || id != e.Id) throw Error("CANEB IDMP does not match declaration-order DATA identities.");
            }
        }
    }
}
