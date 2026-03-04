const { notarize } = require('@electron/notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  if (!appleId || !appleIdPassword || !teamId || !process.env.CSC_LINK) {
    console.log('Skipping notarization — missing signing certificate or Apple credentials')
    return
  }

  console.log(`Notarizing ${appName}...`)

  await notarize({
    appBundleId: 'com.hoo.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId
  })

  console.log('Notarization complete.')
}
