# Sandboxed visual qualification image

Date: 2026-11-07.

User approved a scoped download of pinned Xvfb/Mesa packages. The existing network approval ledger now contains only `ports.ubuntu.com` for this image's Ubuntu package sources.

## Immutable inputs

- Base: `eclipse-temurin:21-jdk@sha256:ebfbb18d11ff163ee83b21258acf12248af48d22a0fdfdc68fa1a1516c05976a`.
- Xvfb: `2:21.1.22-1ubuntu1.3`.
- Mesa DRI: `26.0.8-1ubuntu0.3`.
- Mesa utilities: `9.0.0-2build1`.
- AWT X11 libraries: `libxtst6=2:1.2.5-1ubuntu0.1`, `libxi6=2:1.8.2-2`.
- Image tag: `voxellume/xvfb-jdk21:20261107`.
- Environment: `DISPLAY=:99`, `LIBGL_ALWAYS_SOFTWARE=1`.

## Verification

Latest image ID: `97b64a12b0cf`. `ldd /opt/java/openjdk/lib/libawt_xawt.so` resolves `libXtst.so.6` and `libXi.so.6` with the other AWT X11 dependencies.

The following boundaries were exercised: 2 CPUs, 4 GiB memory, 512 PIDs, `cap_drop=ALL`, `no-new-privileges`, read-only root, and a 512 MiB executable `/tmp` tmpfs. Xvfb ran at `:99` with TCP disabled. `glxinfo -B` returned Mesa llvmpipe with direct rendering and OpenGL 4.5 / GLES 3.2 support.

This proves a software-rendered client surface exists inside the sandbox. It does not establish any mod's client, production-JAR, aesthetic, or visual acceptance result. Those remain target-specific evidence gates.
