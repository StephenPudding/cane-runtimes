using System;
using System.Collections.Generic;

namespace Cane.Format
{
    internal static class AtlasValidation
    {
        internal static string AsciiFold(string path)
        {
            char[] value = path.ToCharArray();
            for (int i = 0; i < value.Length; i++) if (value[i] >= 'A' && value[i] <= 'Z') value[i] = (char)(value[i] - 'A' + 'a');
            return new string(value);
        }

        private readonly struct Allocation
        {
            internal readonly long Left, Top, Right, Bottom;
            internal readonly int Order;
            internal Allocation(long left, long top, long right, long bottom, int order)
            { Left = left; Top = top; Right = right; Bottom = bottom; Order = order; }
        }
        private readonly struct Edge
        {
            internal readonly long X;
            internal readonly bool Start;
            internal readonly Allocation Rectangle;
            internal Edge(Allocation rectangle, bool start)
            { Rectangle = rectangle; Start = start; X = start ? rectangle.Left : rectangle.Right; }
        }

        // Sweep page allocations. Touching half-open edges are legal; the replicated gutter belongs to the allocation.
        internal static void DisjointAllocations(IReadOnlyList<Json> regions)
        {
            var pages = new Dictionary<string, List<Edge>>(StringComparer.Ordinal);
            for (int i = 0; i < regions.Count; i++)
            {
                Json region = regions[i]; long edge = region.I("edgeExtension"), x = region.I("x"), y = region.I("y");
                var rectangle = new Allocation(x - edge, y - edge, x + region.I("width") + edge, y + region.I("height") + edge, i);
                string page = region.S("pageId");
                if (!pages.TryGetValue(page, out List<Edge>? entries)) pages.Add(page, entries = new List<Edge>());
                entries.Add(new Edge(rectangle, true)); entries.Add(new Edge(rectangle, false));
            }
            var comparer = Comparer<Allocation>.Create((a, b) => { int top = a.Top.CompareTo(b.Top); return top != 0 ? top : a.Order.CompareTo(b.Order); });
            var lower = new Allocation(0, long.MinValue, 0, 0, int.MinValue);
            var upper = new Allocation(0, long.MaxValue, 0, 0, int.MaxValue);
            foreach (List<Edge> edges in pages.Values)
            {
                edges.Sort((a, b) => {
                    int x = a.X.CompareTo(b.X); if (x != 0) return x;
                    int start = a.Start.CompareTo(b.Start); return start != 0 ? start : a.Rectangle.Order.CompareTo(b.Rectangle.Order);
                });
                var active = new SortedSet<Allocation>(comparer);
                foreach (Edge edge in edges)
                {
                    Allocation current = edge.Rectangle;
                    if (!edge.Start) { active.Remove(current); continue; }
                    using (var next = active.GetViewBetween(current, upper).GetEnumerator())
                        if (next.MoveNext() && next.Current.Top < current.Bottom) Validation.Fail("Atlas allocations overlap, including edge extension.");
                    using (var previous = active.GetViewBetween(lower, current).Reverse().GetEnumerator())
                        if (previous.MoveNext() && previous.Current.Bottom > current.Top) Validation.Fail("Atlas allocations overlap, including edge extension.");
                    active.Add(current);
                }
            }
        }
    }
}
