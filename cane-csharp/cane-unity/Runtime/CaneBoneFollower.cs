using UnityEngine;

namespace Cane.Unity
{
    public sealed class CaneBoneFollower : CanePoseFollower
    {
        [SerializeField] private string boneId = "";
        public string BoneId { get => boneId; set { RequireIdle(); boneId = value ?? ""; Invalidate(); RefreshPose(); } }
        protected override void ReadPose(RuntimePlayer player, out Matrix4x4 matrix, out bool active)
        {
            BonePose pose = player.QueryBonePose(boneId);
            matrix = UnityObjects.Matrix(pose.Matrix); active = player.QueryBoneActive(boneId);
        }
    }
}
