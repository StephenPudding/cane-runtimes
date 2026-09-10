using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Cane.Format
{
    // A small strict parser keeps the Core usable in Unity/IL2CPP without a JSON or reflection dependency.
    internal sealed class Json
    {
        internal static readonly Json Null = new Json(null);
        internal readonly object? Value;
        internal readonly bool IntegerToken;
        private readonly string? largeIntegerLiteral;
        internal Json(object? value, bool integerToken = false)
        {
            Value = value switch { sbyte n => (long)n, byte n => (long)n, short n => (long)n, ushort n => (long)n,
                int n => (long)n, uint n => (long)n, float n => (double)n, _ => value };
            IntegerToken = integerToken || Value is long || Value is ulong;
        }
        private Json(double value, string largeLiteral) : this(value, true) { largeIntegerLiteral = largeLiteral; }
        internal bool IsNull => Value == null;
        internal bool IsObject => Value is Dictionary<string, Json>;
        internal bool IsArray => Value is List<Json>;
        internal bool IsNumber => Value is double || Value is long || Value is ulong;
        internal bool Has(string key) => Value is Dictionary<string, Json> d && d.ContainsKey(key);
        internal Json this[string key] => Value is Dictionary<string, Json> d && d.TryGetValue(key, out var v) ? v : Null;
        internal Json this[int index] => Items[index];
        internal List<Json> Items => Value as List<Json> ?? throw Invalid("Expected an array.");
        internal Dictionary<string, Json> Members => Value as Dictionary<string, Json> ?? throw Invalid("Expected an object.");
        internal IReadOnlyList<Json> ArrayOrEmpty => IsNull ? System.Array.Empty<Json>() : Items;
        internal string String => Value as string ?? throw Invalid("Expected a string.");
        internal string? StringOrNull => IsNull ? null : String;
        internal double Number => Value switch { double n => n, long n => n, ulong n => n, _ => throw Invalid("Expected a number.") };
        internal float Float => checked((float)Number);
        internal bool Bool => Value is bool b ? b : throw Invalid("Expected a boolean.");
        internal string S(string key, string fallback = "") => this[key].IsNull ? fallback : this[key].String;
        internal float F(string key, float fallback = 0) => this[key].IsNull ? fallback : this[key].Float;
        internal bool B(string key, bool fallback = false) => this[key].IsNull ? fallback : this[key].Bool;
        internal int I(string key, int fallback = 0) => this[key].IsNull ? fallback : this[key].Integer;
        internal long L(string key, long fallback = 0) => this[key].IsNull ? fallback : this[key].SignedInteger;
        internal long SignedInteger
        {
            get
            {
                if (Value is long signed) return signed;
                if (Value is ulong unsigned)
                {
                    if (unsigned <= long.MaxValue) return (long)unsigned;
                    throw Invalid("Expected a signed 64-bit integer.");
                }
                // Preserve larger real-valued JSON literals, but never narrow their rounded
                // binary64 approximation back onto a signed integer boundary.
                if (Value is double n && largeIntegerLiteral == null && n >= long.MinValue && n < 9223372036854775808d && Math.Truncate(n) == n) return (long)n;
                throw Invalid("Expected a signed 64-bit integer.");
            }
        }
        internal int Integer
        {
            get
            {
                long n = SignedInteger;
                if (n < int.MinValue || n > int.MaxValue) throw Invalid("Expected a 32-bit integer.");
                return (int)n;
            }
        }
        internal float[] Floats()
        {
            var result = new float[ArrayOrEmpty.Count];
            for (int i = 0; i < result.Length; ++i) result[i] = this[i].Float;
            return result;
        }
        internal string[] Strings()
        {
            var result = new string[ArrayOrEmpty.Count];
            for (int i = 0; i < result.Length; ++i) result[i] = this[i].String;
            return result;
        }
        internal static RuntimeException Invalid(string message) => new RuntimeException(RuntimeErrorCode.InvalidJson, "loadJson", message);
        internal static Json Parse(byte[] utf8)
        {
            if (utf8.Length > 256 * 1024 * 1024) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "loadJson", "Document exceeds 256 MiB.");
            try { return Parse(new UTF8Encoding(false, true).GetString(utf8)); }
            catch (DecoderFallbackException) { throw new RuntimeException(RuntimeErrorCode.InvalidUtf8, "loadJson", "Invalid UTF-8."); }
        }
        internal static Json Parse(string text) => new Parser(text).Parse();
        internal string Encode()
        {
            var result = new StringBuilder(); Write(result); return result.ToString();
        }
        internal void Write(StringBuilder output)
        {
            if (IsNull) { output.Append("null"); return; }
            if (Value is string s) { Quote(output, s); return; }
            if (Value is bool b) { output.Append(b ? "true" : "false"); return; }
            if (Value is long signed) { output.Append(signed.ToString(CultureInfo.InvariantCulture)); return; }
            if (Value is ulong unsigned) { output.Append(unsigned.ToString(CultureInfo.InvariantCulture)); return; }
            if (Value is double n) { output.Append(largeIntegerLiteral ?? NumberText(n, IntegerToken)); return; }
            if (IsArray)
            {
                output.Append('[');
                for (int i = 0; i < Items.Count; i++) { if (i != 0) output.Append(','); Items[i].Write(output); }
                output.Append(']'); return;
            }
            output.Append('{'); bool first = true;
            var keys = new List<string>(Members.Keys); keys.Sort(Utf8Compare);
            foreach (var key in keys)
            {
                if (!first) output.Append(','); first = false; Quote(output, key); output.Append(':'); this[key].Write(output);
            }
            output.Append('}');
        }
        internal static int Utf8Compare(string left, string right)
        {
            byte[] a = Encoding.UTF8.GetBytes(left), b = Encoding.UTF8.GetBytes(right);
            for (int i = 0; i < Math.Min(a.Length, b.Length); i++) if (a[i] != b[i]) return a[i].CompareTo(b[i]);
            return a.Length.CompareTo(b.Length);
        }
        internal static string NumberText(double value, bool integer)
        {
            if (integer) return value.ToString("0", CultureInfo.InvariantCulture);
            string s = value.ToString("R", CultureInfo.InvariantCulture).ToLowerInvariant();
            int e = s.IndexOf('e');
            if (e >= 0)
            {
                int exponent = int.Parse(s.Substring(e + 1), CultureInfo.InvariantCulture);
                return s.Substring(0, e) + "e" + (exponent >= 0 ? "+" : "-") + Math.Abs(exponent).ToString(CultureInfo.InvariantCulture);
            }
            return s.IndexOf('.') < 0 ? s + ".0" : s;
        }
        internal static void Quote(StringBuilder output, string s)
        {
            output.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': output.Append("\\\""); break;
                    case '\\': output.Append("\\\\"); break;
                    case '\b': output.Append("\\b"); break;
                    case '\f': output.Append("\\f"); break;
                    case '\n': output.Append("\\n"); break;
                    case '\r': output.Append("\\r"); break;
                    case '\t': output.Append("\\t"); break;
                    default:
                        if (c < 32) output.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else output.Append(c);
                        break;
                }
            }
            output.Append('"');
        }

        private sealed class Parser
        {
            private readonly string text;
            private int position, nodes;
            internal Parser(string value) { text = value; }
            internal Json Parse()
            {
                if (text.Length > 128 * 1024 * 1024) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "loadJson", "Document exceeds text limit.");
                Json result = Read(0); Space(); if (position != text.Length) Fail("Trailing input."); return result;
            }
            private Json Read(int depth)
            {
                if (depth > 256 || ++nodes > 16777216) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "loadJson", "JSON complexity limit exceeded.");
                Space(); if (position == text.Length) Fail("Unexpected end of input.");
                char c = text[position++];
                if (c == '"') return new Json(ReadString());
                if (c == 'n') { Literal("ull"); return Null; }
                if (c == 't') { Literal("rue"); return new Json(true); }
                if (c == 'f') { Literal("alse"); return new Json(false); }
                if (c == '[')
                {
                    var items = new List<Json>(); Space(); if (Take(']')) return new Json(items);
                    do { items.Add(Read(depth + 1)); Space(); if (Take(']')) return new Json(items); Require(','); } while (true);
                }
                if (c == '{')
                {
                    var members = new Dictionary<string, Json>(StringComparer.Ordinal); Space(); if (Take('}')) return new Json(members);
                    do
                    {
                        Space(); Require('"'); var key = ReadString(); Space(); Require(':');
                        if (members.ContainsKey(key)) Fail("Duplicate object member: " + key);
                        members.Add(key, Read(depth + 1)); Space(); if (Take('}')) return new Json(members); Require(',');
                    } while (true);
                }
                --position; int start = position;
                Take('-');
                if (!Take('0')) { if (!Digit19()) Fail("Invalid number."); while (Digit()) position++; }
                if (Take('.')) { if (!Digit()) Fail("Missing fraction."); while (Digit()) position++; }
                if (Take('e') || Take('E')) { if (!Take('+')) Take('-'); if (!Digit()) Fail("Missing exponent."); while (Digit()) position++; }
                string token = text.Substring(start, position - start);
                bool integer = token.IndexOf('.') < 0 && token.IndexOf('e') < 0 && token.IndexOf('E') < 0;
                if (integer)
                {
                    if (long.TryParse(token, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long signed)) return new Json(signed);
                    if (ulong.TryParse(token, NumberStyles.None, CultureInfo.InvariantCulture, out ulong unsigned)) return new Json(unsigned);
                }
                if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double number) || double.IsInfinity(number) || double.IsNaN(number)) Fail("Non-finite number.");
                return integer ? new Json(number, token) : new Json(number);
            }
            private string ReadString()
            {
                var s = new StringBuilder();
                while (position < text.Length)
                {
                    char c = text[position++];
                    if (c == '"')
                    {
                        for (int i = 0; i < s.Length; i++)
                        {
                            if (char.IsHighSurrogate(s[i])) { if (++i >= s.Length || !char.IsLowSurrogate(s[i])) Fail("Unpaired surrogate."); }
                            else if (char.IsLowSurrogate(s[i])) Fail("Unpaired surrogate.");
                        }
                        return s.ToString();
                    }
                    if (c < 32) Fail("Unescaped control character.");
                    if (c == '\\')
                    {
                        if (position >= text.Length) Fail("Incomplete escape.");
                        c = text[position++];
                        switch (c)
                        {
                            case '"': case '\\': case '/': break;
                            case 'b': c = '\b'; break; case 'f': c = '\f'; break;
                            case 'n': c = '\n'; break; case 'r': c = '\r'; break; case 't': c = '\t'; break;
                            case 'u':
                                if (position + 4 > text.Length || !ushort.TryParse(text.Substring(position, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out ushort code)) { Fail("Invalid Unicode escape."); code = 0; }
                                position += 4; c = (char)code; break;
                            default: Fail("Invalid escape."); break;
                        }
                    }
                    s.Append(c);
                }
                Fail("Unterminated string."); return "";
            }
            private void Literal(string tail) { foreach (char c in tail) Require(c); }
            private bool Digit() => position < text.Length && text[position] >= '0' && text[position] <= '9';
            private bool Digit19() { if (position >= text.Length || text[position] < '1' || text[position] > '9') return false; position++; return true; }
            private bool Take(char c) { if (position >= text.Length || text[position] != c) return false; position++; return true; }
            private void Require(char c) { if (!Take(c)) Fail("Expected '" + c + "'."); }
            private void Space() { while (position < text.Length && (text[position] == ' ' || text[position] == '\t' || text[position] == '\r' || text[position] == '\n')) position++; }
            private void Fail(string message) => throw Invalid(message + " At character " + position + ".");
        }
    }
}
