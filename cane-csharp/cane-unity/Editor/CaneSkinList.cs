using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Cane.Unity.Editor
{
    internal static class CaneSkinList
    {
        internal static void Draw(SerializedObject serialized, CaneSkeletonData data)
        {
            var skins = serialized.FindProperty("InitialSkins");
            var legacy = serialized.FindProperty("InitialSkin");
            if (!data || (serialized.isEditingMultipleObjects && skins.hasMultipleDifferentValues))
            {
                EditorGUILayout.PropertyField(skins, new GUIContent("Skins (in order)"), true);
                return;
            }
            EditorGUILayout.LabelField("Skins (applied in order)", EditorStyles.boldLabel);
            var available = new List<string>();
            foreach (string id in data.SkinIds) available.Add(id);
            if (skins.arraySize == 0 && !string.IsNullOrEmpty(legacy.stringValue))
            {
                EditorGUILayout.LabelField("Existing skin", legacy.stringValue);
                available.Remove(legacy.stringValue);
                if (GUILayout.Button("Edit as ordered skins"))
                {
                    skins.arraySize = 1; skins.GetArrayElementAtIndex(0).stringValue = legacy.stringValue; legacy.stringValue = "";
                }
            }
            for (int i = 0; i < skins.arraySize; ++i)
            {
                var item = skins.GetArrayElementAtIndex(i);
                var choices = new List<string>();
                foreach (string id in data.SkinIds)
                {
                    bool used = false;
                    for (int j = 0; j < skins.arraySize; ++j)
                        if (j != i && skins.GetArrayElementAtIndex(j).stringValue == id) { used = true; break; }
                    if (!used) choices.Add(id);
                }
                int current = choices.IndexOf(item.stringValue);
                var labels = new List<string>(choices);
                if (current < 0) { current = choices.Count; choices.Add(item.stringValue); labels.Add("Missing: " + item.stringValue); }
                EditorGUILayout.BeginHorizontal();
                EditorGUI.BeginChangeCheck(); int next = EditorGUILayout.Popup(current, labels.ToArray());
                if (EditorGUI.EndChangeCheck()) item.stringValue = choices[next];
                bool moved = false;
                using (new EditorGUI.DisabledScope(i == 0))
                    if (GUILayout.Button(new GUIContent("▲", "Move earlier"), GUILayout.Width(24))) { skins.MoveArrayElement(i, i - 1); moved = true; }
                using (new EditorGUI.DisabledScope(i + 1 == skins.arraySize))
                    if (GUILayout.Button(new GUIContent("▼", "Move later"), GUILayout.Width(24))) { skins.MoveArrayElement(i, i + 1); moved = true; }
                if (GUILayout.Button(new GUIContent("−", "Remove skin"), GUILayout.Width(24))) { skins.DeleteArrayElementAtIndex(i); moved = true; }
                EditorGUILayout.EndHorizontal();
                if (moved) break;
            }
            for (int i = 0; i < skins.arraySize; ++i) available.Remove(skins.GetArrayElementAtIndex(i).stringValue);
            using (new EditorGUI.DisabledScope(available.Count == 0))
            {
                var choices = new List<string> { "Choose a skin..." }; choices.AddRange(available);
                int addition = EditorGUILayout.Popup("Add skin", 0, choices.ToArray());
                if (addition > 0)
                {
                    if (skins.arraySize == 0 && !string.IsNullOrEmpty(legacy.stringValue))
                    { skins.arraySize = 1; skins.GetArrayElementAtIndex(0).stringValue = legacy.stringValue; }
                    legacy.stringValue = "";
                    int index = skins.arraySize++; skins.GetArrayElementAtIndex(index).stringValue = available[addition - 1];
                }
            }
        }
    }
}
