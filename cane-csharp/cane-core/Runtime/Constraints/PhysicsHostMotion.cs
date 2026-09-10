using System;
using System.Collections.Generic;

namespace Cane
{
    public enum PhysicsHostMotionMode { Move, Teleport, PreserveInertia, ClearInertia }
}

namespace Cane.Constraints
{
    internal sealed partial class PhysicsStore
    {
        // Called only on a detached transaction candidate. Clock identity and time are retained.
        internal void ApplyHostMotion(Affine previous, Affine next, PhysicsHostMotionMode mode, string? constraintId)
        {
            if (mode == PhysicsHostMotionMode.Move) return;
            if (mode == PhysicsHostMotionMode.Teleport)
            {
                if (constraintId == null) { foreach (string id in new List<string>(States.Keys)) States[id] = new PhysicsState(); }
                else if (States.ContainsKey(constraintId)) States[constraintId] = new PhysicsState();
                return;
            }
            float determinant = previous.Determinant;
            if (determinant == 0 || !Numeric.Finite(determinant))
                throw new RuntimeException(RuntimeErrorCode.InvalidState, "setRootTransform", "Preserving Physics history requires an invertible previous root.", "rootTransform");
            float a = previous.D / determinant, b = -previous.B / determinant, c = -previous.C / determinant, d = previous.A / determinant;
            Affine inverse = new Affine(a, b, c, d, -a * previous.Tx - c * previous.Ty, -b * previous.Tx - d * previous.Ty);
            Affine delta = next * inverse;
            if (!delta.IsFinite) throw new RuntimeException(RuntimeErrorCode.NonFinite, "setRootTransform", "Root motion delta overflowed.", "rootTransform");
            foreach (KeyValuePair<string, PhysicsState> entry in States)
            {
                if (constraintId != null && entry.Key != constraintId) continue;
                PhysicsState s = entry.Value;
                Point p = delta.Transform(s.Ux, s.Uy); s.Ux = p.X; s.Uy = p.Y;
                p = delta.Transform(s.Cx, s.Cy); s.Cx = p.X; s.Cy = p.Y;
                p = delta.TransformDirection(s.TipX, s.TipY); s.TipX = p.X; s.TipY = p.Y;
                p = delta.TransformDirection(s.XOffset, s.YOffset); s.XOffset = p.X; s.YOffset = p.Y;
                p = delta.TransformDirection(s.XLag, s.YLag); s.XLag = p.X; s.YLag = p.Y;
                p = delta.TransformDirection(s.XVelocity, s.YVelocity); s.XVelocity = p.X; s.YVelocity = p.Y;
                if (!s.IsFinite) throw new RuntimeException(RuntimeErrorCode.NonFinite, "setRootTransform", "Root motion produced non-finite Physics history.", "rootTransform", entry.Key);
                if (mode == PhysicsHostMotionMode.ClearInertia)
                {
                    s.XLag = s.YLag = s.XVelocity = s.YVelocity = 0;
                    s.RotateLag = s.RotateVelocity = s.ScaleLag = s.ScaleVelocity = 0;
                }
            }
        }
    }
}
