using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Cane.Unity
{
    public sealed partial class CaneSkeleton
    {
        public long LastResourceMicroseconds { get; private set; }

        /// <summary>Atomically installs Core resources and decoded Unity textures. Null bytes reuse only unchanged installed overlays.</summary>
        public RuntimeFrame ApplyRuntimeResources(RuntimeResourceChanges changes, Func<RuntimeTextureResource, byte[]> imageBytes = null)
            => ReplaceResources(changes, imageBytes, false);

        /// <summary>Restores the original texture ownership and Core resources without resetting playback.</summary>
        public RuntimeFrame ClearRuntimeResources() => ReplaceResources(null, null, true);

        public IReadOnlyList<RuntimeTextureResource> QueryTextureResources()
        {
            if (player == null) throw UnityObjects.Error("queryTextureResources", "Initialize the skeleton first.");
            return player.Data.QueryTextureResources();
        }

        private RuntimeFrame ReplaceResources(RuntimeResourceChanges changes, Func<RuntimeTextureResource, byte[]> imageBytes, bool clear)
        {
            RequirePlayer();
            if (!ReferenceEquals(player.SourceData, sourceAsset.Data))
                throw UnityObjects.Error("unityResources", "The player's source data was replaced directly. Initialize with its matching CaneAsset first.");
            CaneAsset preparedAsset = null;
            CaneMeshProjection preparedProjection = null;
            RuntimePlayer currentPlayer = player;
            long resourceTicks = 0, uploadTicks = 0;
            performing = true;
            try
            {
                Action<RuntimeData, RuntimeFrame, RuntimeResourceSnapshot> prepare = (data, frame, snapshot) => {
                    long start = Stopwatch.GetTimestamp();
                    preparedAsset = CaneAsset.PrepareResources(data, snapshot, sourceAsset, asset, imageBytes);
                    resourceTicks = Stopwatch.GetTimestamp() - start;
                    if (!this || !ReferenceEquals(currentPlayer, player))
                        throw UnityObjects.Error("unityResources", "The skeleton was destroyed during resource acquisition.");
                    if (isActiveAndEnabled)
                    {
                        start = Stopwatch.GetTimestamp();
                        preparedProjection = new CaneMeshProjection();
                        preparedProjection.Upload(frame, preparedAsset);
                        preparedProjection.InheritUploadCount(projection);
                        uploadTicks = Stopwatch.GetTimestamp() - start;
                    }
                };
                long before = Stopwatch.GetTimestamp();
                RuntimeFrame result = clear ? currentPlayer.ClearRuntimeResources(prepare) : currentPlayer.ApplyRuntimeResources(changes, prepare);
                long totalTicks = Stopwatch.GetTimestamp() - before;

                // Only this point makes the prepared GPU state visible. Core has already committed once.
                CaneMeshProjection previousProjection = projection;
                CaneAsset previousAsset = asset;
                projection = preparedProjection; asset = preparedAsset;
                preparedProjection = null; preparedAsset = null;
                previousProjection?.Dispose(); previousAsset.Release();
                LastResourceMicroseconds = resourceTicks * 1000000 / Stopwatch.Frequency;
                LastUploadMicroseconds = uploadTicks * 1000000 / Stopwatch.Frequency;
                LastCoreMicroseconds = (totalTicks - resourceTicks - uploadTicks) * 1000000 / Stopwatch.Frequency;
                IReadOnlyList<RuntimeEvent> events = currentPlayer.DrainEvents();
                NotifyFrame();
                if (!this || player == null) return result;
                foreach (RuntimeEvent value in events)
                {
                    if (!this || player == null) break;
                    AnimationEvent?.Invoke(value);
                }
                return result;
            }
            finally
            {
                preparedProjection?.Dispose(); preparedAsset?.Release(); performing = false;
            }
        }
    }
}
