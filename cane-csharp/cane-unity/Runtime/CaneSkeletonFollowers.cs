using System.Collections.Generic;

namespace Cane.Unity
{
    public sealed partial class CaneSkeleton
    {
        private readonly List<CanePoseFollower> followers = new List<CanePoseFollower>();
        private readonly List<CanePoseFollower> followerSnapshot = new List<CanePoseFollower>();
        private bool synchronizingFollowers;
        internal bool IsPublishing => performing;
        internal void RegisterFollower(CanePoseFollower follower)
        { if (!followers.Contains(follower)) followers.Add(follower); }
        internal void UnregisterFollower(CanePoseFollower follower) => followers.Remove(follower);
        internal void RefreshFollower(CanePoseFollower follower)
        {
            RequireIdle(); performing = true;
            try { if (follower) follower.RefreshFromSource(); }
            finally { performing = false; }
        }
        private void SynchronizeFollowers()
        {
            if (synchronizingFollowers || followers.Count == 0) return;
            synchronizingFollowers = true; bool previous = performing; performing = true;
            followerSnapshot.Clear(); followerSnapshot.AddRange(followers);
            try
            {
                foreach (CanePoseFollower follower in followerSnapshot)
                    if (follower && follower.isActiveAndEnabled && follower.Skeleton == this) follower.RefreshFromSource();
            }
            finally { followerSnapshot.Clear(); performing = previous; synchronizingFollowers = false; }
        }
    }
}
