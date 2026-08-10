#!/usr/bin/env node
/**
 * Build MSI + portable zip from one electron publish, one APP_BUILD_STAMP.
 *
 * Output (same YYMMDD_HHMMSS):
 *   msi/Neo Desktop Calendar v{version}_{stamp}.msi
 *   msi/Neo Desktop Calendar v{version}_{stamp}_portable.zip
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUBLISH_EXE = path.join(ROOT, 'release', 'win-unpacked', 'Neo Desktop Calendar.exe')

function log(msg) {
  console.log(`[release] ${msg}`)
}

function run(cmd, options = {}) {
  log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, shell: true, ...options })
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(2)
  return `${yy}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function main() {
  const stamp = formatTimestamp()
  log(`build stamp: ${stamp}`)

  run(`node scripts/sync-version.mjs --stamp=${stamp}`)
  run('npm run build:desktop-hit')
  run('npm run build')
  run('npx electron-builder --win --dir')

  if (!fs.existsSync(PUBLISH_EXE)) {
    throw new Error(`Publish output not found: ${PUBLISH_EXE}`)
  }

  const env = {
    ...process.env,
    NEO_BUILD_STAMP: stamp,
    NEO_SKIP_STAMP: '1',
    NEO_SKIP_PUBLISH: '1'
  }

  run('node scripts/build-msi.mjs', { env })
  run('node scripts/build-portable.mjs', { env })

  log(`done — MSI + portable share stamp ${stamp}`)
}

try {
  main()
} catch (error) {
  console.error('[release] failed:', error.message ?? error)
  process.exit(1)
}
