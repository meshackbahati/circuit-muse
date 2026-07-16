# Boot-image provider

Some emulated boards (Raspberry Pi 3, future Pi 4 / Pi 5 if we add
them) need substantial boot files at runtime — kernel, device tree,
and a multi-GiB SD image. Shipping those inside the Docker image is
wasteful (image bloat, every rebuild re-pushes the layer) and
licensing-fragile (third-party OS forks). Pulling them at
container-build time would tie kernel updates to app rebuilds.

The boot-image provider solves this with **lazy, content-addressed,
cache-on-named-volume** materialisation. First user request for a
Pi 3 simulation triggers download + SHA256 verification +
decompression; every subsequent request is a cache hit.

## Architecture

```
backend/app/services/boot_images/
├── __init__.py        public API + get_default_provider() singleton
├── manifest.py        BootImageSpec / ImageSetSpec / BootImagesManifest
├── manifest.json      versioned source of truth
├── integrity.py       sha256_file, verify_sha256, decompress_zstd
├── downloader.py      AssetDownloader Protocol + 2 implementations
├── provider.py        BootImageProvider (the orchestrator)
└── errors.py          typed exceptions
```

The key contract is the `AssetDownloader` Protocol:

```python
class AssetDownloader(Protocol):
    async def fetch(self, asset_id: str, target_path: Path) -> None: ...
```

Two implementations ship in-box:

* **`LicenseGatedDownloader`** — production default. Fetches from
  `${VELXIO_BINARY_BASE_URL}/{asset_id}?key=${VELXIO_LICENSE_KEY}`,
  i.e. the same licence-module endpoint that already serves the
  ESP32 / RISC-V QEMU libs.
* **`LocalDirectoryDownloader`** — self-hosters / tests. Reads
  `${VELXIO_BOOT_IMAGES_LOCAL_DIR}/<asset_id>` (flat) or
  `<asset_id>/manifest.json + binary` (matches the licence
  module's storage layout, so the in-prod backend can point at
  `/var/velxio-pro/binaries` directly).

`build_downloader_from_env()` picks one — local-dir wins if both
sets of env vars are present.

## On-disk layout

The provider caches everything under
`${VELXIO_BOOT_IMAGE_CACHE_DIR}` (default
`/var/cache/velxio/boot-images`). Each image set gets a subdirectory:

```
/var/cache/velxio/boot-images/
├── raspberry-pi-3/
│   ├── kernel8.img                       ← 9.3 MB raw
│   ├── bcm2710-rpi-3-b.dtb               ← 34 KB raw
│   └── raspios-trixie-armhf.img          ← 5.4 GB raw
└── (future image sets here)
```

In `docker-compose.yml` mount this as a named volume so it survives
`compose down/up`:

```yaml
volumes:
  - boot-images:/var/cache/velxio/boot-images

volumes:
  boot-images:
```

## Guarantees the provider gives you

1. **Atomic writes.** Files are downloaded to `<name>.tmp` inside the
   cache directory, verified, and `rename()`-d into the final slot.
   A killed container during download leaves the cache untouched.
2. **Content-addressed verification.** Every materialised file is
   `sha256_file()`'d against the manifest. Mismatches raise
   `IntegrityError` and DO NOT replace the existing cached file.
3. **Decompression is part of the verify ladder.** For compressed
   assets the wire-format SHA256 is verified before decompression and
   the decompressed SHA256 after, so a corrupt-on-wire or corrupt-
   after-decompress both surface as `IntegrityError` with `name=
   "<file> (compressed)"` vs `"<file> (decompressed)"`.
4. **Per-set concurrency control.** Two concurrent
   `provider.get("raspberry-pi-3")` collapse into one download via a
   per-set `asyncio.Lock`. Different sets materialise in parallel.
5. **Idempotent re-gets.** Cached files are re-validated by size +
   SHA256 before being returned, so a corrupted cache (disk error,
   manual `rm`) auto-repairs.

## Adding a new image set

1. Run the asset prep script
   (`velxio-prod/scripts/prepare-pi3-images.sh`, adapt for the new
   board) to produce the files + SHA256s.
2. Upload to the licence-module storage with `upload-binary.sh`.
3. Append the entry to `manifest.json`:

   ```json
   "raspberry-pi-4": {
     "description": "...",
     "images": [
       {
         "name": "kernel8.img",
         "asset_id": "kernel8-pi4",
         "sha256": "...",
         "size_bytes": ...
       }
     ]
   }
   ```

4. Register a lifespan pre-warm in whatever service module owns the
   new board's QEMU integration (mirror
   `qemu_manager.py:_prewarm_pi3_boot_images`).
5. Call `provider.get("raspberry-pi-4")` from the boot code; iterate
   over the returned `{name: Path}` dict.

No edits to `provider.py` or `downloader.py` should be needed —
the abstraction is meant to absorb new boards purely through manifest
edits.

## When something goes wrong

| Symptom | Likely cause | Where to look |
|---|---|---|
| `NoDownloaderConfiguredError` at startup | neither env-var pair set | `build_downloader_from_env()` |
| `IntegrityError: …(compressed)` | the .zst on the wire is corrupt OR `compressed.sha256` in the manifest is wrong | re-verify the upload against `manifest.json` |
| `IntegrityError: …(decompressed)` | the .zst decompressed correctly but the underlying bytes drifted; usually means we bumped the source image but forgot to bump `sha256` | regenerate the manifest from `scripts/prepare-*` |
| `DownloadError: HTTP 401` | licence key invalid / suspended | check `${VELXIO_LICENSE_KEY}` + `pro` admin panel |
| First Pi 3 simulation request hangs ~60 s | the lifespan pre-warm failed silently and the user hit the cold-cache download path | grep backend log for `[boot-images]` |
| Files re-download on every container restart | named volume not mounted on `${VELXIO_BOOT_IMAGE_CACHE_DIR}` | check `docker-compose.yml` |

## Tests

`test/backend/unit/test_boot_images.py` covers 21 scenarios across
manifest parsing, integrity, both downloaders, the provider's
idempotent / concurrent / integrity / decompression / warmup paths.
Run with:

```bash
pytest test/backend/unit/test_boot_images.py -v
```

The provider tests use an in-process `FakeDownloader` so they don't
need network, httpx, or real zstd files past the `decompress_zstd`
unit test (which uses `zstandard.ZstdCompressor()` to round-trip a
small in-memory blob).
