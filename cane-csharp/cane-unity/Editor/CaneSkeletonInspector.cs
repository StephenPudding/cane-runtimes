using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Cane.Unity.Editor
{
    [CustomEditor(typeof(CaneSkeleton)), CanEditMultipleObjects]
    public sealed class CaneSkeletonInspector : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            serializedObject.Update();
            var skeleton = (CaneSkeleton)target;
            EditorGUILayout.PropertyField(serializedObject.FindProperty("SkeletonData"), new GUIContent("Skeleton data"));
            var data = serializedObject.FindProperty("SkeletonData").objectReferenceValue as CaneSkeletonData;
            Choice("InitialAnimation", "Animation", "Setup pose", data?.AnimationIds);
            CaneSkinList.Draw(serializedObject, data);
            EditorGUILayout.PropertyField(serializedObject.FindProperty("Loop"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("PlaybackSpeed"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("AutomaticUpdate"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("UseUnscaledTime"));
            var layer = serializedObject.FindProperty("SortingLayerId");
            var layers = SortingLayer.layers; var names = new string[layers.Length]; int current = 0;
            for (int i = 0; i < layers.Length; ++i) { names[i] = layers[i].name; if (layers[i].id == layer.intValue) current = i; }
            EditorGUI.showMixedValue = layer.hasMultipleDifferentValues;
            EditorGUI.BeginChangeCheck(); int selected = EditorGUILayout.Popup("Sorting layer", current, names);
            if (EditorGUI.EndChangeCheck()) layer.intValue = layers[selected].id;
            EditorGUI.showMixedValue = false;
            EditorGUILayout.PropertyField(serializedObject.FindProperty("SortingOrder"));
            if (serializedObject.ApplyModifiedProperties())
                foreach (UnityEngine.Object item in targets) { var node = (CaneSkeleton)item; CaneEditorPreview.Stop(node); node.RefreshConfiguration(); }
            if (!string.IsNullOrEmpty(skeleton.ConfigurationError)) EditorGUILayout.HelpBox(skeleton.ConfigurationError, MessageType.Error);
            string issue = CaneSceneSetup.GetIssue();
            if (issue != null)
            {
                EditorGUILayout.HelpBox(issue, MessageType.Info);
                if (GUILayout.Button("Configure Cane rendering for this scene")) CaneSceneSetup.Configure();
            }
            if (targets.Length != 1 || Application.isPlaying || !data || !skeleton.gameObject.scene.IsValid()) return;
            EditorGUILayout.Space(); EditorGUILayout.LabelField("Editor preview", EditorStyles.boldLabel);
            using (new EditorGUI.DisabledScope(skeleton.ConfigurationError != null))
            {
                EditorGUILayout.BeginHorizontal();
                if (GUILayout.Button(CaneEditorPreview.IsPlaying(skeleton) ? "Pause" : "Play preview"))
                    CaneEditorPreview.SetPlaying(skeleton, !CaneEditorPreview.IsPlaying(skeleton));
                if (GUILayout.Button("Reset")) CaneEditorPreview.Seek(skeleton, 0);
                EditorGUILayout.EndHorizontal();
                float duration = data.Duration(skeleton.InitialAnimation), time = CaneEditorPreview.Time(skeleton);
                EditorGUI.BeginChangeCheck(); float seek = EditorGUILayout.Slider("Time (seconds)", time, 0, Math.Max(0, duration));
                if (EditorGUI.EndChangeCheck()) CaneEditorPreview.Seek(skeleton, seek);
                if (CaneEditorPreview.IsPlaying(skeleton)) Repaint();
            }
        }
        private void Choice(string property, string label, string empty, IReadOnlyList<string> items)
        {
            var value = serializedObject.FindProperty(property);
            if (items == null) { EditorGUILayout.PropertyField(value, new GUIContent(label)); return; }
            var ids = new List<string> { "" }; var names = new List<string> { empty };
            foreach (string id in items) { ids.Add(id); names.Add(id); }
            int index = ids.IndexOf(value.stringValue);
            if (index < 0) { index = ids.Count; ids.Add(value.stringValue); names.Add("Missing: " + value.stringValue); }
            EditorGUI.showMixedValue = value.hasMultipleDifferentValues;
            EditorGUI.BeginChangeCheck(); int next = EditorGUILayout.Popup(label, index, names.ToArray());
            if (EditorGUI.EndChangeCheck()) value.stringValue = ids[next];
            EditorGUI.showMixedValue = false;
        }
        private void OnDisable()
        { foreach (var item in targets) if (item is CaneSkeleton node && CaneEditorPreview.IsPlaying(node)) CaneEditorPreview.SetPlaying(node, false); }
    }

    [CustomEditor(typeof(CaneSkeletonData))]
    public sealed class CaneSkeletonDataInspector : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var data = (CaneSkeletonData)target;
            EditorGUILayout.HelpBox("Drag the Cane file into the scene, then choose an animation and skin on CaneSkeleton. Source changes update these imported dependencies automatically.", MessageType.Info);
            EditorGUILayout.LabelField("Animations", data.AnimationIds.Count.ToString());
            EditorGUILayout.LabelField("Skins", data.SkinIds.Count.ToString());
            using (new EditorGUI.DisabledScope(true))
                foreach (var material in data.Materials) EditorGUILayout.ObjectField(material ? material.name : "Missing material", material, typeof(Material), false);
        }
    }
}
