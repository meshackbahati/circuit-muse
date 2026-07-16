"""Boot-image manifest schema + JSON loader.

The manifest is the single source of truth for "what files are expected
to exist on disk before QEMU is launched for board X". It lives in
``manifest.json`` next to this module and is committed to the repo so
a refactor that bumps a kernel image is visible in code review.

Each ``ImageSetSpec`` corresponds to one board kind (e.g.
``raspberry-pi-3``). Adding a new board is appending a JSON entry; no
Python edit required.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .errors import ImageSetNotFoundError


@dataclass(frozen=True, slots=True)
class CompressedSource:
    """Wire-format description for assets that ship compressed.

    ``encoding`` is the algorithm identifier ('zstd' is the only one
    implemented today). ``sha256`` and ``size_bytes`` describe the file
    AS DOWNLOADED; the post-decompression hash lives on the owning
    :class:`BootImageSpec` so verification can run before AND after
    decompression.
    """

    encoding: str
    sha256: str
    size_bytes: int


@dataclass(frozen=True, slots=True)
class BootImageSpec:
    """One file the provider must materialise on disk.

    ``name`` is the final filename in the cache directory and what
    callers ask for. ``asset_id`` is the downloader-side identifier
    (e.g. the path component of the licence-gated URL or the filename
    inside a local directory). Decoupling the two lets the on-disk
    layout stay stable while the upstream asset name evolves.
    """

    name: str
    asset_id: str
    sha256: str
    size_bytes: int
    version: str | None = None
    compressed: CompressedSource | None = None


@dataclass(frozen=True, slots=True)
class ImageSetSpec:
    """A coherent group of boot files for a single board kind."""

    id: str
    description: str
    images: tuple[BootImageSpec, ...]

    def image(self, name: str) -> BootImageSpec:
        for img in self.images:
            if img.name == name:
                return img
        raise KeyError(f"image {name!r} not declared in set {self.id!r}")


@dataclass(frozen=True, slots=True)
class BootImagesManifest:
    """Top-level manifest object — loaded once at process start."""

    version: int
    image_sets: Mapping[str, ImageSetSpec]

    def get(self, set_id: str) -> ImageSetSpec:
        try:
            return self.image_sets[set_id]
        except KeyError as exc:
            known = ", ".join(sorted(self.image_sets)) or "(empty)"
            raise ImageSetNotFoundError(
                f"image_set {set_id!r} not in manifest. Known sets: {known}"
            ) from exc


def load_manifest(path: Path) -> BootImagesManifest:
    """Parse the manifest JSON at ``path``.

    Raises ``ValueError`` if any required key is missing or any sha256
    is malformed — fail-fast at process start beats a confusing error
    at first download.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    version = int(data["version"])
    sets_raw = data.get("image_sets", {})
    if not isinstance(sets_raw, Mapping):
        raise ValueError("manifest.image_sets must be an object")

    sets: dict[str, ImageSetSpec] = {}
    for set_id, set_raw in sets_raw.items():
        images: list[BootImageSpec] = []
        for img_raw in set_raw.get("images", []):
            compressed = None
            if img_raw.get("compressed"):
                c = img_raw["compressed"]
                compressed = CompressedSource(
                    encoding=str(c["encoding"]),
                    sha256=_check_sha256(c["sha256"]),
                    size_bytes=int(c["size_bytes"]),
                )
            images.append(
                BootImageSpec(
                    name=str(img_raw["name"]),
                    asset_id=str(img_raw["asset_id"]),
                    sha256=_check_sha256(img_raw["sha256"]),
                    size_bytes=int(img_raw["size_bytes"]),
                    version=(
                        str(img_raw["version"]) if img_raw.get("version") else None
                    ),
                    compressed=compressed,
                )
            )
        sets[set_id] = ImageSetSpec(
            id=str(set_id),
            description=str(set_raw.get("description", "")),
            images=tuple(images),
        )
    return BootImagesManifest(version=version, image_sets=sets)


def _check_sha256(value: str) -> str:
    v = value.strip().lower()
    if len(v) != 64 or not all(c in "0123456789abcdef" for c in v):
        raise ValueError(f"invalid sha256: {value!r}")
    return v
