/**
 * Notarization hook for electron-builder (afterSign).
 *
 * Requires these environment variables to be set:
 *   APPLE_ID                  – your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD – app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID             – your 10-character team ID from developer.apple.com
 *
 * If any are missing the step is skipped with a warning (graceful no-op).
 */

exports.default = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;

  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      '\n⚠️  Notarization skipped — to enable, set:\n' +
      '     APPLE_ID                   (your Apple ID email)\n' +
      '     APPLE_APP_SPECIFIC_PASSWORD (from appleid.apple.com → App-Specific Passwords)\n' +
      '     APPLE_TEAM_ID              (10-char ID from developer.apple.com/account)\n'
    );
    return;
  }

  const { notarize } = require('@electron/notarize');
  const { execFileSync } = require('child_process');

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;

  console.log(`\nNotarizing ${appPath} ...`);
  await notarize({
    tool: 'notarytool',
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  console.log('Stapling notarization ticket ...');
  execFileSync('xcrun', ['stapler', 'staple', appPath], { stdio: 'inherit' });

  console.log('Notarization complete.\n');
};
