// electron-builder custom Windows sign hook (win.signtoolOptions.sign).
//
// electron-builder calls this for every file it signs, in packaging order: the app exe
// (before it is packed into the installers), the uninstaller, then the NSIS installer
// and the portable exe. Signing inside packaging is the point: signing only the finished
// installers left the installed "i3X Explorer.exe" unsigned, and Windows 11 Smart App
// Control blocks unsigned executables outright.
//
// Each file goes through signtool.exe with the Azure Trusted Signing dlib. The paths come
// from scripts/prepare-win-signing.ps1, which sets I3X_SIGNTOOL, I3X_SIGN_DLIB and
// I3X_SIGN_METADATA. With none of them set (e.g. `npm run build:win` on a Mac) the build
// is left unsigned; with only some set, the build fails rather than ship half-signed.

const { execFileSync } = require('node:child_process')
const path = require('node:path')

const VARS = ['I3X_SIGNTOOL', 'I3X_SIGN_DLIB', 'I3X_SIGN_METADATA']

// Exported by name: electron-builder looks up a `sign` export first, which works whether
// it loads this file with require() or import().
exports.sign = async function sign(configuration) {
  const set = VARS.filter((v) => process.env[v])
  if (set.length === 0) {
    console.log(`  • skipping signing (run scripts/prepare-win-signing.ps1 first)  file=${path.basename(configuration.path)}`)
    return
  }
  if (set.length < VARS.length) {
    throw new Error(`Windows signing is half-configured: missing ${VARS.filter((v) => !process.env[v]).join(', ')}`)
  }

  const args = [
    'sign',
    '/v',
    '/fd', 'SHA256',
    '/tr', 'http://timestamp.acs.microsoft.com',
    '/td', 'SHA256',
    '/dlib', process.env.I3X_SIGN_DLIB,
    '/dmdf', process.env.I3X_SIGN_METADATA,
    configuration.path,
  ]
  console.log(`  • signing with Azure Trusted Signing  file=${path.basename(configuration.path)}`)
  try {
    execFileSync(process.env.I3X_SIGNTOOL, args, { stdio: 'pipe', encoding: 'utf8' })
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`signtool failed for ${configuration.path} (exit ${e.status})\n${out}`)
  }
}
