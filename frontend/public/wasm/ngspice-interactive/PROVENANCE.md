# ngspice-interactive WASM provenance

These files were copied verbatim from the `dist/` directory of
[`ejkreboot/ngspice-xspice-wasm`](https://github.com/ejkreboot/ngspice-xspice-wasm)
(MIT-licensed) on **2026-05-15**.

| File | Source | License |
|---|---|---|
| `ngspice-lib.wasm` | Built from ngspice (BSD-3-Clause-like) | BSD-style |
| `ngspice-lib.js` | Emscripten glue (MIT) | MIT |
| `*.cm` (XSpice code models) | ngspice source (BSD-3-Clause-like) | BSD-style |
| `spinit` | ngspice source | BSD-style |

The WASM build was produced with `emscripten/emsdk:3.1.50` against
ngspice with these configure flags:
```
--disable-debug --with-readline=no --disable-openmp
--enable-xspice --with-ngshared --without-x
```

The ngspice C-level shared callable API (`ngSpice_Init`, `ngSpice_Command`,
`ngSpice_AllVecs`, `ngSpice_Reset`, etc.) is exposed natively via
emscripten's `Module.cwrap`.  See
`../../src/simulation/spice/wasm/NgSpiceInteractive.ts` for the
JavaScript surface that drives the mixed-mode simulator.

To rebuild from source (not required — these prebuilt artifacts are
sufficient), see ejkreboot's repo for the Dockerfile + `build-ngspice.sh`.
