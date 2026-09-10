using System;
using UnityEngine;

namespace Cane.Unity
{
    /// <summary>Projects a published Core pose onto Content through two exact affine TRS factors.</summary>
    [ExecuteAlways, DefaultExecutionOrder(10000), DisallowMultipleComponent]
    public abstract class CanePoseFollower : MonoBehaviour
    {
        [SerializeField] private CaneSkeleton skeleton;
        [SerializeField] private Transform poseRoot;
        [SerializeField] private Transform content;
        public Vector3 OffsetPosition;
        public Vector3 OffsetEuler;
        public Vector3 OffsetScale = Vector3.one;
        public bool FollowVisibility = true;
        private CaneSkeleton registered;
        private RuntimeFrame sampledFrame;
        private bool refreshing, targetActive, targetAvailable, dirty = true, projected;
        private Matrix4x4 coreMatrix, localMatrix, previousOwner, previousOffset;
        public CaneSkeleton Skeleton
        {
            get => skeleton;
            set
            {
                RequireIdle();
                if (value && value.IsPublishing) throw UnityObjects.Error("followPose", "Cannot bind during source publication.");
                if (value && poseRoot && value.transform.IsChildOf(poseRoot))
                    throw UnityObjects.Error("followPose", "The source cannot be inside follower Content.", "hierarchy");
                skeleton = value; Invalidate(); RefreshPose();
            }
        }
        // Attach scene objects here. The follower's own Transform stays host-owned.
        public Transform Content { get { EnsureContent(); return content; } }
        public bool IsResolved { get; private set; }
        public Matrix4x4 LocalPoseMatrix { get; private set; } = Matrix4x4.identity;
        public Matrix4x4 WorldPoseMatrix { get; private set; } = Matrix4x4.identity;
        public Matrix4x4 AppliedWorldMatrix { get; private set; } = Matrix4x4.identity;
        public Exception LastError { get; private set; }
        public long PoseReads { get; private set; }
        public long TransformWrites { get; private set; }
        public event Action<CanePoseFollower> PoseUpdated;

        protected abstract void ReadPose(RuntimePlayer player, out Matrix4x4 matrix, out bool active);
        protected void RequireIdle()
        {
            if (refreshing || (skeleton && skeleton.IsPublishing)) throw UnityObjects.Error("followPose", "Reentrant follower mutation is not allowed.");
        }
        protected void Invalidate() { dirty = true; sampledFrame = null; }
        private static bool Finite(Vector3 value) =>
            !float.IsNaN(value.x) && !float.IsInfinity(value.x) && !float.IsNaN(value.y) && !float.IsInfinity(value.y) &&
            !float.IsNaN(value.z) && !float.IsInfinity(value.z);
        private void EnsureContent()
        {
            if (!poseRoot)
            {
                var node = new GameObject("Cane Pose"); poseRoot = node.transform;
                poseRoot.SetParent(transform, false); projected = false;
            }
            if (!content)
            {
                var node = new GameObject("Content"); content = node.transform;
                content.SetParent(poseRoot, false); projected = false;
            }
        }
        private void Bind()
        {
            if (registered == skeleton) return;
            if (registered) registered.UnregisterFollower(this);
            registered = skeleton;
            if (registered && isActiveAndEnabled) registered.RegisterFollower(this);
            Invalidate();
        }
        private void SetContentVisible(bool visible)
        { if (content && content.gameObject.activeSelf != visible) content.gameObject.SetActive(visible); }
        public bool RefreshPose()
        {
            RequireIdle(); Bind();
            if (registered) registered.RefreshFollower(this);
            else RefreshFromSource();
            return IsResolved;
        }
        internal void RefreshFromSource()
        {
            if (refreshing) return;
            refreshing = true;
            try
            {
                EnsureContent();
                if (!this || !isActiveAndEnabled || !skeleton || !skeleton.isActiveAndEnabled || skeleton.Frame == null)
                { Unavailable(); return; }
                if (poseRoot.parent != transform || content.parent != poseRoot || skeleton.transform.IsChildOf(poseRoot))
                    throw UnityObjects.Error("followPose", "Follower helpers must remain beneath their owner, outside the source hierarchy's descendants.", "hierarchy");
                RuntimeFrame frame = skeleton.Frame;
                bool newPose = dirty || !ReferenceEquals(sampledFrame, frame);
                if (newPose)
                {
                    targetAvailable = false;
                    try
                    {
                        ReadPose(skeleton.Player, out coreMatrix, out targetActive);
                        CaneAffineProjection.RequireAffine(coreMatrix, "corePose"); targetAvailable = true;
                    }
                    catch (RuntimeException e) when (e.Code == RuntimeErrorCode.NotFound || e.Code == RuntimeErrorCode.InvalidArgument)
                    { LastError = e; }
                    sampledFrame = frame; dirty = false; ++PoseReads;
                }
                if (!targetAvailable) { IsResolved = false; SetContentVisible(false); return; }
                Matrix4x4 world = skeleton.transform.localToWorldMatrix * coreMatrix;
                if (!Finite(OffsetPosition) || !Finite(OffsetEuler) || !Finite(OffsetScale))
                    throw UnityObjects.Error("followPose", "Follower offset must be finite.", "offset");
                Matrix4x4 offset = Matrix4x4.TRS(OffsetPosition, Quaternion.Euler(OffsetEuler), OffsetScale);
                CaneAffineProjection.RequireAffine(offset, "offset");
                Matrix4x4 applied = world * offset;
                Matrix4x4 owner = transform.localToWorldMatrix;
                bool inputsChanged = !projected || !world.Equals(WorldPoseMatrix) || !owner.Equals(previousOwner) || !offset.Equals(previousOffset);
                Matrix4x4 nextLocal = inputsChanged ? CaneAffineProjection.Inverse(owner) * applied : localMatrix;
                bool change = !projected || !nextLocal.Equals(localMatrix);
                if (change)
                {
                    CaneAffineProjection.Decompose(nextLocal, out Vector3 position, out Quaternion left, out Vector3 scale, out Quaternion right);
                    // Validate both factors before touching the scene graph.
                    poseRoot.SetLocalPositionAndRotation(position, left); poseRoot.localScale = scale;
                    content.SetLocalPositionAndRotation(Vector3.zero, right); content.localScale = Vector3.one;
                    localMatrix = nextLocal; projected = true; ++TransformWrites;
                }
                previousOwner = owner; previousOffset = offset;
                bool wasResolved = IsResolved;
                LocalPoseMatrix = coreMatrix; WorldPoseMatrix = world; AppliedWorldMatrix = applied;
                IsResolved = true; LastError = null;
                SetContentVisible(!FollowVisibility || targetActive);
                if (this && (newPose || change || !wasResolved)) PoseUpdated?.Invoke(this);
                // A callback may delete/disable the source while its follower snapshot
                // is being delivered. That source cannot recursively notify this call.
                if (this && (!skeleton || !skeleton.isActiveAndEnabled || skeleton.Frame == null)) Unavailable();
            }
            catch (Exception e)
            {
                LastError = e; IsResolved = false; sampledFrame = null;
                SetContentVisible(false);
            }
            finally { refreshing = false; }
        }
        private void Unavailable()
        {
            IsResolved = false; sampledFrame = null; LastError = null;
            SetContentVisible(false);
        }
        protected virtual void OnEnable() { Bind(); RefreshPose(); }
        protected virtual void OnDisable()
        {
            if (registered) registered.UnregisterFollower(this);
            registered = null; Unavailable();
        }
        protected virtual void OnDestroy()
        {
            if (registered) registered.UnregisterFollower(this);
            registered = null;
            // Keep scene-authored Content when removing only this component.
        }
        protected virtual void OnValidate() { Invalidate(); }
        protected virtual void LateUpdate() { RefreshPose(); }
    }
}
