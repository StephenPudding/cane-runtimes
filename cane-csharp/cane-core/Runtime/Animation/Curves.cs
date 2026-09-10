using System;
using System.Collections.Generic;
using Cane.Format;

namespace Cane.Animation
{
    internal readonly struct Curve
    {
        private readonly int kind;
        private readonly float x1, y1, x2, y2;
        private readonly bool monotonic;
        internal Curve(Json source, string property)
        {
            if (source.S("type") == "properties") source = source["properties"].Has(property) ? source["properties"][property] : source["default"];
            kind = source.IsNull || source.Value is string s && s == "linear" ? 0 : source.Value is string ? 1 : source.S("type") == "bezier" ? 2 : 3;
            x1 = source.F("cx1"); x2 = source.F("cx2"); y1 = source.F(kind == 3 ? "dy1" : "cy1"); y2 = source.F(kind == 3 ? "dy2" : "cy2");
            double a = 1 + 3.0 * x1 - 3.0 * x2, b = 2.0 * (x2 - 2.0 * x1), c = x1;
            monotonic = c >= 0 && 1 - x2 >= 0;
            if (monotonic && a > 0) { double vertex = -b / (2 * a); if (vertex > 0 && vertex < 1 && a * vertex * vertex + b * vertex + c < 0) monotonic = false; }
        }
        internal float Sample(float from, float to, float progress, bool angular, bool stepped)
        {
            float p = Numeric.Clamp(progress, 0, 1);
            if (p <= 0) return from; if (p >= 1) return to; if (stepped || kind == 1) return from;
            if (kind == 0) return from + (angular ? Numeric.Wrap(to - from) : to - from) * p;
            float start = kind == 2 ? 0 : from, end = kind == 2 ? 1 : to;
            float cy1 = kind == 2 ? y1 : from + y1, cy2 = kind == 2 ? y2 : to + y2;
            float result;
            if (monotonic)
            {
                double low = 0, high = 1, u = p;
                for (int i = 0; i < 24; i++) { u = (low + high) * 0.5; if (Bezier(0, x1, x2, 1, u) < p) low = u; else high = u; }
                result = (float)Bezier(start, cy1, cy2, end, u);
            }
            else
            {
                double previousX = 0, previousY = start; result = end;
                for (int step = 1; step <= 10; step++)
                {
                    double u = step / 10.0, x = step == 10 ? 1 : Bezier(0, x1, x2, 1, u), y = step == 10 ? end : Bezier(start, cy1, cy2, end, u);
                    if (x >= p || step == 10) { result = (float)(x == previousX ? y : previousY + (p - previousX) / (x - previousX) * (y - previousY)); break; }
                    previousX = x; previousY = y;
                }
            }
            if (kind == 2) return from + (angular ? Numeric.Wrap(to - from) : to - from) * result;
            return angular ? from + Numeric.Wrap(result - from) : result;
        }
        private static double Bezier(double a, double b, double c, double d, double u)
        { double t = 1 - u; return t * t * t * a + 3 * t * t * u * b + 3 * t * u * u * c + u * u * u * d; }
    }

    internal sealed class Channel
    {
        internal readonly struct Key
        {
            internal readonly float Time, Value;
            internal readonly Curve Curve;
            internal Key(float time, float value, Curve curve) { Time = time; Value = value; Curve = curve; }
        }
        internal readonly Key[] Keys;
        internal bool HasKeys => Keys.Length != 0;
        internal Channel(SortedDictionary<float, Key> groups)
        { Keys = new Key[groups.Count]; int i = 0; foreach (var pair in groups) Keys[i++] = pair.Value; }
        internal static Channel From(Json keys, string field, string property, Func<Json, float>? getter = null)
        {
            var groups = new SortedDictionary<float, Key>();
            foreach (var key in keys.ArrayOrEmpty)
            {
                if (getter == null && key[field].IsNull) continue;
                float time = key.F("time"); groups[time] = new Key(time, getter == null ? key.F(field) : getter(key), new Curve(key["curve"], property));
            }
            return new Channel(groups);
        }
        internal static Channel Merged(Json pair, Json scalar, string axis)
        {
            var groups = new SortedDictionary<float, Key>();
            // Native bone axes query x/y; scale_x/scale_y belong to Region transform keys.
            foreach (var key in pair.ArrayOrEmpty) { float t = key.F("time"); groups[t] = new Key(t, key.F(axis), new Curve(key["curve"], axis)); }
            foreach (var key in scalar.ArrayOrEmpty) { float t = key.F("time"); groups[t] = new Key(t, key.F("value"), new Curve(key["curve"], axis)); }
            return new Channel(groups);
        }
        internal float? Sample(float time, bool angular = false, bool stepped = false)
        {
            if (Keys.Length == 0 || time < Keys[0].Time) return null;
            int low = 0, high = Keys.Length;
            while (low < high) { int mid = low + (high - low) / 2; if (Keys[mid].Time <= time) low = mid + 1; else high = mid; }
            Key current = Keys[low - 1]; if (low == Keys.Length || time == current.Time) return current.Value;
            Key next = Keys[low]; float progress = (time - current.Time) / (next.Time - current.Time);
            return current.Curve.Sample(current.Value, next.Value, progress, angular, stepped);
        }
    }
    internal static class KeySampling
    {
        internal static Json Discrete(Json keys, float time, string? requiredField = null)
        {
            Json value = Json.Null;
            foreach (Json k in keys.ArrayOrEmpty) { if (k.F("time") > time) break; if (requiredField == null || !k[requiredField].IsNull) value = k; }
            return value;
        }
        internal static float Blend(float current, float setup, float sample, float alpha, bool additive, bool angular = false)
        { if (alpha == 0) return current; float delta = sample - (additive ? setup : current); return current + (angular ? Numeric.Wrap(delta) : delta) * alpha; }
        internal static int Pingpong(int index, int count)
        { if (count <= 1) return 0; int cycle = count * 2 - 2, phase = index % cycle; return phase < count ? phase : cycle - phase; }
    }
}
