using System;
using System.Collections.Generic;
using System.Diagnostics;
using UnityEngine;
using UnityEngine.Rendering;

namespace Cane.Unity
{
    /// <summary>One player and one final-packet projection. Camera renders never advance animation.</summary>
    [ExecuteAlways, DisallowMultipleComponent]
    public sealed partial class CaneSkeleton : MonoBehaviour
    {
        internal static readonly HashSet<CaneSkeleton> Active = new HashSet<CaneSkeleton>();
        public bool AutomaticUpdate = true;
        public bool UseUnscaledTime;
        public int SortingLayerId;
        public int SortingOrder;
        private CaneAsset asset;
        private CaneAsset sourceAsset;
        private RuntimePlayer player;
        private CaneMeshProjection projection;
        private RuntimeFrame notifiedFrame;
        private bool performing;
        public RuntimePlayer Player => player;
        public RuntimeFrame Frame => player?.Frame;
        public CaneMeshProjection Projection => projection;
        public long LastCoreMicroseconds { get; private set; }
        public long LastUploadMicroseconds { get; private set; }
        public event Action<RuntimeFrame> FramePublished;
        public event Action<RuntimeEvent> AnimationEvent;
        public event Action<Exception> RuntimeError;

        public void Initialize(CaneAsset value)
        {
            RequireIdle();
            if (value == null) throw new ArgumentNullException(nameof(value));
            value.Retain();
            try { value.Retain(); } catch { value.Release(); throw; }
            CaneMeshProjection candidate = null;
            RuntimePlayer candidatePlayer;
            try
            {
                candidatePlayer = value.Data.CreatePlayer();
                candidate = new CaneMeshProjection(); candidate.Upload(candidatePlayer.Frame, value);
            }
            catch { candidate?.Dispose(); value.Release(); value.Release(); throw; }
            projection?.Dispose(); asset?.Release(); sourceAsset?.Release();
            asset = sourceAsset = value; player = candidatePlayer; projection = candidate; notifiedFrame = null;
            performing = true;
            try { NotifyFrame(); } finally { performing = false; }
        }

        private void RequireIdle()
        {
            if (performing) throw UnityObjects.Error("unityPlayer", "Reentrant skeleton mutation is not allowed during publication or event delivery.");
        }
        private void RequirePlayer()
        {
            RequireIdle();
            if (player == null) throw UnityObjects.Error("unityPlayer", "Initialize the skeleton before using its player.");
        }

        /// <summary>Run any public Core operation and project its already-published frame exactly once.</summary>
        public void Mutate(Action<RuntimePlayer> operation)
        {
            RequirePlayer();
            if (operation == null) throw new ArgumentNullException(nameof(operation));
            performing = true;
            try
            {
                long start = Stopwatch.GetTimestamp(); operation(player);
                LastCoreMicroseconds = (Stopwatch.GetTimestamp() - start) * 1000000 / Stopwatch.Frequency;
                Project();
                // Capture owned notifications before user callbacks. Advance's returned events duplicate this pending queue.
                IReadOnlyList<RuntimeEvent> events = player.DrainEvents();
                NotifyFrame();
                if (!this || player == null) return;
                foreach (RuntimeEvent value in events)
                {
                    if (!this || player == null) break;
                    AnimationEvent?.Invoke(value);
                }
            }
            finally { performing = false; }
        }

        public void Play(string animationId, bool loop = true, int track = 0, float? mixSeconds = null)
            => Mutate(p => p.SetAnimation(animationId, loop, track, mixSeconds));
        public void Queue(string animationId, float delaySeconds = 0, bool loop = true, int track = 0)
            => Mutate(p => p.QueueAnimation(animationId, delaySeconds, loop, track));
        public void Advance(float deltaSeconds) => Mutate(p => p.Advance(deltaSeconds));
        public void Apply() => Mutate(p => p.Apply());
        public void SetSkins(IReadOnlyList<string> skins) => Mutate(p => p.SetSkins(skins));
        public void SetAttachment(string slotId, string attachmentId) => Mutate(p => p.SetSlotAttachmentOverride(slotId, attachmentId));
        public void ClearAttachmentOverride(string slotId) => Mutate(p => p.ClearSlotAttachmentOverride(slotId));
        public void ResetPlayer() => Mutate(p => p.Reset());

        /// <summary>Replay events are returned separately, following Core's replay/pending distinction.</summary>
        public RuntimeStep SampleAt(float seconds, float fixedStepSeconds = 1f / 60)
        {
            RuntimeStep result = null;
            Mutate(p => result = p.SampleAt(seconds, fixedStepSeconds));
            return result;
        }

        /// <summary>Use after mutating Player directly. This performs no sampling or solver work.</summary>
        public void RefreshRender()
        {
            RequirePlayer(); performing = true;
            try { Project(); NotifyFrame(); }
            finally { performing = false; }
        }

        private void Project()
        {
            if (projection == null) projection = new CaneMeshProjection();
            long start = Stopwatch.GetTimestamp(); projection.Upload(player.Frame, asset);
            LastUploadMicroseconds = (Stopwatch.GetTimestamp() - start) * 1000000 / Stopwatch.Frequency;
        }
        private void NotifyFrame()
        {
            SynchronizeFollowers();
            if (!this || player == null) return;
            if (ReferenceEquals(notifiedFrame, player.Frame)) return;
            notifiedFrame = player.Frame; FramePublished?.Invoke(notifiedFrame);
        }
        public Matrix4x4 GetBoneLocalMatrix(string boneId)
        {
            if (player == null) throw UnityObjects.Error("queryBone", "Initialize the skeleton first.");
            foreach (BonePose bone in player.Frame.Bones) if (bone.Id == boneId) return UnityObjects.Matrix(bone.Matrix);
            throw new RuntimeException(RuntimeErrorCode.NotFound, "queryBone", "Bone is missing.", "boneId", boneId);
        }
        public Matrix4x4 GetBoneWorldMatrix(string boneId) => transform.localToWorldMatrix * GetBoneLocalMatrix(boneId);
        public void Record(CommandBuffer commands)
            => Record(commands, ~0);
        public void Record(CommandBuffer commands, int cullingMask)
            => Record(new CaneDrawCommands(commands), cullingMask);
        public void Record<TCommands>(TCommands commands, int cullingMask = ~0) where TCommands : struct, ICaneDrawCommands
        {
            RequireIdle();
            if (player == null) return;
            // Reads the publication only; even multiple cameras cannot advance the player.
            RefreshRender(); if (!this || projection == null) return;
            performing = true;
            try { RecordSlots(commands, cullingMask); }
            finally { performing = false; }
        }

        private void OnEnable() { Active.Add(this); SynchronizeFollowers(); }
        private void OnDisable()
        {
            Active.Remove(this); projection?.Dispose(); projection = null;
            SynchronizeFollowers();
        }
        private void LateUpdate()
        {
            if (!Application.IsPlaying(gameObject) || !AutomaticUpdate || player == null) return;
            try { Advance(UseUnscaledTime ? Time.unscaledDeltaTime : Time.deltaTime); }
            catch (Exception e)
            {
                AutomaticUpdate = false;
                if (RuntimeError != null) RuntimeError(e); else UnityEngine.Debug.LogException(e, this);
            }
        }
        private void OnDestroy()
        {
            Active.Remove(this); projection?.Dispose(); projection = null;
            asset?.Release(); asset = null; player = null;
            sourceAsset?.Release(); sourceAsset = null;
            ClearSlotCache();
            SynchronizeFollowers(); followers.Clear();
        }
    }
}
