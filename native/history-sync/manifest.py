import struct

NO = 0xFFFFFFFF
ANDROID = "http://schemas.android.com/apk/res/android"
PERMISSION = "android.permission.FOREGROUND_SERVICE_DATA_SYNC"
SERVICE = "app.outpost.historysync.OutpostHistorySyncService"
IDS = {
    "name": 0x01010003,
    "exported": 0x01010010,
    "stopWithTask": 0x0101036A,
    "foregroundServiceType": 0x01010599,
}


def add_sync_service(raw):
    chunks = []
    offset = 8
    strings = []
    flags = 0
    resource_ids = []

    def len8(data, p):
        n = data[p]
        p += 1
        if n & 128:
            n = ((n & 127) << 8) | data[p]
            p += 1
        return n, p

    while offset < len(raw):
        kind, header, size = struct.unpack_from("<HHI", raw, offset)
        assert size >= header and offset + size <= len(raw)
        data = raw[offset : offset + size]
        chunks.append((kind, data))
        if kind == 1:
            count, styles, flags, start, _ = struct.unpack_from("<5I", data, 8)
            assert styles == 0
            for i in range(count):
                p = start + struct.unpack_from("<I", data, header + 4 * i)[0]
                if flags & 256:
                    _, p = len8(data, p)
                    n, p = len8(data, p)
                    s = data[p : p + n].decode("utf8")
                else:
                    n = struct.unpack_from("<H", data, p)[0]
                    p += 2
                    assert n < 32768
                    s = data[p : p + 2 * n].decode("utf-16-le")
                strings.append(s)
        elif kind == 0x180:
            resource_ids = list(
                struct.unpack_from("<" + "I" * ((size - header) // 4), data, header)
            )
        offset += size
    assert offset == len(raw) and SERVICE not in strings and PERMISSION not in strings
    resource_ids += [0] * (len(strings) - len(resource_ids))

    def idx(value, rid=0):
        for i, s in enumerate(strings):
            if s == value and (not rid or resource_ids[i] == rid):
                return i
        strings.append(value)
        resource_ids.append(rid)
        return len(strings) - 1

    ns = idx(ANDROID)

    def node(tag, attrs):
        attrs = sorted(attrs, key=lambda a: IDS[a[0]])
        encoded = []
        for key, kind, value in attrs:
            name = idx(key, IDS[key])
            v = idx(value) if kind == 3 else value
            encoded.append(struct.pack("<IIIHBBI", ns, name, v if kind == 3 else NO, 8, 0, kind, v))
        name = idx(tag)
        start = (
            struct.pack("<HHIII", 258, 16, 36 + 20 * len(attrs), 0, NO)
            + struct.pack("<IIHHHHHH", NO, name, 20, 20, len(attrs), 0, 0, 0)
            + b"".join(encoded)
        )
        end = struct.pack("<HHIIIII", 259, 16, 24, 0, NO, NO, name)
        return start + end

    permission = node("uses-permission", [("name", 3, PERMISSION)])
    service = node(
        "service",
        [
            ("name", 3, SERVICE),
            ("exported", 18, 0),
            ("stopWithTask", 18, 0xFFFFFFFF),
            ("foregroundServiceType", 17, 1),
        ],
    )

    def length(n):
        assert n < 32768
        return bytes([n]) if n < 128 else bytes([(n >> 8) | 128, n & 255])

    values = []
    offsets = []
    size = 0
    for s in strings:
        offsets.append(size)
        utf16 = s.encode("utf-16-le")
        if flags & 256:
            text = s.encode("utf8")
            value = length(len(utf16) // 2) + length(len(text)) + text + b"\0"
        else:
            value = struct.pack("<H", len(utf16) // 2) + utf16 + b"\0\0"
        values.append(value)
        size += len(value)
    payload = b"".join(values)
    payload += b"\0" * ((-len(payload)) % 4)
    start = 28 + 4 * len(strings)
    pool = (
        struct.pack("<HHI5I", 1, 28, start + len(payload), len(strings), 0, flags & 256, start, 0)
        + struct.pack("<" + "I" * len(offsets), *offsets)
        + payload
    )
    resource = struct.pack("<HHI", 0x180, 8, 8 + 4 * len(resource_ids)) + struct.pack(
        "<" + "I" * len(resource_ids), *resource_ids
    )
    result = []
    permissions = services = 0
    for kind, data in chunks:
        if kind == 1:
            result.append(pool)
            continue
        if kind == 0x180:
            result.append(resource)
            continue
        if kind == 258 and strings[struct.unpack_from("<I", data, 20)[0]] == "application":
            result.append(permission)
            permissions += 1
        if kind == 259 and strings[struct.unpack_from("<I", data, 20)[0]] == "application":
            result.append(service)
            services += 1
        result.append(data)
    assert permissions == services == 1
    output = b"".join(result)
    return struct.pack("<HHI", 3, 8, len(output) + 8) + output
