using System;
using System.Collections.Generic;
using UnityEngine;

namespace Cane.Unity
{
    /// <summary>Serializable imported data and Unity-owned dependencies, shared by scene instances.</summary>
    public sealed class CaneSkeletonData : ScriptableObject
    {
        [Serializable] public sealed class AtlasSource { public string Id; public TextAsset Document; }
        [Serializable] public sealed class TextureSource
        {
            public string ImageId, AtlasId, PageId;
            public Texture2D Texture;
        }
        [SerializeField, HideInInspector] private byte[] runtimeBytes = Array.Empty<byte>();
        [SerializeField, HideInInspector] private AtlasSource[] atlases = Array.Empty<AtlasSource>();
        [SerializeField, HideInInspector] private TextureSource[] textures = Array.Empty<TextureSource>();
        [SerializeField, HideInInspector] private Material[] materials = Array.Empty<Material>();
        [SerializeField, HideInInspector] private string revision;
        [SerializeField, HideInInspector] private string[] animations = Array.Empty<string>(), skins = Array.Empty<string>();
        [SerializeField, HideInInspector] private float[] durations = Array.Empty<float>();
        [NonSerialized] private CaneAsset cached;
        public string Revision => revision;
        public IReadOnlyList<string> AnimationIds => Array.AsReadOnly(animations);
        public IReadOnlyList<string> SkinIds => Array.AsReadOnly(skins);
        public IReadOnlyList<Material> Materials => Array.AsReadOnly(materials);
        public float Duration(string animation) { int i = Array.IndexOf(animations, animation); return i < 0 ? 0 : durations[i]; }

        internal void Import(byte[] bytes, AtlasSource[] sources, TextureSource[] images, Material[] templates, string hash)
        {
            ReleaseCache(); runtimeBytes = bytes; atlases = sources; textures = images; materials = templates; revision = hash;
            RuntimeData data = GetAsset().Data;
            animations = new string[data.Animations.Count]; durations = new float[animations.Length];
            for (int i = 0; i < animations.Length; ++i) { animations[i] = data.Animations[i].Id; durations[i] = data.Animations[i].Duration; }
            skins = new string[data.SkinIds.Count]; for (int i = 0; i < skins.Length; ++i) skins[i] = data.SkinIds[i];
        }
        internal CaneAsset GetAsset()
        {
            if (cached != null) return cached;
            var documents = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (AtlasSource source in atlases)
            {
                if (source == null || !source.Document) throw new InvalidOperationException("Cane Atlas dependency is missing.");
                documents.Add(source.Id, source.Document.text);
            }
            var images = new Dictionary<(string, string), Texture2D>();
            foreach (TextureSource image in textures) images.Add((string.IsNullOrEmpty(image.AtlasId) ? null : image.AtlasId,
                string.IsNullOrEmpty(image.AtlasId) ? image.ImageId : image.PageId), image.Texture);
            cached = CaneAsset.LoadTextures(runtimeBytes, documents, request => {
                images.TryGetValue((request.Kind == TextureResourceKind.Direct ? null : request.AtlasId,
                    request.Kind == TextureResourceKind.Direct ? request.ImageId : request.PageId), out Texture2D texture);
                return texture;
            });
            cached.MaterialTemplates = materials;
            return cached;
        }
        private void ReleaseCache() { cached?.Dispose(); cached = null; }
        private void OnDisable() => ReleaseCache();
        private void OnValidate() => ReleaseCache();
    }
}
