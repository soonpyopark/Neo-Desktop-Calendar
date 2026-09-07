#!/usr/bin/env node
/**
 * Build macOS DMG + zip from one electron publish, one APP_BUILD_STAMP.
 *
 * Must run on macOS (electron-builder cannot produce .app/.dmg on Windows).
 *
 * Output (same YYMMDD_HHMMSS):
 *   msi/Neo Desktop Calendar v{version}_{stamp}_macOS.dmg
 *   msi/Neo Desktop Calendar v{version}_{stamp}_macOS.zip
 *
 * Desktop WorkerW embed is Windows-only; the Mac build is a normal app window.
 * Packaged listen port is 3012 (Windows / npm run dev stay on 3010).
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP_NAME = 'Neo Desktop Calendar'
const SITE_URL = 'https://note4all.tistory.com'
const RELEASE_DIR = path.join(ROOT, 'release')
const OUT_DIR = path.join(ROOT, 'msi')

function log(msg) {
  console.log(`[dist-mac] ${msg}`)
}

function run(cmd, options = {}) {
  log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, shell: true, ...options })
}

function readVersion() {
  const constants = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'constants.ts'), 'utf8')
  const match = constants.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (match?.[1]) return match[1]
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  return pkg.version ?? '1.0.0'
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(2)
  return `${yy}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function listReleaseFiles() {
  if (!fs.existsSync(RELEASE_DIR)) return []
  return fs.readdirSync(RELEASE_DIR).filter((name) => {
    const full = path.join(RELEASE_DIR, name)
    return fs.statSync(full).isFile()
  })
}

/**
 * @param {string[]} names
 * @param {RegExp} ext
 */
function pickArtifact(names, ext) {
  const matched = names.filter((name) => ext.test(name))
  if (matched.length === 0) return null
  const prefer = (re) => matched.find((name) => re.test(name))
  return (
    prefer(/_macOS\./i)
    || prefer(/universal/i)
    || prefer(/arm64/i)
    || prefer(/x64/i)
    || matched[0]
  )
}

function copyToMsi(srcName, destName) {
  const src = path.join(RELEASE_DIR, srcName)
  const dest = path.join(OUT_DIR, destName)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.rmSync(dest, { force: true })
  fs.copyFileSync(src, dest)
  const sizeMb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1)
  log(`output: ${dest} (${sizeMb} MB)`)
  return dest
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error(
      'macOS DMG/zip은 macOS에서만 만들 수 있습니다. Mac에서 npm run build:dist:mac 을 실행하세요.'
    )
  }

  const stamp = formatTimestamp()
  log(`build stamp: ${stamp}`)

  run(`node scripts/sync-version.mjs --stamp=${stamp}`)
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true })
  fs.writeFileSync(
    path.join(ROOT, 'build', '.env.macos'),
    'PORT=3012\nHOSTNAME=127.0.0.1\n',
    'utf8'
  )
  log('packaged listen port: 3012')
  run('npm run build')

  const env = {
    ...process.env,
    NEO_BUILD_STAMP: stamp,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  }
  run('npx electron-builder --mac dmg zip', { env })

  const files = listReleaseFiles()
  const dmgName = pickArtifact(files, /\.dmg$/i)
  const zipName = pickArtifact(files, /\.zip$/i)
  if (!dmgName || !zipName) {
    throw new Error(
      `macOS 산출물을 찾지 못했습니다 (dmg=${dmgName ?? '없음'}, zip=${zipName ?? '없음'}). release/ 를 확인하세요.`
    )
  }

  const version = readVersion()
  copyToMsi(dmgName, `${APP_NAME} v${version}_${stamp}_macOS.dmg`)
  copyToMsi(zipName, `${APP_NAME} v${version}_${stamp}_macOS.zip`)
  log(`site: ${SITE_URL}`)
  log('실행: DMG를 열거나 zip 압축 해제 후 Neo Desktop Calendar.app')
  log(`done — DMG + zip share stamp ${stamp}`)
}

try {
  main()
} catch (error) {
  console.error('[dist-mac] failed:', error.message ?? error)
  process.exit(1)
}
