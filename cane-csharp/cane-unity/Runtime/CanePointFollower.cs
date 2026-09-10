using UnityEngine;

namespace Cane.Unity
{
    public sealed class CanePointFollower : CanePoseFollower
    {
        [SerializeField] private string attachmentId = "";
        [SerializeField] private string slotId = "";
        [SerializeField] private bool requireSelected;
        public string AttachmentId { get => attachmentId; set { RequireIdle(); attachmentId = value ?? ""; Invalidate(); RefreshPose(); } }
        public string SlotId { get => slotId; set { RequireIdle(); slotId = value ?? ""; Invalidate(); RefreshPose(); } }
        public bool RequireSelected { get => requireSelected; set { RequireIdle(); requireSelected = value; Invalidate(); RefreshPose(); } }
        protected override void ReadPose(RuntimePlayer player, out Matrix4x4 matrix, out bool active)
        {
            string id = attachmentId;
            if (string.IsNullOrEmpty(id)) id = player.QuerySlotState(slotId).AttachmentId;
            if (id == null) throw new RuntimeException(RuntimeErrorCode.NotFound, "followPoint", "The selected Slot has no Point attachment.", "slotId", slotId);
            PointAttachmentPose pose = player.QueryPointAttachmentPose(id);
            matrix = UnityObjects.Matrix(pose.Matrix); active = pose.Active && (!requireSelected || pose.Selected);
        }
    }
}
