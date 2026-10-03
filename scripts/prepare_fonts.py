"""Prepare only the eight reviewed source files; never modify an original."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

import brotli
import fontTools
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.DefaultTable import DefaultTable

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fonts"
TARGET = Path(os.environ.get("FONT_DATA_DIR", ROOT / "data/fonts"))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_json(path, value):
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as f:
        json.dump(value, f, ensure_ascii=False, separators=(",", ":"))
        temporary = Path(f.name)
    temporary.replace(path)


def main():
    assert TARGET.resolve() != SOURCE.resolve(), "Prepared files must be separate from originals"
    TARGET.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((SOURCE / "catalog.json").read_text())
    pipeline = digest(Path(__file__).read_bytes() + (ROOT / "scripts/subset_font.py").read_bytes()
                      + (fontTools.__version__ + brotli.__version__).encode())
    manifest = []
    for item in catalog:
        source = SOURCE / item["file"]
        data = source.read_bytes()
        if digest(data) != item["sha256"]:
            raise ValueError(f"Source changed; review required: {source.name}")
        font = TTFont(source, recalcTimestamp=False)
        repair = item["repair"]
        if repair == "vhea-version":
            raw = font.reader["vhea"]
            assert raw[:4] == bytes.fromhex("00010001")
            table = DefaultTable("vhea")
            table.data = bytes.fromhex("00010000") + raw[4:]
            font["vhea"] = table
        elif repair == "vertical-count":
            font["vmtx"]  # Decode against maxp; serialization drops excess metrics.
            font["vhea"]
        elif repair == "drop-vertical":
            del font["vhea"]
            del font["vmtx"]
        elif repair == "post-alignment":
            raw = font.reader["post"]
            assert raw[:4] == bytes.fromhex("30003000")
            table = DefaultTable("post")
            table.data = bytes.fromhex("00030000") + raw[4:]
            font["post"] = table
        else:
            assert repair == "none"
        version = digest((item["sha256"] + pipeline + repair).encode())[:24]
        filename = f'{item["id"]}.{version}.ttf'
        with tempfile.NamedTemporaryFile(dir=TARGET, suffix=".ttf", delete=False) as f:
            temporary = Path(f.name)
        try:
            if repair == "none":
                temporary.write_bytes(data)
            else:
                font.save(temporary)
            with TTFont(temporary) as checked:
                cmap = checked.getBestCmap()
                glyphs = checked["glyf"]
                coverage = "".join(chr(cp) for cp, name in sorted(cmap.items())
                                   if cp <= 0x10FFFF and name != ".notdef"
                                   and glyphs[name].numberOfContours != 0)
                assert all(c in coverage for c in "永和安"), source.name
            temporary.replace(TARGET / filename)
        finally:
            temporary.unlink(missing_ok=True)
            font.close()
        entry = {"id": item["id"], "name": item["name"], "style": item["style"],
                 "version": version, "file": filename, "coverage": coverage,
                 "sourceSha256": item["sha256"], "repair": repair}
        atomic_json(TARGET / f'{item["id"]}.{version}.json', entry)
        manifest.append(entry)
        assert digest(source.read_bytes()) == item["sha256"]
        print(f'{item["id"]}: prepared; {len(coverage)} nonempty mapped characters')
    atomic_json(TARGET / "manifest.json", manifest)


if __name__ == "__main__":
    main()
