import json, struct, zipfile, sys, hashlib
from pathlib import Path


def manifest_elements(data):
    strings = []
    offset = 8
    elements = []

    def length8(p):
        value = data[p]
        p += 1
        if value & 128:
            value = ((value & 127) << 8) | data[p]
            p += 1
        return value, p

    while offset + 8 <= len(data):
        kind, header, size = struct.unpack_from("<HHI", data, offset)
        if size < header or offset + size > len(data):
            raise ValueError("Invalid Android XML chunk")
        if kind == 1:
            count, _, flags, start = struct.unpack_from("<4I", data, offset + 8)
            for index in range(count):
                rel = struct.unpack_from("<I", data, offset + header + index * 4)[0]
                p = offset + start + rel
                if flags & 256:
                    _, p = length8(p)
                    n, p = length8(p)
                    value = data[p : p + n].decode("utf-8")
                else:
                    n = struct.unpack_from("<H", data, p)[0]
                    p += 2
                    if n & 32768:
                        n = ((n & 32767) << 16) | struct.unpack_from("<H", data, p)[0]
                        p += 2
                    value = data[p : p + n * 2].decode("utf-16-le")
                strings.append(value)
        if kind == 258:
            name = struct.unpack_from("<I", data, offset + 20)[0]
            if True:
                first, step, count = struct.unpack_from("<HHH", data, offset + 24)
                result = {}
                for index in range(count):
                    p = offset + 16 + first + index * step
                    _, key, raw = struct.unpack_from("<III", data, p)
                    value_type, value = data[p + 15], struct.unpack_from("<I", data, p + 16)[0]
                    result[strings[key]] = (
                        strings[raw]
                        if raw != 0xFFFFFFFF
                        else strings[value]
                        if value_type == 3
                        else value
                    )
                elements.append({"element": strings[name], **result})
        offset += size
    return elements


def inspect(filename):
    path = Path(filename)
    with zipfile.ZipFile(path) as archive:
        rows = manifest_elements(archive.read("AndroidManifest.xml"))
        app = next(row for row in rows if row["element"] == "application")
        return {
            "file": path.name,
            "sha256": hashlib.file_digest(path.open("rb"), "sha256").hexdigest(),
            "permissions": sorted(
                {row["name"] for row in rows if row["element"].startswith("uses-permission")}
            ),
            "application": {
                key: app.get(key) for key in ["debuggable", "usesCleartextTraffic", "allowBackup"]
            },
            "exportedComponents": [
                row
                for row in rows
                if row["element"] in ["activity", "service", "receiver", "provider"]
                and row.get("exported") in ["true", True, 0xFFFFFFFF]
            ],
            "note": "Static manifest inspection only; no antivirus engine or reputation service was run.",
        }


if __name__ == "__main__":
    print(json.dumps(inspect(sys.argv[1]), indent=2))
