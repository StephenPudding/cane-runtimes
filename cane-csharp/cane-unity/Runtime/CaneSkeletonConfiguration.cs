using System;
using UnityEngine;

namespace Cane.Unity
{
    public sealed partial class CaneSkeleton
    {
        public CaneSkeletonData SkeletonData;
        public string InitialAnimation = "";
        public string InitialSkin = "";
        [Tooltip("Skins are combined in order; later skins override earlier attachments. An empty list uses InitialSkin for compatibility.")]
        public string[] InitialSkins = Array.Empty<string>();
        public bool Loop = true;
        [Min(0)] public float PlaybackSpeed = 1;
        [NonSerialized] private CaneSkeletonData boundData;
        [NonSerialized] private string boundRevision, boundAnimation;
        [NonSerialized] private string[] boundSkins = Array.Empty<string>();
        [NonSerialized] private bool boundLoop;
        public string ConfigurationError { get; private set; }

        internal void RestartSerializedConfiguration()
        { boundData = null; if (isActiveAndEnabled) RefreshConfiguration(); }

        /// <summary>Refresh serialized configuration only when it changes; ordinary camera renders do not evaluate it.</summary>
        public void RefreshConfiguration()
        {
            if (performing || !gameObject.scene.IsValid()) return;
            if (!SkeletonData)
            {
                if (!ReferenceEquals(boundData, null))
                {
                    projection?.Dispose(); projection = null;
                    asset?.Release(); asset = null; sourceAsset?.Release(); sourceAsset = null;
                    player = null; notifiedFrame = null; boundData = null; ClearSlotCache(); SynchronizeFollowers();
                }
                ConfigurationError = null; return;
            }
            try
            {
                if (float.IsNaN(PlaybackSpeed) || float.IsInfinity(PlaybackSpeed) || PlaybackSpeed < 0)
                    throw new InvalidOperationException("Cane playback speed must be finite and nonnegative.");
                if (boundData == SkeletonData && boundRevision == SkeletonData.Revision && player != null &&
                    boundAnimation == InitialAnimation && SkinsUnchanged() && boundLoop == Loop)
                { ConfigurationError = null; return; }
                CaneAsset loaded = SkeletonData.GetAsset();
                if (!string.IsNullOrEmpty(InitialAnimation) && !Contains(SkeletonData.AnimationIds, InitialAnimation))
                    throw new InvalidOperationException("Cane animation is missing: " + InitialAnimation);
                string[] skins = CaptureSkins();
                var distinct = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
                foreach (string skin in skins)
                {
                    if (string.IsNullOrEmpty(skin) || !Contains(SkeletonData.SkinIds, skin))
                        throw new InvalidOperationException("Cane skin is missing: " + (skin ?? "<empty>"));
                    if (!distinct.Add(skin)) throw new InvalidOperationException("Cane skin is repeated: " + skin);
                }
                bool skinsChanged = !SkinsUnchanged();
                bool replaced = boundData != SkeletonData || player == null;
                bool changed = replaced || boundRevision != SkeletonData.Revision;
                if (changed)
                {
                    if (player != null && boundData == SkeletonData) ReplaceProject(loaded);
                    else Initialize(loaded);
                }
                if (replaced || boundAnimation != InitialAnimation || boundLoop != Loop)
                {
                    if (!string.IsNullOrEmpty(InitialAnimation)) Play(InitialAnimation, Loop);
                    else ResetPlayer();
                }
                if (replaced || skinsChanged || string.IsNullOrEmpty(InitialAnimation)) SetSkins(skins);
                boundData = SkeletonData; boundRevision = SkeletonData.Revision;
                boundAnimation = InitialAnimation; boundSkins = skins; boundLoop = Loop; ConfigurationError = null;
            }
            catch (Exception e) { ConfigurationError = e.Message; }
        }
        private bool SkinsUnchanged()
        {
            if (InitialSkins != null && InitialSkins.Length > 0)
            {
                if (boundSkins.Length != InitialSkins.Length) return false;
                for (int i = 0; i < boundSkins.Length; ++i) if (boundSkins[i] != InitialSkins[i]) return false;
                return true;
            }
            return string.IsNullOrEmpty(InitialSkin) ? boundSkins.Length == 0 : boundSkins.Length == 1 && boundSkins[0] == InitialSkin;
        }
        private string[] CaptureSkins() => InitialSkins != null && InitialSkins.Length > 0 ? (string[])InitialSkins.Clone() :
            string.IsNullOrEmpty(InitialSkin) ? Array.Empty<string>() : new[] { InitialSkin };
        private static bool Contains(System.Collections.Generic.IReadOnlyList<string> values, string item)
        { foreach (string value in values) if (value == item) return true; return false; }
    }
}
