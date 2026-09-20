from pathlib import Path
import importlib.util, json, struct, sys, zipfile

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


patch = load("versions", root / "scripts/android-version.py").patch_version
audit = load("audit", root / "scripts/audit-android.py")
with zipfile.ZipFile(root / "builds/Outpost-0.9.4-android.apk") as z:
    original = z.read("AndroidManifest.xml")
rows = audit.manifest_elements(original)
updated = patch(original, "0.9.4", 26, "0.9.4.1", 27)
next_rows = audit.manifest_elements(updated)
manifest = next(r for r in next_rows if r["element"] == "manifest")
assert manifest["versionName"] == "0.9.4.1" and manifest["versionCode"] == 27
assert manifest["package"] == "app.outpost.valorant"
comparable = [dict(r) for r in next_rows]
for row in comparable:
    if row["element"] == "manifest":
        row.update(versionName="0.9.4", versionCode=26)
assert comparable == rows, "Non-version attributes changed"
again = patch(updated, "0.9.4.1", 27, "0.9.4.12", 28)
again_rows = audit.manifest_elements(again)
assert next(r for r in again_rows if r["element"] == "manifest")["versionName"] == "0.9.4.12"
assert struct.unpack_from("<I", again, 4)[0] == len(again)
rejected = 0
for args in [
    ("wrong", 26, "0.9.4.1", 27),
    ("0.9.4", 25, "0.9.4.1", 27),
    ("0.9.4", 26, "0.9.4.1", 26),
    ("0.9.4", 26, "bad version", 27),
]:
    try:
        patch(original, *args)
    except AssertionError:
        rejected += 1
assert rejected == 4
print(
    json.dumps(
        {
            "versionName": "0.9.4.1",
            "versionCode": 27,
            "packageUnchanged": True,
            "allOtherManifestElementsUnchanged": True,
            "longerFollowupVersionSupported": True,
            "invalidInputsRejected": rejected,
            "inputBytes": len(original),
            "outputBytes": len(updated),
        },
        indent=2,
    )
)
