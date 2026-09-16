from pathlib import Path
import sys, json, zipfile, hashlib, plistlib, struct, copy

if not __debug__:
    raise SystemExit("Run without Python -O: verification assertions must stay enabled.")
base, embedded, output = map(Path, sys.argv[1:4])
sha = lambda b: hashlib.sha256(b).hexdigest()
with zipfile.ZipFile(base) as source:
    assert source.testzip() is None
    names = source.namelist()
    root = next(
        n[:-10]
        for n in names
        if n.startswith("Payload/") and n.count("/") == 2 and n.endswith("Info.plist")
    )
    info = plistlib.loads(source.read(root + "Info.plist"))
    assert (
        info["CFBundleIdentifier"] == "app.outpost.valorant"
        and info["CFBundleShortVersionString"] == "0.6.4"
    )
    assert str(info["CFBundleVersion"]) == "10" and "iPhoneOS" in info["CFBundleSupportedPlatforms"]
    assert not any(
        n.startswith(root + "_CodeSignature/") or n == root + "embedded.mobileprovision"
        for n in names
    )
    native = source.read(root + info["CFBundleExecutable"])
    magic, cpu = struct.unpack_from("<II", native)
    assert magic == 0xFEEDFACF and cpu == 0x100000C
    pos = 32
    for _ in range(struct.unpack_from("<I", native, 16)[0]):
        command, size = struct.unpack_from("<II", native, pos)
        assert command != 0x1D and size >= 8
        pos += size
    old = source.read(root + "main.jsbundle")
    new = (embedded / "main.jsbundle").read_bytes()
    assert old[:12] == new[:12] and len(new) > 1000000 and old != new
    for p in embedded.rglob("*"):
        if p.is_file() and p.name != "main.jsbundle":
            assert (
                source.read(root + str(p.relative_to(embedded))) == p.read_bytes()
            ), "Native asset changed: " + str(p)
    info["CFBundleVersion"] = "11"
    config_path = root + "EXConstants.bundle/app.config"
    config = json.loads(source.read(config_path))
    assert config["version"] == "0.6.4"
    config.setdefault("ios", {})["buildNumber"] = "11"
    config.setdefault("android", {})["versionCode"] = 11
    replacements = {
        root + "main.jsbundle": new,
        root + "Info.plist": plistlib.dumps(info, fmt=plistlib.FMT_BINARY, sort_keys=False),
        config_path: json.dumps(config, separators=(",", ":")).encode(),
    }
    temp = output.with_suffix(output.suffix + ".partial")
    output.parent.mkdir(exist_ok=True, parents=True)
    with zipfile.ZipFile(temp, "w") as target:
        for entry in source.infolist():
            target.writestr(
                copy.copy(entry), replacements.get(entry.filename, source.read(entry.filename))
            )
    with zipfile.ZipFile(temp) as target:
        assert target.testzip() is None
        for name in names:
            if name not in replacements:
                assert target.read(name) == source.read(name), name
        assert sha(target.read(root + info["CFBundleExecutable"])) == sha(native)
    temp.replace(output)
    report = {
        "method": "unsigned cloud-native IPA with current embedded Hermes bundle and build metadata",
        "nativeExecutableUnchanged": True,
        "assetsUnchanged": True,
        "changedArchiveEntries": list(replacements),
        "hermesBytecodeVersion": struct.unpack_from("<I", new, 8)[0],
        "baseSha256": sha(base.read_bytes()),
        "bundleSha256": sha(new),
        "nativeSha256": sha(native),
        "ipaSha256": sha(output.read_bytes()),
        "version": "0.6.4",
        "build": "11",
        "bytes": output.stat().st_size,
        "signing": "unsigned - sign before installation",
    }
    output.with_suffix(".repack.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
