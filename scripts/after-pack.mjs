/**
 * electron-builder extraResources copies macOS 7za as 644.
 * Restore +x before DMG/zip so backup import/export can spawn it.
 */
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {import('app-builder-lib').AfterPackContext} context
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const resources = join(context.appOutDir, appName, 'Contents', 'Resources')
  const files = [
    join(resources, '7zip', 'arm64', '7za'),
    join(resources, '7zip', 'x64', '7za'),
    join(resources, '7zip', '7za'),
    join(resources, 'app.asar.unpacked', 'node_modules', '7zip-bin', 'mac', 'arm64', '7za'),
    join(resources, 'app.asar.unpacked', 'node_modules', '7zip-bin', 'mac', 'x64', '7za')
  ]

  for (const filePath of files) {
    if (!existsSync(filePath)) continue
    chmodSync(filePath, 0o755)
    console.log(`[after-pack] chmod +x ${filePath}`)
  }
}
