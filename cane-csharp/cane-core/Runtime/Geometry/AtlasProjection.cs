using Cane.Format;

namespace Cane.Geometry
{
    // Immutable atlas numbers are decoded once. Projection preserves the original
    // binary64 operation order before narrowing the final UV to binary32.
    internal sealed class AtlasProjection
    {
        internal readonly int SourceX, SourceY, Width, Height, SourceWidth, SourceHeight;
        private readonly double[] coordinates = new double[8];

        internal AtlasProjection(Json region)
        {
            bool rotated = region.S("rotation") == "clockwise90";
            SourceX = region.I("sourceX"); SourceY = region.I("sourceY");
            SourceWidth = region.I("sourceWidth"); SourceHeight = region.I("sourceHeight");
            Width = region.I(rotated ? "height" : "width"); Height = region.I(rotated ? "width" : "height");
            Json uvs = region["uvs"];
            for (int i = 0; i < coordinates.Length; i++) coordinates[i] = uvs[i / 2][i % 2].Number;
        }

        internal Point Corner(int index) => new Point((float)coordinates[index * 2], (float)coordinates[index * 2 + 1]);

        internal Point Map(float u, float v)
        {
            double x = ((double)u * SourceWidth - SourceX) / Width;
            double y = ((double)v * SourceHeight - SourceY) / Height;
            double topU = coordinates[0] + (coordinates[2] - coordinates[0]) * x;
            double bottomU = coordinates[6] + (coordinates[4] - coordinates[6]) * x;
            double topV = coordinates[1] + (coordinates[3] - coordinates[1]) * x;
            double bottomV = coordinates[7] + (coordinates[5] - coordinates[7]) * x;
            return new Point((float)(topU + (bottomU - topU) * y), (float)(topV + (bottomV - topV) * y));
        }
    }
}
