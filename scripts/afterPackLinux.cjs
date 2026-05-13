// afterPackLinux.cjs — injects --no-sandbox for Linux AppImage/tar.gz builds
//
// AppImages mount squashfs as a regular user, so chrome-sandbox loses its SUID
// bit and Chromium refuses to start. executableArgs only reaches the .desktop
// file (used by desktop launchers), not AppRun, so it doesn't help when the
// AppImage is run directly or via AppImageLauncher binfmt.
//
// Solution: rename the real binary to <name>-bin and replace it with a tiny
// wrapper script that adds --no-sandbox before delegating. AppRun calls
// exec "$BIN" which lands on the wrapper, which calls the real binary.

const path = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return

  const appOutDir = context.appOutDir
  const exeName = context.packager.executableName   // e.g. "i3x-explorer"
  const exePath = path.join(appOutDir, exeName)
  const realExeName = `${exeName}-bin`
  const realExePath = path.join(appOutDir, realExeName)

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPackLinux] executable not found: ${exePath} — skipping`)
    return
  }

  fs.renameSync(exePath, realExePath)

  fs.writeFileSync(exePath,
    `#!/bin/bash\nexec "$(dirname "$(readlink -f "$0")")/${realExeName}" --no-sandbox "$@"\n`,
    { mode: 0o755 }
  )

  console.log(`[afterPackLinux] wrapped ${exeName} → ${realExeName} with --no-sandbox`)
}
