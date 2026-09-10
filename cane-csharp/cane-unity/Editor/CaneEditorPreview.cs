using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Cane.Unity.Editor
{
    /// <summary>One clock per preview instance. Camera repaint never evaluates animation.</summary>
    [InitializeOnLoad]
    public static class CaneEditorPreview
    {
        private sealed class State { internal bool Playing; internal double Updated; }
        private static readonly Dictionary<CaneSkeleton, State> states = new Dictionary<CaneSkeleton, State>();
        private static readonly List<CaneSkeleton> current = new List<CaneSkeleton>();
        static CaneEditorPreview()
        {
            EditorApplication.update += Update;
            AssemblyReloadEvents.beforeAssemblyReload += Clear;
            EditorApplication.quitting += Clear;
            EditorApplication.playModeStateChanged += state => {
                Clear();
                if (state != PlayModeStateChange.EnteredPlayMode && state != PlayModeStateChange.EnteredEditMode) return;
                // Also covers Enter Play Mode with domain/scene reload disabled.
                foreach (var skeleton in UnityEngine.Object.FindObjectsByType<CaneSkeleton>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                    if (skeleton.SkeletonData && skeleton.gameObject.scene.IsValid()) skeleton.RestartSerializedConfiguration();
            };
        }
        public static bool IsPlaying(CaneSkeleton skeleton) => states.TryGetValue(skeleton, out State state) && state.Playing;
        public static float Time(CaneSkeleton skeleton) => skeleton && skeleton.Player != null ? skeleton.Player.QueryTrackState()?.AnimationTime ?? 0 : 0;
        public static void Stop(CaneSkeleton skeleton) { if (!ReferenceEquals(skeleton, null)) states.Remove(skeleton); }
        public static void SetPlaying(CaneSkeleton skeleton, bool playing)
        {
            if (!skeleton || Application.isPlaying) return;
            skeleton.RefreshConfiguration(); if (skeleton.ConfigurationError != null || skeleton.Player == null) return;
            var track = skeleton.Player.QueryTrackState();
            if (playing && track != null && !track.Looping && track.AnimationTime >= track.AnimationEnd) skeleton.SampleAt(0);
            if (!states.TryGetValue(skeleton, out State state)) states.Add(skeleton, state = new State());
            state.Playing = playing; state.Updated = EditorApplication.timeSinceStartup;
        }
        public static void Seek(CaneSkeleton skeleton, float seconds)
        {
            SetPlaying(skeleton, false);
            if (!states.TryGetValue(skeleton, out State state)) return;
            skeleton.SampleAt(seconds); SceneView.RepaintAll(); EditorApplication.QueuePlayerLoopUpdate();
        }
        private static void Update()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode || EditorApplication.isCompiling) return;
            bool repaint = false; double now = EditorApplication.timeSinceStartup;
            current.Clear(); foreach (var pair in states) current.Add(pair.Key);
            foreach (var skeleton in current)
            {
                if (!states.TryGetValue(skeleton, out State state)) continue;
                if (!skeleton || !skeleton.isActiveAndEnabled || !skeleton.SkeletonData) { states.Remove(skeleton); continue; }
                if (!state.Playing) continue;
                float delta = (float)Math.Min(.1, Math.Max(0, now - state.Updated));
                if (delta < 1f / 120) continue;
                state.Updated = now;
                skeleton.RefreshConfiguration();
                if (skeleton.ConfigurationError != null) { state.Playing = false; continue; }
                delta *= skeleton.PlaybackSpeed; if (delta == 0) continue;
                try
                {
                    skeleton.Advance(delta);
                    var track = skeleton ? skeleton.Player?.QueryTrackState() : null;
                    if (track == null || (!track.Looping && track.AnimationTime >= track.AnimationEnd)) state.Playing = false;
                    repaint = true;
                }
                catch (Exception e) { state.Playing = false; Debug.LogException(e, skeleton); }
            }
            current.Clear();
            if (repaint) { SceneView.RepaintAll(); EditorApplication.QueuePlayerLoopUpdate(); }
        }
        private static void Clear() { states.Clear(); }
    }
}
