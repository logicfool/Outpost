import struct


def patch_version(raw, old_name, old_code, new_name, new_code):
    assert len(raw) >= 8 and struct.unpack_from("<HHI", raw) == (3, 8, len(raw))
    assert isinstance(new_code, int) and old_code < new_code < 2100000000
    assert 0 < len(new_name) < 100 and all(c.isdigit() or c == "." for c in new_name)
    chunks, strings, flags = [], [], 0
    offset = 8

    def read_length(data, position):
        value = data[position]
        position += 1
        if value & 128:
            value = ((value & 127) << 8) | data[position]
            position += 1
        return value, position

    while offset < len(raw):
        kind, header, size = struct.unpack_from("<HHI", raw, offset)
        assert size >= header >= 8 and offset + size <= len(raw)
        data = bytearray(raw[offset : offset + size])
        chunks.append((kind, data))
        if kind == 1:
            assert not strings
            count, styles, flags, start, _ = struct.unpack_from("<5I", data, 8)
            assert styles == 0
            for index in range(count):
                position = start + struct.unpack_from("<I", data, header + index * 4)[0]
                if flags & 256:
                    _, position = read_length(data, position)
                    size_text, position = read_length(data, position)
                    text = bytes(data[position : position + size_text]).decode("utf8")
                else:
                    length = struct.unpack_from("<H", data, position)[0]
                    position += 2
                    assert length < 32768
                    text = bytes(data[position : position + 2 * length]).decode("utf-16-le")
                strings.append(text)
        offset += size
    assert offset == len(raw) and strings
    new_index = len(strings)
    strings.append(new_name)
    updated = set()
    for kind, data in chunks:
        if kind != 258 or strings[struct.unpack_from("<I", data, 20)[0]] != "manifest":
            continue
        first, step, count = struct.unpack_from("<HHH", data, 24)
        for index in range(count):
            position = 16 + first + index * step
            _, key, raw_index = struct.unpack_from("<III", data, position)
            value_type = data[position + 15]
            value = struct.unpack_from("<I", data, position + 16)[0]
            if strings[key] == "versionCode":
                assert value_type in (16, 17) and value == old_code
                struct.pack_into("<I", data, position + 16, new_code)
                updated.add("code")
            elif strings[key] == "versionName":
                assert value_type == 3 and strings[value] == old_name
                if raw_index != 0xFFFFFFFF:
                    assert strings[raw_index] == old_name
                    struct.pack_into("<I", data, position + 8, new_index)
                struct.pack_into("<I", data, position + 16, new_index)
                updated.add("name")
    assert updated == {"code", "name"}

    def length8(length):
        assert length < 32768
        return bytes([length]) if length < 128 else bytes([(length >> 8) | 128, length & 255])

    offsets, values, size = [], [], 0
    for text in strings:
        offsets.append(size)
        utf16 = text.encode("utf-16-le")
        if flags & 256:
            utf8 = text.encode("utf8")
            value = length8(len(utf16) // 2) + length8(len(utf8)) + utf8 + b"\0"
        else:
            value = struct.pack("<H", len(utf16) // 2) + utf16 + b"\0\0"
        values.append(value)
        size += len(value)
    payload = b"".join(values)
    payload += b"\0" * ((-len(payload)) % 4)
    start = 28 + 4 * len(strings)
    pool = struct.pack(
        "<HHI5I", 1, 28, start + len(payload), len(strings), 0, flags & 256, start, 0
    )
    pool += struct.pack("<" + "I" * len(offsets), *offsets) + payload
    output = b"".join(pool if kind == 1 else bytes(data) for kind, data in chunks)
    return struct.pack("<HHI", 3, 8, len(output) + 8) + output
