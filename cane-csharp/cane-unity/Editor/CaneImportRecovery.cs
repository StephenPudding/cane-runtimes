using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Cane.Unity.Editor
{
    // Unity does not retry an initial failed import when a previously absent
    // dependency first appears. Keep only these failures in its disposable cache.
    // The postprocessor handles retries; there is no per-frame filesystem scan.
    [InitializeOnLoad]
    internal static class CaneImportRecovery
    {
        [Serializable] private sealed class Missing { public string source, dependency; }
        private const string Cache = "Library/Cane/MissingImports";
        private static readonly HashSet<string> changed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static bool scheduled, startup = true;
        static CaneImportRecovery() { Schedule(); }

        private static string RecordPath(string source)
        {
            using (var hash = SHA256.Create())
                return Cache + "/" + BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(source))).Replace("-", "") + ".json";
        }
        internal static void Remember(string source, string dependency)
        {
            if (string.IsNullOrEmpty(dependency)) return;
            Directory.CreateDirectory(Cache);
            File.WriteAllText(RecordPath(source), JsonUtility.ToJson(new Missing { source = source, dependency = dependency }));
        }
        internal static void Forget(string source)
        {
            string path = RecordPath(source); if (File.Exists(path)) File.Delete(path);
        }
        internal static void Changed(params string[][] groups)
        {
            if (!Directory.Exists(Cache)) return;
            foreach (var paths in groups) foreach (string path in paths) changed.Add(path);
            Schedule();
        }
        private static void Schedule()
        {
            if (scheduled) return;
            scheduled = true; EditorApplication.delayCall += Retry;
        }
        private static bool ChangedPath(string path)
        {
            if (startup || changed.Contains(path)) return true;
            foreach (string entry in changed) if (path.StartsWith(entry.TrimEnd('/') + "/", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }
        private static void Retry()
        {
            scheduled = false;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) { Schedule(); return; }
            var retry = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (Directory.Exists(Cache)) foreach (string path in Directory.GetFiles(Cache, "*.json"))
            {
                Missing item;
                try { item = JsonUtility.FromJson<Missing>(File.ReadAllText(path)); }
                catch (Exception e) when (e is IOException || e is ArgumentException) { continue; }
                if (item == null || string.IsNullOrEmpty(item.source) || string.IsNullOrEmpty(item.dependency)) continue;
                if (!File.Exists(item.source)) { Forget(item.source); continue; }
                if (File.Exists(item.dependency) && ChangedPath(item.dependency)) retry.Add(item.source);
            }
            startup = false; changed.Clear();
            foreach (string source in retry) AssetDatabase.ImportAsset(source, ImportAssetOptions.ForceUpdate);
        }
    }
}
