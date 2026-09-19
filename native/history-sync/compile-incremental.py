from pathlib import Path
import argparse, hashlib, json, subprocess, zipfile, shutil, re

parser = argparse.ArgumentParser()
parser.add_argument("--tools", required=True)
parser.add_argument("--work", required=True)
parser.add_argument("--base", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
tools = Path(args.tools)
work = Path(args.work)
work.mkdir(parents=True, exist_ok=True)
base = Path(args.base)
assert (
    hashlib.sha256(base.read_bytes()).hexdigest()
    == "1c9199d2f96f845797212867e196d29b3b8fd44d6dc99756fb05deac39d86d3d"
)
java = tools / "root/usr/lib/jvm/java-21-openjdk-arm64/bin/java"
javac = java.with_name("javac")
cp = ":".join(str(tools / n) for n in ["android.jar", "react-android.jar", "kotlin-stdlib.jar"])
smali = str(tools / "root/usr/share/java/*")


def run(*command):
    print("RUN", *map(str, command), flush=True)
    subprocess.run(list(map(str, command)), check=True)


classes = work / "classes"
classes.mkdir(exist_ok=True)
sources = sorted((root / "native/history-sync/android").glob("*.java"))
run(javac, "-J-XX:UseSVE=0", "--release", "17", "-cp", cp, "-d", classes, *sources)
policy = work / "policy-test"
policy.mkdir(exist_ok=True)
run(
    javac,
    "-J-XX:UseSVE=0",
    "--release",
    "17",
    "-d",
    policy,
    root / "native/history-sync/android/HistorySyncPolicy.java",
    root / "native/history-sync/HistorySyncPolicyTest.java",
)
run(java, "-XX:UseSVE=0", "-cp", policy, "app.outpost.historysync.HistorySyncPolicyTest")
jar = work / "addon.jar"
with zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(classes.rglob("*.class")):
        z.write(p, str(p.relative_to(classes)))
dex = work / "addon"
dex.mkdir(exist_ok=True)
run(
    java,
    "-XX:UseSVE=0",
    "-Xmx480m",
    "-cp",
    tools / "r8.jar",
    "com.android.tools.r8.D8",
    "--release",
    "--min-api",
    "24",
    "--lib",
    tools / "android.jar",
    "--classpath",
    tools / "react-android.jar",
    "--classpath",
    tools / "kotlin-stdlib.jar",
    "--output",
    dex,
    jar,
)
with zipfile.ZipFile(base) as z:
    original = work / "base-app.dex"
    original.write_bytes(z.read("classes2.dex"))
    dexnames = [n for n in z.namelist() if re.fullmatch(r"classes\d*\.dex", n)]
app = work / "app-smali"
run(
    java,
    "-XX:UseSVE=0",
    "-Xmx480m",
    "-cp",
    smali,
    "org.jf.baksmali.Main",
    "disassemble",
    original,
    "--jobs",
    "1",
    "--output",
    app,
)
main = app / "app/outpost/valorant/MainApplication.smali"
source = main.read_text()
anchor = "    invoke-virtual {v1}, Lcom/facebook/react/PackageList;->getPackages()Ljava/util/ArrayList;\n\n    move-result-object p0"
call = "\n\n    invoke-static {p0}, Lapp/outpost/historysync/OutpostHistorySyncPackage;->install(Ljava/util/List;)V"
assert source.count(anchor) == 1 and "OutpostHistorySyncPackage" not in source
before = {str(p.relative_to(app)): p.read_text() for p in app.rglob("*.smali")}
main.write_text(source.replace(anchor, anchor + call))
patched = work / "classes2.dex"
run(
    java,
    "-XX:UseSVE=0",
    "-Xmx480m",
    "-cp",
    smali,
    "org.jf.smali.Main",
    "assemble",
    app,
    "--api",
    "36",
    "--jobs",
    "1",
    "--output",
    patched,
)
verify = work / "verify-smali"
run(
    java,
    "-XX:UseSVE=0",
    "-Xmx480m",
    "-cp",
    smali,
    "org.jf.baksmali.Main",
    "disassemble",
    patched,
    "--jobs",
    "1",
    "--output",
    verify,
)
after = {str(p.relative_to(verify)): p.read_text() for p in verify.rglob("*.smali")}
assert before.keys() == after.keys()
normalize = lambda s: re.sub(
    r"(?m)^(\.field [^\n]+) = (?:false|null)$",
    r"\1",
    s.replace("const-string/jumbo", "const-string"),
)
changed = [n for n in before if normalize(before[n]) != normalize(after[n])]
assert changed == ["app/outpost/valorant/MainApplication.smali"], changed
assert normalize(after[changed[0]]) == normalize(main.read_text())
number = max(int(re.search(r"classes(\d*)", n).group(1) or 1) for n in dexnames) + 1
addon = work / f"classes{number}.dex"
shutil.copyfile(dex / "classes.dex", addon)
result = {
    "baselineSha256": hashlib.sha256(base.read_bytes()).hexdigest(),
    "compiler": "javac 21 --release 17 + Google D8 8.3.37",
    "androidSdk": 36,
    "reactNativeApi": "0.86.3",
    "newSourceFiles": [str(p.relative_to(root)) for p in sources],
    "nativePolicyAssertions": 18,
    "applicationDex": "classes2.dex",
    "changedExistingClasses": changed,
    "unchangedExistingClasses": len(before) - 1,
    "newDex": addon.name,
    "dexSha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [patched, addon]},
    "fullGradleRebuild": False,
}
(work / "native-verification.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2), flush=True)
