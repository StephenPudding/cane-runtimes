using System;
using UnityEngine;

namespace Cane.Unity
{
    // Engine representation only: two Unity TRS nodes represent one final affine
    // matrix, including shear/reflection/rank loss. No runtime pose is evaluated here.
    internal static class CaneAffineProjection
    {
        private struct D3
        {
            internal double X, Y, Z;
            internal D3(double x, double y, double z) { X = x; Y = y; Z = z; }
            public static D3 operator +(D3 a, D3 b) => new D3(a.X+b.X, a.Y+b.Y, a.Z+b.Z);
            public static D3 operator -(D3 a, D3 b) => new D3(a.X-b.X, a.Y-b.Y, a.Z-b.Z);
            public static D3 operator *(D3 a, double b) => new D3(a.X*b, a.Y*b, a.Z*b);
            internal static double Dot(D3 a, D3 b) => a.X*b.X+a.Y*b.Y+a.Z*b.Z;
            internal static D3 Cross(D3 a, D3 b) => new D3(a.Y*b.Z-a.Z*b.Y, a.Z*b.X-a.X*b.Z, a.X*b.Y-a.Y*b.X);
            internal double Length => Math.Sqrt(Dot(this, this));
        }
        private static void Rotate(ref D3 a, ref D3 b, ref D3 va, ref D3 vb)
        {
            double aa = D3.Dot(a,a), bb = D3.Dot(b,b), ab = D3.Dot(a,b);
            if (ab == 0 || Math.Abs(ab) <= 1e-14 * Math.Sqrt(aa*bb)) return;
            double z = (bb-aa)/(2*ab), t = (z < 0 ? -1 : 1)/(Math.Abs(z)+Math.Sqrt(1+z*z));
            double c = 1/Math.Sqrt(1+t*t), s = t*c;
            D3 old = a; a = a*c-b*s; b = old*s+b*c;
            old = va; va = va*c-vb*s; vb = old*s+vb*c;
        }
        private static void Sort(ref D3 a, ref D3 b, ref D3 va, ref D3 vb)
        {
            if (D3.Dot(a,a) >= D3.Dot(b,b)) return;
            D3 t=a; a=b; b=t; t=va; va=vb; vb=t;
        }
        private static Quaternion Rotation(D3 x, D3 y, D3 z)
        {
            var m = Matrix4x4.identity;
            m.SetColumn(0, new Vector4((float)x.X,(float)x.Y,(float)x.Z,0));
            m.SetColumn(1, new Vector4((float)y.X,(float)y.Y,(float)y.Z,0));
            m.SetColumn(2, new Vector4((float)z.X,(float)z.Y,(float)z.Z,0));
            return m.rotation;
        }
        internal static void RequireAffine(Matrix4x4 matrix, string field)
        {
            for (int i=0;i<16;i++) if (float.IsNaN(matrix[i]) || float.IsInfinity(matrix[i]))
                throw UnityObjects.Error("followPose", "Follower matrices must be finite.", field);
            if (matrix.m30 != 0 || matrix.m31 != 0 || matrix.m32 != 0 || matrix.m33 != 1)
                throw UnityObjects.Error("followPose", "Follower matrices must be affine.", field);
        }
        internal static Matrix4x4 Inverse(Matrix4x4 matrix)
        {
            RequireAffine(matrix, "parent");
            Matrix4x4 inverse = matrix.inverse;
            RequireAffine(inverse, "parent.inverse");
            Matrix4x4 identity = matrix*inverse;
            for (int i=0;i<16;i++) if (Math.Abs(identity[i]-Matrix4x4.identity[i]) > .002f)
                throw UnityObjects.Error("followPose", "Follower parent has no stable inverse.", "parent");
            return inverse;
        }
        internal static void Decompose(Matrix4x4 matrix, out Vector3 position, out Quaternion left, out Vector3 scale, out Quaternion right)
        {
            RequireAffine(matrix, "local"); position = matrix.GetColumn(3);
            double maximum=0;
            for (int row=0;row<3;row++) for (int column=0;column<3;column++) maximum=Math.Max(maximum,Math.Abs(matrix[row,column]));
            if (maximum == 0) { left=right=Quaternion.identity; scale=Vector3.zero; return; }
            var a=new D3(matrix.m00/maximum,matrix.m10/maximum,matrix.m20/maximum);
            var b=new D3(matrix.m01/maximum,matrix.m11/maximum,matrix.m21/maximum);
            var c=new D3(matrix.m02/maximum,matrix.m12/maximum,matrix.m22/maximum);
            var va=new D3(1,0,0); var vb=new D3(0,1,0); var vc=new D3(0,0,1);
            // One-sided Jacobi preserves small singular values without forming M^T M.
            for (int sweep=0;sweep<16;sweep++)
            { Rotate(ref a,ref b,ref va,ref vb); Rotate(ref a,ref c,ref va,ref vc); Rotate(ref b,ref c,ref vb,ref vc); }
            Sort(ref a,ref b,ref va,ref vb); Sort(ref b,ref c,ref vb,ref vc); Sort(ref a,ref b,ref va,ref vb);
            if (D3.Dot(D3.Cross(va,vb),vc)<0) { c=c*-1; vc=vc*-1; }
            D3 x=a*(1/a.Length), y=b-x*D3.Dot(x,b);
            if (y.Length == 0)
            {
                D3 axis = Math.Abs(x.X)<Math.Abs(x.Y)
                    ? (Math.Abs(x.X)<Math.Abs(x.Z) ? new D3(1,0,0) : new D3(0,0,1))
                    : (Math.Abs(x.Y)<Math.Abs(x.Z) ? new D3(0,1,0) : new D3(0,0,1));
                y=axis-x*D3.Dot(x,axis);
            }
            y=y*(1/y.Length); D3 zAxis=D3.Cross(x,y);
            left=Rotation(x,y,zAxis); right=Quaternion.Inverse(Rotation(va,vb,vc));
            scale=new Vector3((float)(D3.Dot(a,x)*maximum),(float)(D3.Dot(b,y)*maximum),(float)(D3.Dot(c,zAxis)*maximum));
            Matrix4x4 rebuilt=Matrix4x4.TRS(position,left,scale)*Matrix4x4.Rotate(right);
            RequireAffine(rebuilt,"projection");
            for(int row=0;row<3;row++) for(int column=0;column<3;column++)
                if(Math.Abs(rebuilt[row,column]-matrix[row,column])>2e-5*Math.Max(1,maximum))
                    throw UnityObjects.Error("followPose","Unity TRS projection cannot preserve the supplied affine.","local");
        }
    }
}
