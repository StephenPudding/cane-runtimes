using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Cane.Unity
{
    public sealed partial class CaneSkeleton
    {
        public long LastProjectPreparationMicroseconds { get; private set; }

        /// <summary>Replaces immutable project data while preserving compatible Core state. Host resources are prepared before commit.</summary>
        public RuntimeFrame ReplaceProject(CaneAsset replacement, Func<RuntimeTextureResource, byte[]> imageBytes = null)
        {
            RequirePlayer();
            if (replacement == null) throw new ArgumentNullException(nameof(replacement));
            if (!ReferenceEquals(player.SourceData, sourceAsset.Data))
                throw UnityObjects.Error("unityProject", "The player's source was replaced directly. Initialize with its matching CaneAsset first.");
            replacement.Retain();
            CaneAsset preparedSource = replacement, preparedAsset = null;
            CaneMeshProjection preparedProjection = null;
            Dictionary<string, int> preparedSlots = null;
            RuntimePlayer currentPlayer = player;
            long hostTicks = 0, uploadTicks = 0;
            performing = true;
            try
            {
                long before = Stopwatch.GetTimestamp();
                RuntimeFrame result = currentPlayer.ReplaceProject(replacement.Data, candidate => {
                    long start = Stopwatch.GetTimestamp();
                    preparedAsset = CaneAsset.PrepareResources(candidate.Data, candidate.Resources, replacement, asset, imageBytes);
                    if (!this || !ReferenceEquals(currentPlayer, player))
                        throw UnityObjects.Error("unityProject", "The skeleton was destroyed during project preparation.");
                    // Include empty and newly introduced Slots before the live Core or renderer is changed.
                    preparedSlots = new Dictionary<string, int>(candidate.SlotStates.Count, StringComparer.Ordinal);
                    foreach (SlotState slot in candidate.SlotStates) preparedSlots.Add(slot.SlotId, slot.DrawIndex);
                    if (isActiveAndEnabled)
                    {
                        long uploadStart = Stopwatch.GetTimestamp();
                        preparedProjection = new CaneMeshProjection(null, preparedAsset.MaterialTemplates);
                        preparedProjection.Upload(candidate.Frame, preparedAsset);
                        preparedProjection.InheritUploadCount(projection);
                        uploadTicks = Stopwatch.GetTimestamp() - uploadStart;
                    }
                    hostTicks = Stopwatch.GetTimestamp() - start;
                });
                long totalTicks = Stopwatch.GetTimestamp() - before;

                // The callback has validated all host state. Publish the already-evaluated candidate once.
                CaneAsset previousAsset = asset, previousSource = sourceAsset;
                CaneMeshProjection previousProjection = projection;
                sourceAsset = preparedSource; asset = preparedAsset; projection = preparedProjection;
                preparedSource = null; preparedAsset = null; preparedProjection = null;
                completeSlotOrder = preparedSlots; slotOrderFrame = result; ++SlotOrderReads;
                previousProjection?.Dispose(); previousAsset.Release(); previousSource.Release();
                LastProjectPreparationMicroseconds = (hostTicks - uploadTicks) * 1000000 / Stopwatch.Frequency;
                LastUploadMicroseconds = uploadTicks * 1000000 / Stopwatch.Frequency;
                LastCoreMicroseconds = (totalTicks - hostTicks) * 1000000 / Stopwatch.Frequency;
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
                preparedProjection?.Dispose(); preparedAsset?.Release(); preparedSource?.Release(); performing = false;
            }
        }

        public RuntimeFrame ReconcileProject(CaneAsset replacement, Func<RuntimeTextureResource, byte[]> imageBytes = null)
            => ReplaceProject(replacement, imageBytes);
    }
}
