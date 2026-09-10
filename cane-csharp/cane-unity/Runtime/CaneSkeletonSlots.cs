using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Cane.Unity
{
    public sealed partial class CaneSkeleton
    {
        private readonly List<CaneSlot> renderSlots = new List<CaneSlot>();
        private Dictionary<string, int> completeSlotOrder = new Dictionary<string, int>(StringComparer.Ordinal);
        private RuntimeFrame slotOrderFrame;
        private static readonly Comparison<CaneSlot> slotComparison = CompareSlots;
        public long SlotOrderReads { get; private set; }

        private void RecordSlots<TCommands>(TCommands commands, int cullingMask) where TCommands : struct, ICaneDrawCommands
        {
            renderSlots.Clear();
            foreach (CanePoseFollower follower in followers)
                if (follower is CaneSlot slot && slot && slot.isActiveAndEnabled && slot.Skeleton == this && slot.State != null) renderSlots.Add(slot);
            if (renderSlots.Count == 0) { ClearSlotCache(); projection.Record(commands, transform.localToWorldMatrix); return; }
            if (!ReferenceEquals(slotOrderFrame, Frame))
            {
                completeSlotOrder.Clear();
                foreach (SlotState state in player.QuerySlotStates()) completeSlotOrder.Add(state.SlotId, state.DrawIndex);
                slotOrderFrame = Frame; ++SlotOrderReads;
            }
            renderSlots.Sort(slotComparison);
            IReadOnlyList<RenderAttachment> attachments = Frame.RenderPacket.Attachments;
            Matrix4x4 world = transform.localToWorldMatrix;
            int cursor = 0;
            foreach (CaneSlot slot in renderSlots)
            {
                int first = cursor, boundary = slot.State.DrawIndex;
                while (cursor < attachments.Count)
                {
                    int index = completeSlotOrder[attachments[cursor].SlotId];
                    if (index > boundary || (index == boundary && slot.DrawBefore)) break;
                    ++cursor;
                }
                projection.RecordRange(commands, world, first, cursor - first);
                slot.RecordContent(commands, cullingMask);
            }
            projection.RecordRange(commands, world, cursor, attachments.Count - cursor);
            renderSlots.Clear();
        }
        private static int CompareSlots(CaneSlot a, CaneSlot b)
        {
            int index = a.State.DrawIndex.CompareTo(b.State.DrawIndex);
            if (index != 0) return index;
            int before = b.DrawBefore.CompareTo(a.DrawBefore);
            if (before != 0) return before;
            int order = a.Order.CompareTo(b.Order);
            if (order != 0) return order;
            Transform x = a.transform, y = b.transform;
            int dx = 0, dy = 0;
            for (Transform p = x; p; p = p.parent) ++dx;
            for (Transform p = y; p; p = p.parent) ++dy;
            while (dx > dy) { x = x.parent; --dx; if (x == y) return 1; }
            while (dy > dx) { y = y.parent; --dy; if (x == y) return -1; }
            while (x.parent != y.parent) { x = x.parent; y = y.parent; }
            return x.GetSiblingIndex().CompareTo(y.GetSiblingIndex());
        }
        private void ClearSlotCache()
        { slotOrderFrame = null; completeSlotOrder.Clear(); renderSlots.Clear(); }
    }
}
