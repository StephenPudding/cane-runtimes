using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Cane.Unity
{
    /// <summary>The draw operations needed by final packets and host Slot content.</summary>
    public interface ICaneDrawCommands
    {
        void DrawMesh(Mesh mesh, Matrix4x4 matrix, Material material, int submesh, int pass, MaterialPropertyBlock properties);
        void DrawRenderer(Renderer renderer, Material material, int submesh, int pass);
    }

    /// <summary>Adapts a native buffer without allocating or owning its lifetime.</summary>
    public readonly struct CaneDrawCommands : ICaneDrawCommands
    {
        private readonly CommandBuffer commands;
        public CaneDrawCommands(CommandBuffer commands)
        { this.commands = commands ?? throw new ArgumentNullException(nameof(commands)); }
        public void DrawMesh(Mesh mesh, Matrix4x4 matrix, Material material, int submesh, int pass, MaterialPropertyBlock properties)
            => commands.DrawMesh(mesh, matrix, material, submesh, pass, properties);
        public void DrawRenderer(Renderer renderer, Material material, int submesh, int pass)
            => commands.DrawRenderer(renderer, material, submesh, pass);
    }
}
