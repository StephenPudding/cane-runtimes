using System;

namespace Cane
{
    public readonly struct Point
    {
        public readonly float X, Y;
        public Point(float x, float y) { X = x; Y = y; }
    }

    /// <summary>Full X-right/Y-up affine. Diagnostic rotation and scale must never replace this matrix.</summary>
    public readonly struct Affine
    {
        public readonly float A, B, C, D, Tx, Ty;
        public Affine(float a, float b, float c, float d, float tx, float ty)
        { A = a; B = b; C = c; D = d; Tx = tx; Ty = ty; }
        public static Affine Identity => new Affine(1, 0, 0, 1, 0, 0);
        public float Determinant => A * D - C * B;
        public bool IsFinite => Numeric.Finite(A) && Numeric.Finite(B) && Numeric.Finite(C) && Numeric.Finite(D) && Numeric.Finite(Tx) && Numeric.Finite(Ty);
        public Point Transform(float x, float y) => new Point(A * x + C * y + Tx, B * x + D * y + Ty);
        public Point TransformDirection(float x, float y) => new Point(A * x + C * y, B * x + D * y);
        public static Affine operator *(Affine l, Affine r) => new Affine(
            l.A * r.A + l.C * r.B, l.B * r.A + l.D * r.B,
            l.A * r.C + l.C * r.D, l.B * r.C + l.D * r.D,
            l.A * r.Tx + l.C * r.Ty + l.Tx, l.B * r.Tx + l.D * r.Ty + l.Ty);
        public bool TryInverse(out Affine inverse)
        {
            float det = Determinant;
            if (det == 0 || !Numeric.Finite(det)) { inverse = default; return false; }
            // Divide each coefficient directly: 1/det may overflow even when every inverse
            // coefficient is finite (for example, two small but invertible scale axes).
            inverse = new Affine(D / det, -B / det, -C / det, A / det, (C * Ty - D * Tx) / det, (B * Tx - A * Ty) / det);
            return inverse.IsFinite;
        }
        public static Affine FromLocal(BoneLocal local)
        {
            float rx = (local.RotationDegrees + local.ShearXDegrees) * Numeric.DegToRad;
            float ry = (local.RotationDegrees + local.ShearYDegrees) * Numeric.DegToRad;
            return new Affine(Numeric.Cos(rx) * local.ScaleX, Numeric.Sin(rx) * local.ScaleX,
                -Numeric.Sin(ry) * local.ScaleY, Numeric.Cos(ry) * local.ScaleY, local.X, local.Y);
        }
        internal static Affine Child(Affine parent, BoneLocal local, string mode)
        {
            if (mode == "normal") return parent * FromLocal(local);
            Point origin = parent.Transform(local.X, local.Y);
            if (mode == "onlyTranslation")
            {
                var axes = FromLocal(local); return new Affine(axes.A, axes.B, axes.C, axes.D, origin.X, origin.Y);
            }
            if (mode == "noRotationOrReflection")
            {
                float pa = parent.A, pb = parent.C, pc = parent.B, pd = parent.D;
                float squared = pa * pa + pc * pc, rotation;
                if (squared > 0.0001f)
                {
                    float scale = Math.Abs(pa * pd - pb * pc) / squared;
                    pb = pc * scale; pd = pa * scale; rotation = Numeric.Atan2(pc, pa) * Numeric.RadToDeg;
                }
                else { pa = pc = 0; rotation = 90 - Numeric.Atan2(pd, pb) * Numeric.RadToDeg; }
                float rx = (local.RotationDegrees + local.ShearXDegrees - rotation) * Numeric.DegToRad;
                float ry = (local.RotationDegrees + local.ShearYDegrees - rotation + 90) * Numeric.DegToRad;
                float la = Numeric.Cos(rx) * local.ScaleX, lc = Numeric.Sin(rx) * local.ScaleX;
                float lb = Numeric.Cos(ry) * local.ScaleY, ld = Numeric.Sin(ry) * local.ScaleY;
                return new Affine(pa * la - pb * lc, pc * la + pd * lc, pa * lb - pb * ld, pc * lb + pd * ld, origin.X, origin.Y);
            }
            float angle = local.RotationDegrees * Numeric.DegToRad, co = Numeric.Cos(angle), si = Numeric.Sin(angle);
            float za = parent.A * co + parent.C * si, zc = parent.B * co + parent.D * si;
            float len = Numeric.Hypot(za, zc);
            if (len > 0.00001f) { za /= len; zc /= len; }
            float reflection = Numeric.Hypot(za, zc);
            if (mode == "noScale" && parent.Determinant < 0) reflection = -reflection;
            float perpendicular = Numeric.Pi / 2 + Numeric.Atan2(zc, za);
            float zb = Numeric.Cos(perpendicular) * reflection, zd = Numeric.Sin(perpendicular) * reflection;
            float sx = local.ShearXDegrees * Numeric.DegToRad, sy = (90 + local.ShearYDegrees) * Numeric.DegToRad;
            float ax = Numeric.Cos(sx) * local.ScaleX, ay = Numeric.Sin(sx) * local.ScaleX;
            float bx = Numeric.Cos(sy) * local.ScaleY, by = Numeric.Sin(sy) * local.ScaleY;
            return new Affine(za * ax + zb * ay, zc * ax + zd * ay, za * bx + zb * by, zc * bx + zd * by, origin.X, origin.Y);
        }
    }

    public readonly struct BoneLocal
    {
        public readonly float X, Y, RotationDegrees, ShearXDegrees, ShearYDegrees, ScaleX, ScaleY;
        public BoneLocal(float x, float y, float rotationDegrees = 0, float scaleX = 1, float scaleY = 1,
            float shearXDegrees = 0, float shearYDegrees = 0)
        { X = x; Y = y; RotationDegrees = rotationDegrees; ScaleX = scaleX; ScaleY = scaleY; ShearXDegrees = shearXDegrees; ShearYDegrees = shearYDegrees; }
        public static BoneLocal Identity => new BoneLocal(0, 0);
        internal float Get(int component)
        {
            switch (component) { case 0: return X; case 1: return Y; case 2: return RotationDegrees; case 3: return ScaleX; case 4: return ScaleY; case 5: return ShearXDegrees; default: return ShearYDegrees; }
        }
        internal BoneLocal With(int component, float value) => new BoneLocal(
            component == 0 ? value : X, component == 1 ? value : Y, component == 2 ? value : RotationDegrees,
            component == 3 ? value : ScaleX, component == 4 ? value : ScaleY,
            component == 5 ? value : ShearXDegrees, component == 6 ? value : ShearYDegrees);
    }

    internal static class Numeric
    {
        internal const float Pi = 3.1415927410125732421875f;
        internal const float DegToRad = Pi / 180f, RadToDeg = 180f / Pi;
        internal const float Epsilon = 1.1920928955078125e-7f;
        internal static float Cos(float v) => (float)Math.Cos(v);
        internal static float Sin(float v) => (float)Math.Sin(v);
        internal static float Atan2(float y, float x) => (float)Math.Atan2(y, x);
        internal static float Hypot(float x, float y) => (float)Math.Sqrt((double)x * x + (double)y * y);
        internal static float Clamp(float x, float low, float high) => Math.Max(low, Math.Min(high, x));
        internal static float Wrap(float degrees) { float r = (degrees + 180) % 360; if (r < 0) r += 360; return r - 180; }
        internal static bool Finite(float x) => !float.IsInfinity(x) && !float.IsNaN(x);
        internal static float RequireFinite(float v, string operation, string field)
        { if (!Finite(v)) throw new RuntimeException(RuntimeErrorCode.InvalidArgument, operation, "Expected a finite scalar.", field); return v; }
    }
}
