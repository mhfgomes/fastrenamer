# Exclusive rename

This small Node-API v8 addon intentionally has no JavaScript fallback. It uses
`renameat2(RENAME_NOREPLACE)` on Linux, `renamex_np(RENAME_EXCL)` on macOS,
and `MoveFileExW` with flags zero on Windows. These operations cover files,
directories and symlinks without replacing an existing destination. Unsupported
kernels/filesystems return an error; cross-volume copy/delete is never enabled.
The planner uses the same primitive for staging, final moves, undo/recovery and
rollback. Preflight lstat remains useful for diagnostics, not synchronization.

Build prerequisites: Node, Python, and the platform C++ toolchain (Xcode command
line tools, Linux make/g++, or Visual Studio C++ build tools). `bun run dev`,
`bun run test`, and `bun run build` compile the addon explicitly with node-gyp;
Bun dependency lifecycle trust is not required. Node-API avoids an Electron/V8
ABI rebuild. `bun run native:smoke` exercises the addon in the installed Electron
runtime. CI runs native tests/build/smoke on all three operating systems.

Electron Builder copies the binary outside app.asar using extraResources; the
loader uses Electron's resourcesPath only for packaged apps. The beforePack hook
rejects cross-OS/architecture packaging. Build on each target host; universal
and cross-architecture packages require a separate binary selection pipeline.
The single metadata syscall runs in a Node-API worker so slow filesystems do not
block the main event loop. Awaited completion preserves rename/rollback ordering;
no subprocess is involved in renames.

References:
- https://man7.org/linux/man-pages/man2/rename.2.html
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/stdio.h
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw
