#!/usr/bin/env python3
"""Validate a local .mnaddon candidate without uploading, deploying, or installing it."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile


def local_path(root, value):
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or any(p.lower() == ".cursor" for p in path.parts):
        raise ValueError("Expected a repository-relative path")
    resolved = (root / path).resolve(strict=True)
    if resolved != root and root not in resolved.parents:
        raise ValueError("Path escapes the repository")
    return resolved


def validate(root, archive, manifest, source_root):
    root = root.resolve(strict=True)
    archive = local_path(root, archive)
    manifest = local_path(root, manifest)
    source_root = local_path(root, source_root)
    if archive.suffix != ".mnaddon" or not source_root.is_dir():
        raise ValueError("Expected a .mnaddon archive and a source directory")
    expected = json.loads(manifest.read_text(encoding="utf-8"))
    with zipfile.ZipFile(archive) as package:
        files = [item for item in package.infolist() if not item.is_dir()]
        if not files or len(files) > 10000 or sum(item.file_size for item in files) > 512 * 1024 * 1024:
            raise ValueError("Unexpected archive size")
        names = [item.filename for item in files]
        if len(names) != len(set(names)) or "mnaddon.json" not in names:
            raise ValueError("Duplicate archive entries or missing root manifest")
        for item in files:
            name = PurePosixPath(item.filename)
            if name.is_absolute() or item.filename != name.as_posix() or ".." in name.parts or "\\" in item.filename or any(p.lower() in {".git", ".cursor"} for p in name.parts):
                raise ValueError("Unsafe archive entry")
            if stat.S_ISLNK(item.external_attr >> 16) or item.file_size > 128 * 1024 * 1024:
                raise ValueError("Archive symlinks and oversized entries are forbidden")
            source = local_path(source_root, item.filename)
            if not source.is_file() or hashlib.sha256(package.read(item)).digest() != hashlib.sha256(source.read_bytes()).digest():
                raise ValueError("Archive/source byte parity failed")
        packaged = json.loads(package.read("mnaddon.json").decode("utf-8"))
        for key in ["addonid", "version"]:
            if not isinstance(expected.get(key), str) or not expected[key] or packaged.get(key) != expected[key]:
                raise ValueError("Candidate identity/version differs from source")
    return {"archive": str(archive.relative_to(root)), "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "file_count": len(files), "addonid": expected["addonid"], "version": expected["version"],
            "archive_source_parity": True, "device_acceptance": "pending"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--source-root", required=True)
    args = parser.parse_args()
    print(json.dumps(validate(Path.cwd().resolve(), args.archive, args.manifest, args.source_root), ensure_ascii=False))


if __name__ == "__main__":
    main()
