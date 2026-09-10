using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Cane.Unity
{
    /// <summary>Full-affine Slot content inserted at a complete published Slot boundary.</summary>
    public sealed class CaneSlot : CanePoseFollower
    {
        [SerializeField] private string slotId = "";
        [SerializeField] private bool drawBefore, hideWhenEmpty = true;
        [SerializeField] private int order, shaderPass;
        private SlotState state;
        private sealed class Lease
        {
            internal Renderer Renderer;
            internal CaneSlot Owner;
            internal bool OriginalForceOff, Seen;
            internal int HierarchyIndex;
        }
        private readonly struct Submission
        {
            internal readonly Renderer Renderer;
            internal readonly Material Material;
            internal readonly int Submesh;
            internal Submission(Renderer renderer, Material material, int submesh)
            { Renderer = renderer; Material = material; Submesh = submesh; }
        }
        private static readonly Dictionary<Renderer, Lease> leases = new Dictionary<Renderer, Lease>();
        private static readonly Comparison<Lease> rendererComparison = CompareRenderers;
        private List<Lease> entries = new List<Lease>(), nextEntries = new List<Lease>();
        private readonly List<Renderer> candidates = new List<Renderer>();
        private readonly List<Material> materials = new List<Material>();
        private readonly List<Submission> submissions = new List<Submission>();
        public string SlotId { get => slotId; set { RequireIdle(); slotId = value ?? ""; Invalidate(); RefreshPose(); } }
        public bool DrawBefore { get => drawBefore; set { RequireIdle(); drawBefore = value; } }
        public bool HideWhenEmpty { get => hideWhenEmpty; set { RequireIdle(); hideWhenEmpty = value; Invalidate(); RefreshPose(); } }
        public int Order { get => order; set { RequireIdle(); order = value; } }
        public int ShaderPass
        {
            get => shaderPass;
            set { RequireIdle(); if (value < 0) throw new ArgumentOutOfRangeException(nameof(value)); shaderPass = value; }
        }
        public SlotState State => IsResolved ? state : null;
        public Exception LastRenderError { get; private set; }
        public int LastRendererDraws { get; private set; }
        public static int ActiveRendererLeases => leases.Count;

        protected override void ReadPose(RuntimePlayer player, out Matrix4x4 matrix, out bool active)
        {
            state = player.QuerySlotState(slotId);
            BonePose bone = player.QuerySlotBonePose(slotId);
            matrix = UnityObjects.Matrix(bone.Matrix);
            active = player.QueryBoneActive(bone.Id) && (!hideWhenEmpty || state.AttachmentId != null);
        }

        public void RefreshContent() { RequireIdle(); RefreshBindings(); }
        private void RefreshBindings()
        {
            if (!isActiveAndEnabled) { ReleaseBindings(); return; }
            foreach (Lease entry in entries) if (entry.Owner == this) entry.Seen = false;
            candidates.Clear(); nextEntries.Clear();
            Content.GetComponentsInChildren(true, candidates);
            for (int i = 0; i < candidates.Count; i++)
            {
                Renderer renderer = candidates[i];
                if (!renderer || renderer.GetComponentInParent<CaneSlot>(true) != this) continue;
                if (!leases.TryGetValue(renderer, out Lease entry))
                {
                    entry = new Lease { Renderer = renderer, OriginalForceOff = renderer.forceRenderingOff };
                    leases.Add(renderer, entry);
                }
                // A nested/reparented Slot inherits the original host state, not a
                // previous Slot's temporary suppression of the ordinary camera pass.
                entry.Owner = this; entry.Seen = true; entry.HierarchyIndex = i;
                if (!renderer.forceRenderingOff) renderer.forceRenderingOff = true;
                nextEntries.Add(entry);
            }
            foreach (Lease entry in entries) if (entry.Owner == this && !entry.Seen) Release(entry);
            List<Lease> previous = entries; entries = nextEntries; nextEntries = previous; nextEntries.Clear();
            entries.Sort(rendererComparison);
        }
        private static int CompareRenderers(Lease a, Lease b)
        {
            int layer = SortingLayer.GetLayerValueFromID(a.Renderer.sortingLayerID).CompareTo(SortingLayer.GetLayerValueFromID(b.Renderer.sortingLayerID));
            if (layer != 0) return layer;
            int order = a.Renderer.sortingOrder.CompareTo(b.Renderer.sortingOrder);
            return order != 0 ? order : a.HierarchyIndex.CompareTo(b.HierarchyIndex);
        }
        private static void Release(Lease entry)
        {
            if (entry.Renderer) entry.Renderer.forceRenderingOff = entry.OriginalForceOff;
            leases.Remove(entry.Renderer); entry.Owner = null;
        }
        private void ReleaseBindings()
        {
            foreach (Lease entry in entries) if (entry.Owner == this) Release(entry);
            entries.Clear(); nextEntries.Clear(); candidates.Clear(); materials.Clear(); submissions.Clear();
        }
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetLeases()
        {
            foreach (Lease entry in leases.Values)
            { if (entry.Renderer) entry.Renderer.forceRenderingOff = entry.OriginalForceOff; entry.Owner = null; }
            leases.Clear();
        }

        internal void RecordContent<TCommands>(TCommands commands, int cullingMask) where TCommands : struct, ICaneDrawCommands
        {
            LastRendererDraws = 0; LastRenderError = null;
            try
            {
                RefreshBindings(); submissions.Clear();
                if (!isActiveAndEnabled || !IsResolved || !Content.gameObject.activeInHierarchy) return;
                if (shaderPass < 0) throw UnityObjects.Error("slotRenderer", "Shader pass must be nonnegative.", "shaderPass");
                foreach (Lease entry in entries)
                {
                    Renderer renderer = entry.Renderer;
                    if (entry.Owner != this || !renderer || !renderer.enabled || !renderer.gameObject.activeInHierarchy || entry.OriginalForceOff ||
                        (cullingMask & (1 << renderer.gameObject.layer)) == 0) continue;
                    materials.Clear(); renderer.GetSharedMaterials(materials);
                    int submeshes = materials.Count;
                    if (renderer is MeshRenderer)
                    {
                        var filter = renderer.GetComponent<MeshFilter>();
                        submeshes = filter && filter.sharedMesh ? filter.sharedMesh.subMeshCount : 0;
                    }
                    else if (renderer is SkinnedMeshRenderer skinned) submeshes = skinned.sharedMesh ? skinned.sharedMesh.subMeshCount : 0;
                    if (submeshes == 0) continue;
                    for (int i = 0; i < materials.Count; i++)
                    {
                        Material material = materials[i];
                        if (!material || !material.shader || !material.shader.isSupported || shaderPass >= material.passCount)
                            throw UnityObjects.Error("slotRenderer", "Slot content needs a supported material and shader pass.", "material");
                        submissions.Add(new Submission(renderer, material, Math.Min(i, submeshes - 1)));
                    }
                }
                foreach (Submission draw in submissions) commands.DrawRenderer(draw.Renderer, draw.Material, draw.Submesh, shaderPass);
                LastRendererDraws = submissions.Count;
            }
            catch (Exception e) { LastRenderError = e; }
            finally { materials.Clear(); submissions.Clear(); }
        }
        protected override void OnEnable() { base.OnEnable(); RefreshBindings(); }
        protected override void LateUpdate() { base.LateUpdate(); RefreshBindings(); }
        protected override void OnDisable() { ReleaseBindings(); base.OnDisable(); }
        protected override void OnDestroy() { ReleaseBindings(); base.OnDestroy(); }
    }
}
