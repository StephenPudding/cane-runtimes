using System;

namespace Cane
{
    public enum RuntimeErrorCode
    {
        InvalidArgument = 1, InvalidUtf8 = 2, InvalidJson = 3, ValidationFailed = 4,
        NotFound = 5, InvalidState = 6, UnsupportedVersion = 7, ResourceLimit = 8,
        UnsupportedFeature = 9, MissingResource = 10, MalformedInput = 11,
        NonFinite = 12, MissingReference = 13, Internal = 255
    }

    public sealed class RuntimeException : Exception
    {
        public RuntimeErrorCode Code { get; }
        public string Operation { get; }
        public string? Field { get; }
        public string? EntityId { get; }

        public RuntimeException(RuntimeErrorCode code, string operation, string message,
            string? field = null, string? entityId = null) : base(message)
        {
            Code = code; Operation = operation; Field = field; EntityId = entityId;
        }
    }
}
