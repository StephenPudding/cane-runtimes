using System;
using UnityEngine;

namespace Cane.Unity
{
    internal static class UnityObjects
    {
#if UNITY_EDITOR
        private static readonly System.Collections.Generic.HashSet<UnityEngine.Object> Owned = new System.Collections.Generic.HashSet<UnityEngine.Object>();

        static UnityObjects()
        {
            UnityEditor.AssemblyReloadEvents.beforeAssemblyReload += ReleaseDomainObjects;
            UnityEditor.EditorApplication.quitting += ReleaseDomainObjects;
        }

        private static void ReleaseDomainObjects()
        {
            // These native objects are not serialized. Their managed owners disappear on reload,
            // even when Unity does not call OnDestroy on the owning scene component.
            foreach (UnityEngine.Object value in Owned)
                if (value) UnityEngine.Object.DestroyImmediate(value);
            Owned.Clear();
        }
#endif

        internal static T Own<T>(T value) where T : UnityEngine.Object
        {
#if UNITY_EDITOR
            Owned.Add(value);
#endif
            return value;
        }

        internal static void Release(UnityEngine.Object value)
        {
#if UNITY_EDITOR
            if (!ReferenceEquals(value, null)) Owned.Remove(value);
#endif
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        internal static RuntimeException Error(string operation, string message, string field = null, string id = null)
            => new RuntimeException(RuntimeErrorCode.InvalidState, operation, message, field, id);

        internal static Matrix4x4 Matrix(Affine value)
        {
            var result = Matrix4x4.identity;
            result.m00 = value.A; result.m10 = value.B;
            result.m01 = value.C; result.m11 = value.D;
            result.m03 = value.Tx; result.m13 = value.Ty;
            return result;
        }

        internal static float Linear(byte value)
        {
            float v = value / 255f;
            return v <= .04045f ? v / 12.92f : (float)Math.Pow((v + .055f) / 1.055f, 2.4);
        }
    }
}
