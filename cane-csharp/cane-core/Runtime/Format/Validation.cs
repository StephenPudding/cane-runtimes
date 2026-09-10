using System;
using System.Collections.Generic;

namespace Cane.Format
{
    internal static class Validation
    {
        internal const string BoneModes = "normal onlyTranslation noRotationOrReflection noScale noScaleOrReflection";
        internal static void Fail(string message, string field = "$") => throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "loadJson", message, field);
        internal static void Missing(string field, string id) => throw new RuntimeException(RuntimeErrorCode.ValidationFailed, "loadJson", "Unresolved reference: " + id, "$", null);
        internal static string Id(Json j, string field)
        { string s = j[field].String; if (s.Length == 0 || s.IndexOf('\0') >= 0) Fail("Invalid ID: " + field); return s; }
        internal static void Closed(Json j, string allowed, string required = "")
        {
            if (!j.IsObject) Fail("Expected an object.");
            foreach (var key in j.Members.Keys) if (!(" " + allowed + " ").Contains(" " + key + " ")) Fail("Unknown member: " + key);
            foreach (var key in required.Split(' ')) if (key.Length != 0 && !j.Has(key)) Fail("Missing member: " + key);
        }
        internal static void Enum(string value, string choices)
        { if (!(" " + choices + " ").Contains(" " + value + " ") || value.Length == 0 || value.IndexOf(' ') >= 0) Fail("Invalid enum value: " + value); }
        internal static void Range(Json j, string field, float min, float max, float fallback = 0)
        { float x = j.F(field, fallback); if (!Numeric.Finite(x) || x < min || x > max) Fail("Out-of-range " + field); }
        internal static void NonEmpty(Json j, string fields)
        { foreach (var key in fields.Split(' ')) if (j[key].String.Length == 0) Fail("Empty " + key); }
        internal static void FiniteTree(Json j)
        {
            if (j.IsNumber) { if (!Numeric.Finite(j.Float)) Fail("Scalar is outside binary32 range."); }
            else if (j.IsArray) foreach (var v in j.Items) FiniteTree(v);
            else if (j.IsObject) foreach (var v in j.Members.Values) FiniteTree(v);
        }
        internal static void Path(string value)
        {
            if (value.Length == 0 || value.IndexOf('\\') >= 0 || value.IndexOf(':') >= 0) Fail("Resource path must be portable and relative.");
            foreach (char c in value) if (c < 32) Fail("Control character in resource path.");
            foreach (var part in value.Split('/')) if (part.Length == 0 || part == "." || part == "..") Fail("Unsafe resource path.");
        }
        internal static void Version(Json version, int maxMinor, string field)
        {
            Closed(version, "major minor", "major minor"); int major = version["major"].Integer, minor = version["minor"].Integer;
            if (major != 1 || minor < 0 || minor > maxMinor) throw new RuntimeException(RuntimeErrorCode.UnsupportedVersion, "loadJson", "Unsupported " + field, field);
        }
        internal static void Root(Json j)
        {
            const string fields = "format formatVersion runtimeApiVersion generator requiredFeatures skeleton atlases images audios fonts bones slots attachments constraints skins events animations";
            Closed(j, fields, fields);
            if (j.S("format") != "cane-runtime") throw new RuntimeException(RuntimeErrorCode.MalformedInput, "loadJson", "Expected cane-runtime data.", "format");
            Version(j["formatVersion"], 0, "formatVersion"); Version(j["runtimeApiVersion"], 3, "runtimeApiVersion");
            Closed(j["generator"], "name version", "name version"); NonEmpty(j["generator"], "name version");
            Closed(j["skeleton"], "skeletonId name unit angleUnit referenceScale", "skeletonId name unit angleUnit referenceScale");
            Id(j["skeleton"], "skeletonId"); NonEmpty(j["skeleton"], "name"); Enum(j["skeleton"].S("unit"), "px"); Enum(j["skeleton"].S("angleUnit"), "deg");
            Range(j["skeleton"], "referenceScale", float.Epsilon, float.MaxValue);
            string previous = "";
            foreach (var f in j["requiredFeatures"].Items)
            {
                string name = f.String;
                if (!RuntimeCapabilities.Current.SupportsRuntimeFeature(name)) throw new RuntimeException(RuntimeErrorCode.UnsupportedFeature, "loadJson", "Unsupported required feature: " + name, "requiredFeatures");
                if (StringComparer.Ordinal.Compare(previous, name) >= 0) Fail("requiredFeatures must be sorted and unique."); previous = name;
            }
            foreach (var field in "atlases images audios fonts bones slots attachments constraints skins events animations".Split(' '))
            { if (!j[field].IsArray) Fail("Expected array: " + field); if (j[field].Items.Count > 1000000) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "loadJson", "Collection limit exceeded.", field); }
            FiniteTree(j);
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var field in new[] { "atlases", "images", "audios", "fonts" })
            {
                var ids = new HashSet<string>(StringComparer.Ordinal);
                foreach (var item in j[field].Items)
                {
                    string idKey = field == "atlases" ? "atlasId" : field == "images" ? "imageId" : field == "audios" ? "audioId" : "fontId";
                    if (!ids.Add(Id(item, idKey))) Fail("Duplicate resource ID.");
                    if (!item["path"].IsNull) { string path = item.S("path"); Path(path); if (!paths.Add(path)) Fail("Resource paths collide ignoring ASCII case."); }
                    if (field == "audios" || field == "fonts") { Closed(item, idKey + " name path mimeType", idKey + " name path mimeType"); NonEmpty(item, "name mimeType"); }
                }
            }
        }
        internal static void Bone(Json j)
        {
            const string keys = "id name parentId x y length rotation shearX shearY scaleX scaleY transformMode"; Closed(j, keys, keys); NonEmpty(j, "name");
            Range(j, "length", 0, float.MaxValue); Enum(j.S("transformMode"), BoneModes);
            foreach (string key in new[] { "x", "y", "length", "rotation", "shearX", "shearY", "scaleX", "scaleY" }) _ = j[key].Float;
            if (j.F("scaleX") == 0 || j.F("scaleY") == 0) Fail("Setup bone scale must be nonzero.");
        }
        internal static void Slot(Json j)
        {
            Closed(j, "id name boneId attachmentId zIndex blendMode color alpha darkColor", "id name boneId attachmentId zIndex blendMode");
            NonEmpty(j, "name"); SignedInteger(j["zIndex"], "zIndex"); Enum(j.S("blendMode"), "normal add multiply screen");
            Rgb.Parse(j.S("color", "#ffffff")); if (!j["darkColor"].IsNull) Rgb.Parse(j.S("darkColor")); Range(j, "alpha", 0, 1, 1);
        }
        internal static void Image(Json j)
        {
            Closed(j, "imageId name mimeType path atlasId width height", "imageId name mimeType"); NonEmpty(j, "name mimeType");
            if (j["path"].IsNull == j["atlasId"].IsNull) Fail("Image must have exactly one resource source.");
            if (!j["path"].IsNull) Path(j.S("path")); else Id(j, "atlasId");
            foreach (var k in new[] { "width", "height" }) if (j.Has(k) && (j[k].IsNull || j[k].Integer <= 0)) Fail("Image dimensions must be positive when declared.");
        }
        internal static void Attachment(Json j, Dictionary<string, int> bones, int ordinal = -1)
        {
            string type = j.S("type"); const string common = "type id name slotId ";
            NonEmpty(j, "name");
            if (type == "region")
            {
                Closed(j, common + "imageId x y rotation scaleX scaleY color alpha sequence", common + "imageId x y rotation scaleX scaleY");
                if (j.F("scaleX") == 0 || j.F("scaleY") == 0) Fail("Region scale must be nonzero.");
            }
            else if (type == "mesh")
            {
                Closed(j, common + "imageId rows cols vertices uvs indices weights bindInverses edges hull link color alpha sequence",
                    common + "imageId rows cols vertices uvs indices weights");
            }
            else if (type == "point") Closed(j, common + "x y rotation", common);
            else if (type == "path") Closed(j, common + "closed constantSpeed lengths vertices weights bindInverses", common);
            else if (type == "boundingbox") Closed(j, common + "vertices weights bindInverses", common);
            else if (type == "clipping") Closed(j, common + "endSlotId convex inverse vertices weights bindInverses", common);
            else Fail("Unknown attachment type: " + type);
            Rgb.Parse(j.S("color", "#ffffff")); Range(j, "alpha", 0, 1, 1);
            if (!j["sequence"].IsNull)
            {
                Closed(j["sequence"], "imageIds setupIndex", "imageIds setupIndex");
                var ids = j["sequence"]["imageIds"].Strings(); int index = j["sequence"].I("setupIndex");
                if (ids.Length == 0 || index < 0 || index >= ids.Length) Fail("Invalid sequence setup index.");
            }
            if (!j["link"].IsNull)
            {
                Closed(j["link"], "parentMeshId inheritDeform", "parentMeshId"); Id(j["link"], "parentMeshId");
                if (j.I("rows") != 0 || j.I("cols") != 0 || j["vertices"].Items.Count != 0 || j["uvs"].Items.Count != 0 || j["indices"].Items.Count != 0 || j["weights"].Items.Count != 0 || !j["bindInverses"].IsNull || !j["edges"].IsNull || !j["hull"].IsNull) Fail("Linked meshes cannot contain source geometry.");
                return;
            }
            if (type == "region" || type == "point") return;
            float[] vertices = j["vertices"].Floats(); int count = vertices.Length / 2;
            if (count > 65536) throw new RuntimeException(RuntimeErrorCode.ResourceLimit, "loadJson", "Source geometry exceeds 65536 vertices.", "attachments[" + ordinal + "].vertices");
            if (vertices.Length % 2 != 0) Fail("Vertex array must contain XY pairs.");
            if (type == "mesh")
            {
                if (j["uvs"].Items.Count != vertices.Length || j["indices"].Items.Count % 3 != 0) Fail("Invalid mesh UV or triangle counts.");
                long rows = j.I("rows"), cols = j.I("cols");
                if (rows <= 0 || cols <= 0 || (count != rows * cols && count != (rows + 1) * (cols + 1))) Fail("Mesh dimensions do not describe its vertices.");
                foreach (Json index in j["indices"].Items) if (index.Integer < 0 || index.Integer >= count) Fail("Mesh index is out of bounds.");
                foreach (Json index in j["edges"].ArrayOrEmpty) if (index.Integer < 0 || index.Integer >= count) Fail("Mesh boundary index is out of bounds.");
                if (j["edges"].ArrayOrEmpty.Count % 2 != 0 || j["hull"].ArrayOrEmpty.Count % 2 != 0) Fail("Mesh edges and hull must contain pairs.");
            }
            if (type == "path" && (vertices.Length < 12 || vertices.Length % 6 != 0)) Fail("Path must contain at least two cubic knots.");
            if (type == "clipping")
            {
                if (count < 3) Fail("Clipping needs at least three points.");
                double area = 0; for (int i = 0; i < count; i++) { int n = (i + 1) % count; area += (double)vertices[2 * i] * vertices[2 * n + 1] - (double)vertices[2 * n] * vertices[2 * i + 1]; }
                if (area == 0) Fail("Clipping polygon is degenerate.");
            }
            var weights = j["weights"].ArrayOrEmpty;
            if (weights.Count != 0 && weights.Count != count) Fail("Weight rows must match vertices.");
            foreach (Json row in weights)
            {
                if (row.Items.Count == 0 || row.Items.Count > 16) Fail("Invalid influence count."); float sum = 0;
                foreach (Json influence in row.Items)
                {
                    Closed(influence, "boneId weight x y", "boneId weight"); string boneId = Id(influence, "boneId");
                    if (!bones.ContainsKey(boneId)) Missing("weights.boneId", boneId);
                    Range(influence, "weight", 0, float.MaxValue); sum += influence.F("weight");
                    if (influence["x"].IsNull != influence["y"].IsNull) Fail("Influence coordinates must be paired.");
                    if (influence["x"].IsNull && j["bindInverses"][boneId].IsNull) Fail("Influence requires a bind inverse.");
                }
                if (Math.Abs(sum - 1) > 0.001f) Fail("Weights must sum to one within 0.001.");
            }
            if (!j["bindInverses"].IsNull) foreach (var pair in j["bindInverses"].Members)
            { if (!bones.ContainsKey(pair.Key)) Missing("bindInverses", pair.Key); Closed(pair.Value, "a b c d tx ty", "a b c d tx ty"); }
        }
        internal static void Atlas(Json j)
        {
            const string keys = "format formatVersion atlasId name colorSpace alphaMode pages regions"; Closed(j, keys, keys);
            Enum(j.S("format"), "cane-atlas"); Version(j["formatVersion"], 0, "formatVersion"); Id(j, "atlasId"); NonEmpty(j, "name");
            Enum(j.S("colorSpace"), "srgb linear"); Enum(j.S("alphaMode"), "straight premultiplied"); FiniteTree(j);
            var pages = new Dictionary<string, Json>(StringComparer.Ordinal); var paths = new HashSet<string>(StringComparer.Ordinal);
            foreach (Json p in j["pages"].Items)
            {
                const string pageKeys = "pageId image width height pixelFormat minFilter magFilter wrapU wrapV"; Closed(p, pageKeys, pageKeys);
                var id = Id(p, "pageId"); if (pages.ContainsKey(id)) Fail("Duplicate atlas page ID."); pages.Add(id, p);
                Path(p.S("image")); if (!paths.Add(AtlasValidation.AsciiFold(p.S("image")))) Fail("Atlas page paths collide.");
                string expectedPath = j.S("name") + (pages.Count == 1 ? "" : "-" + pages.Count.ToString(System.Globalization.CultureInfo.InvariantCulture)) + ".png";
                if (p.S("image") != expectedPath) Fail("Atlas page name must match its native name and page order.");
                if (p.I("width") <= 0 || p.I("height") <= 0) Fail("Invalid atlas page dimensions.");
                Enum(p.S("pixelFormat"), "rgba8"); Enum(p.S("minFilter"), "nearest linear"); Enum(p.S("magFilter"), "nearest linear");
                Enum(p.S("wrapU"), "clamp repeat mirror"); Enum(p.S("wrapV"), "clamp repeat mirror");
            }
            var ids = new HashSet<string>(StringComparer.Ordinal); var images = new HashSet<string>(StringComparer.Ordinal);
            foreach (Json r in j["regions"].Items)
            {
                const string regionKeys = "regionId imageId pageId x y width height sourceWidth sourceHeight sourceX sourceY rotation edgeExtension uvs"; Closed(r, regionKeys, regionKeys);
                if (!ids.Add(Id(r, "regionId")) || !images.Add(Id(r, "imageId"))) Fail("Duplicate atlas region/image ID.");
                if (!pages.TryGetValue(r.S("pageId"), out Json? p)) { Missing("regions.pageId", r.S("pageId")); return; }
                Enum(r.S("rotation"), "none clockwise90");
                int x = r.I("x"), y = r.I("y"), w = r.I("width"), h = r.I("height"), edge = r.I("edgeExtension");
                int sw = r.I("sourceWidth"), sh = r.I("sourceHeight"), sx = r.I("sourceX"), sy = r.I("sourceY"); bool rotated = r.S("rotation") == "clockwise90";
                if (w <= 0 || h <= 0 || sw <= 0 || sh <= 0 || x < edge || y < edge || edge < 0 || (long)x + w + edge > p.I("width") || (long)y + h + edge > p.I("height") || sx < 0 || sy < 0 || (long)sx + (rotated ? h : w) > sw || (long)sy + (rotated ? w : h) > sh) Fail("Atlas rectangle exceeds its bounds.");
                if (r["uvs"].Items.Count != 4) Fail("Atlas region requires four UV pairs.");
                double left = (double)x / p.I("width"), right = (double)(x + w) / p.I("width"), top = (double)y / p.I("height"), bottom = (double)(y + h) / p.I("height");
                double[] uv = rotated ? new[] { right, top, right, bottom, left, bottom, left, top } : new[] { left, top, right, top, right, bottom, left, bottom };
                for (int i = 0; i < 4; i++) { if (r["uvs"][i].Items.Count != 2) Fail("Atlas UV must be a pair."); for (int axis = 0; axis < 2; axis++) { double value = r["uvs"][i][axis].Number; if (value < 0 || value > 1 || Math.Abs(value - uv[i * 2 + axis]) > 1e-7) Fail("Atlas UV does not match its rectangle."); } }
            }
            AtlasValidation.DisjointAllocations(j["regions"].Items);
        }
        internal static void Constraint(Json j, RuntimeData data)
        {
            string type = j.S("type"); const string common = "type id name "; Id(j, "id"); NonEmpty(j, "name");
            switch (type)
            {
                case "ik":
                    Closed(j, common + "chainBoneIds targetBoneId target mix bendPositive compress stretch uniform softness iterations threshold", common + "chainBoneIds targetBoneId target mix bendPositive compress stretch uniform softness iterations threshold");
                    RefBones(j["chainBoneIds"], data); Closed(j["target"], "x y", "x y");
                    if (!j["targetBoneId"].IsNull) RefBone(j.S("targetBoneId"), data);
                    Range(j, "mix", 0, 1); Range(j, "softness", 0, float.MaxValue); Range(j, "threshold", 0, float.MaxValue);
                    if (j.I("iterations") <= 0) Fail("IK iterations must be positive.");
                    if (!(j["uniform"].Value is bool)) Enum(j["uniform"].String, "volume"); break;
                case "transform":
                    Closed(j, common + "boneIds targetBoneId local relative rotation x y scaleX scaleY shearY mixRotate mixX mixY mixScaleX mixScaleY mixShearY mapping", common + "boneIds targetBoneId");
                    RefBones(j["boneIds"], data); RefBone(j.S("targetBoneId"), data);
                    if (!j["mapping"].IsNull)
                    {
                        Closed(j["mapping"], "localSource localTarget clamp properties", "properties");
                        foreach (Json source in j["mapping"]["properties"].Items)
                        { Closed(source, "property offset targets", "property targets"); Enum(source.S("property"), "rotate x y scaleX scaleY shearY"); if (source["targets"].Items.Count == 0) Fail("Mapping needs a target.");
                          foreach (Json target in source["targets"].Items) { Closed(target, "property offset max scale", "property"); Enum(target.S("property"), "rotate x y scaleX scaleY shearY"); } }
                    }
                    break;
                case "path":
                    Closed(j, common + "boneIds targetSlotId positionMode spacingMode rotateMode rotation position spacing mixRotate mixX mixY", common + "boneIds targetSlotId positionMode spacingMode rotateMode rotation position spacing mixRotate mixX mixY");
                    RefBones(j["boneIds"], data); if (!data.SlotIndex.ContainsKey(j.S("targetSlotId"))) Missing("targetSlotId", j.S("targetSlotId"));
                    Enum(j.S("positionMode"), "fixed percent"); Enum(j.S("spacingMode"), "length fixed percent proportional"); Enum(j.S("rotateMode"), "tangent chain chainScale");
                    foreach (var k in new[] { "mixRotate", "mixX", "mixY" }) Range(j, k, 0, 1); break;
                case "physics":
                    Closed(j, common + "boneId x y rotate scaleX scaleYMode shearX limit fps inertia strength damping mass wind gravity mix inertiaGlobal strengthGlobal dampingGlobal massGlobal windGlobal gravityGlobal mixGlobal", common + "boneId");
                    RefBone(j.S("boneId"), data); Enum(j.S("scaleYMode", "none"), "none uniform volume");
                    foreach (var k in new[] { "x", "y", "rotate", "scaleX", "shearX" }) Range(j, k, 0, 1);
                    foreach (var k in new[] { "inertia", "damping", "mix" }) Range(j, k, 0, 1, 1);
                    Range(j, "mass", float.Epsilon, float.MaxValue, 1); Range(j, "fps", float.Epsilon, float.MaxValue, 60);
                    Range(j, "strength", 0, float.MaxValue, 100); Range(j, "limit", 0, float.MaxValue, 5000); break;
                case "slider":
                    Closed(j, common + "animationId looping additive sourceBoneId sourceProperty sourceOffset timeOffset timeScale rangeMax local time mix", common + "animationId");
                    if (!j["sourceBoneId"].IsNull) RefBone(j.S("sourceBoneId"), data); Enum(j.S("sourceProperty", "rotate"), "rotate x y scaleX scaleY shearY"); Range(j, "rangeMax", 0, float.MaxValue); break;
                default: Fail("Unknown constraint type: " + type); break;
            }
        }
        private static void RefBone(string id, RuntimeData data) { if (!data.BoneIndex.ContainsKey(id)) Missing("boneId", id); }
        private static void RefBones(Json j, RuntimeData data)
        { if (j.Items.Count == 0) Fail("Constraint requires bones."); var seen = new HashSet<string>(); foreach (Json id in j.Items) { RefBone(id.String, data); if (!seen.Add(id.String)) Fail("Duplicate constrained bone."); } }

        internal static void Animation(Json j, RuntimeData data)
        {
            const string keys = "id name duration fps boneTimelines slotTimelines attachmentTimelines constraintTimelines events drawOrder drawOrderFolders skins";
            Closed(j, keys, keys); NonEmpty(j, "name"); Range(j, "duration", 0, float.MaxValue); Range(j, "fps", float.Epsilon, float.MaxValue);
            float duration = j.F("duration");
            foreach (Json t in j["boneTimelines"].Items)
            {
                Closed(t, "boneId translate translateX translateY rotate scale scaleX scaleY shear shearX shearY inherit", "boneId"); RefBone(t.S("boneId"), data);
                foreach (var pair in t.Members)
                {
                    if (pair.Key == "boneId" || pair.Value.IsNull) continue;
                    string fields = pair.Key == "rotate" ? "angle" : pair.Key == "inherit" ? "inherit" : pair.Key.EndsWith("X", StringComparison.Ordinal) || pair.Key.EndsWith("Y", StringComparison.Ordinal) ? "value" : "x y";
                    Keys(pair.Value, duration, fields, fields);
                    if (pair.Key == "inherit") foreach (Json k in pair.Value.Items) Enum(k.S("inherit"), BoneModes);
                    if (pair.Key == "scale" || pair.Key == "scaleX" || pair.Key == "scaleY")
                        foreach (Json k in pair.Value.Items) FiniteKeyValues(k, fields);
                }
            }
            foreach (Json t in j["slotTimelines"].Items)
            {
                Closed(t, "slotId attachment color alpha", "slotId"); if (!data.SlotIndex.ContainsKey(t.S("slotId"))) Missing("slotTimelines.slotId", t.S("slotId"));
                Keys(t["attachment"], duration, "attachmentId", "attachmentId"); Keys(t["color"], duration, "color alpha darkColor", "color alpha darkColor"); Keys(t["alpha"], duration, "alpha", "alpha");
                foreach (Json k in t["color"].ArrayOrEmpty) { Rgb.Parse(k.S("color")); Range(k, "alpha", 0, 1); if (!k["darkColor"].IsNull) Rgb.Parse(k.S("darkColor")); }
                foreach (Json k in t["alpha"].ArrayOrEmpty) Range(k, "alpha", 0, 1);
            }
            foreach (Json t in j["attachmentTimelines"].Items)
            {
                Closed(t, "attachmentId region deform deformSpace sequence", "attachmentId");
                if (!data.AttachmentIndex.TryGetValue(t.S("attachmentId"), out int ai)) Missing("attachmentTimelines.attachmentId", t.S("attachmentId"));
                var a = data.AttachmentData[ai]; Enum(t.S("deformSpace", "vertexPositions"), "vertexPositions weightedInfluenceOffsets");
                Keys(t["region"], duration, "x y rotation scaleX scaleY", "x y rotation scaleX scaleY"); Keys(t["deform"], duration, "vertices", "vertices");
                Keys(t["sequence"], duration, "mode index delay", "mode index delay");
                if (!t["region"].IsNull && a.Kind != "region") Fail("Region timeline target is not a region.");
                foreach (Json k in t["region"].ArrayOrEmpty)
                {
                    FiniteKeyValues(k, "x y rotation scaleX scaleY");
                    if (k.F("scaleX") == 0 || k.F("scaleY") == 0) Fail("Region key scales must be nonzero.");
                }
                if (t["deform"].ArrayOrEmpty.Count > 0)
                {
                    if (a.Kind == "region" || a.Kind == "point" || a.DeformSourceId != a.Id) Fail("Illegal deform target.");
                    int size = a.GeometrySource.Vertices.Length;
                    if (t.S("deformSpace", "vertexPositions") == "weightedInfluenceOffsets")
                    { size = 0; foreach (Json row in a.GeometrySource.Raw["weights"].ArrayOrEmpty) size += row.Items.Count * 2; if (size == 0) Fail("Offset deform requires weights."); }
                    foreach (Json k in t["deform"].Items) if (k["vertices"].Items.Count != size) Fail("Deform array length mismatch.");
                }
                foreach (Json k in t["sequence"].ArrayOrEmpty)
                {
                    Enum(k.S("mode"), "hold once loop pingpong onceReverse loopReverse pingpongReverse");
                    int count = a.Raw["sequence"]["imageIds"].ArrayOrEmpty.Count;
                    if (k.I("index") < 0 || k.I("index") >= count || k.F("delay") < 0) Fail("Invalid sequence key.");
                }
            }
            foreach (Json t in j["constraintTimelines"].Items)
            {
                Closed(t, "type constraintId keys", "type constraintId keys"); Json? constraint = null;
                foreach (Json c in data.Constraints) if (c.S("id") == t.S("constraintId")) constraint = c;
                bool wildcardPhysics = t.S("type") == "physics" && t.S("constraintId") == "*";
                if (!wildcardPhysics && (constraint == null || constraint.S("type") != t.S("type"))) Fail("Constraint timeline type/reference mismatch.");
                string properties = t.S("type") switch
                { "ik" => "targetX targetY mix bendPositive compress stretch softness", "transform" => "mixRotate mixX mixY mixScaleX mixScaleY mixShearY", "path" => "position spacing mixRotate mixX mixY", "physics" => "mix inertia strength damping mass wind gravity reset", "slider" => "sliderTime mix", _ => "" };
                Keys(t["keys"], duration, properties);
            }
            Keys(j["events"], duration, "eventId name integerValue stringValue numberValue audioId volume balance", "eventId name");
            foreach (Json key in j["events"].Items) if (!key["integerValue"].IsNull) SignedInteger(key["integerValue"], "events.integerValue");
            Keys(j["drawOrder"], duration, "slotIds", "slotIds"); Keys(j["skins"], duration, "skinId", "skinId");
            foreach (Json k in j["drawOrder"].Items) Order(k["slotIds"], new HashSet<string>(data.SlotIndex.Keys));
            foreach (Json folder in j["drawOrderFolders"].Items)
            {
                Closed(folder, "folderPath slotIds keys", "folderPath slotIds keys");
                var members = new HashSet<string>(folder["slotIds"].Strings()); if (members.Count != folder["slotIds"].Items.Count) Fail("Duplicate folder slot.");
                foreach (var id in members) if (!data.SlotIndex.ContainsKey(id)) Missing("drawOrderFolders.slotIds", id);
                Keys(folder["keys"], duration, "slotIds", "slotIds"); foreach (Json key in folder["keys"].Items) Order(key["slotIds"], members);
            }
            foreach (Json k in j["skins"].Items) if (!k["skinId"].IsNull && !data.SkinDocuments.ContainsKey(k.S("skinId"))) Missing("skins.skinId", k.S("skinId"));
            foreach (Json k in j["events"].Items) if (!k["eventId"].IsNull && !data.EventDocuments.ContainsKey(k.S("eventId"))) Missing("events.eventId", k.S("eventId"));
        }
        internal static void Order(Json array, HashSet<string> required)
        { var seen = new HashSet<string>(); foreach (var id in array.Strings()) if (!required.Contains(id) || !seen.Add(id)) Fail("Invalid draw order."); if (seen.Count != required.Count) Fail("Incomplete draw order."); }
        internal static void SignedInteger(Json value, string field)
        {
            try { _ = value.SignedInteger; }
            catch (RuntimeException) { Fail("Expected a signed 64-bit integer.", field); }
        }
        private static void FiniteKeyValues(Json key, string fields)
        {
            foreach (string field in fields.Split(' '))
                if (!key[field].IsNumber || !Numeric.Finite(key[field].Float)) Fail("Expected a finite key scalar.", field);
        }
        internal static void Keys(Json keys, float duration, string fields, string required = "")
        {
            float previous = -1;
            foreach (Json key in keys.ArrayOrEmpty)
            { Closed(key, "time curve " + fields, "time " + required); float time = key.F("time"); if (time < 0 || time > duration || time < previous) Fail("Invalid key time/order."); previous = time; Curve(key["curve"], true); }
        }
        internal static void Curve(Json curve, bool bundle)
        {
            if (curve.IsNull) return;
            if (curve.Value is string s) { Enum(s, "linear stepped"); return; }
            switch (curve.S("type"))
            {
                case "bezier": Closed(curve, "type cx1 cy1 cx2 cy2", "type cx1 cy1 cx2 cy2"); break;
                case "bezier-value": Closed(curve, "type cx1 dy1 cx2 dy2", "type cx1 dy1 cx2 dy2"); break;
                case "properties":
                    if (!bundle) Fail("Nested property curves are forbidden.");
                    Closed(curve, "type default properties", "type properties"); Curve(curve["default"], false);
                    if (curve["properties"].Members.Count == 0) Fail("Empty property curve bundle.");
                    foreach (var p in curve["properties"].Members)
                    { Enum(p.Key, "x y rotation scale_x scale_y color_r color_g color_b dark_r dark_g dark_b alpha target_x target_y mix softness mix_rotate mix_x mix_y mix_scale_x mix_scale_y mix_shear_y position spacing inertia strength damping mass wind gravity slider_time"); Curve(p.Value, false); }
                    break;
                default: Fail("Invalid curve type."); break;
            }
        }
    }
}
