#!/usr/bin/env node
/**
 * Build per-user Windows MSI for Neo Desktop Calendar (Electron).
 * Requires WiX CLI 7+ (winget install WiXToolset.WiXCLI) and: wix eula accept wix7
 *
 * Flow:
 * 1) stamp APP_BUILD_STAMP + sync-version (same YYMMDD_HHMMSS as MSI filename)
 * 2) build desktop-hit helper + electron-vite build + electron-builder --win --dir → release/win-unpacked/
 * 3) stage into a no-space temp work dir (repo path has spaces; WiX Files Include splits on them)
 *    (+ .env without any 공휴일 API key — the key never leaves the build machine)
 * 4) wix build Product.wxs → msi/Neo Desktop Calendar v{version}_YYMMDD_HHMMSS.msi
 *
 * 대한민국 공휴일은 커밋된 src/shared/seed/holidays-kr.json 을 그대로 번들한다.
 * 갱신은 빌드와 분리된 수동 작업: npm run seed:holidays
 */

import { execFileSync, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP_NAME = 'Neo Desktop Calendar'
const SITE_URL = 'https://note4all.tistory.com'
const PUBLISH_DIR = path.join(ROOT, 'release', 'win-unpacked')
const MSI_OUT_DIR = path.join(ROOT, 'msi')
const PRODUCT_WXS_SRC = path.join(MSI_OUT_DIR, 'Product.wxs')
const LICENSE_RTF_SRC = path.join(MSI_OUT_DIR, 'License.rtf')
/** Staging folder name must not contain spaces (WiX Files Include splits on spaces). */
const STAGE_NAME = 'payload'
const STAGE_EXE = `${APP_NAME}.exe`
let wixCmd = 'wix'
/** @type {string | null} */
let workDir = null

function log(msg) {
  console.log(`[msi] ${msg}`)
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

function toMsiVersion(version, buildStamp = new Date()) {
  const parts = String(version).split('.').map((p) => Number.parseInt(p, 10) || 0)
  while (parts.length < 3) {
    parts.push(0)
  }
  // 4th part must change every MSI build so Windows Installer treats it as an upgrade
  // even when APP_VERSION (x.y.z) is unchanged. Each MSI version field max is 65535.
  const revision = Math.floor(buildStamp.getTime() / 60_000) % 65535
  return `${parts[0]}.${parts[1]}.${parts[2]}.${revision || 1}`
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(2)
  return `${yy}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function resolveBuildStamp() {
  const fromEnv = String(process.env.NEO_BUILD_STAMP || '').trim()
  if (/^\d{6}_\d{6}$/.test(fromEnv)) return fromEnv
  return formatTimestamp()
}

/** Embed the same YYMMDD_HHMMSS used in the MSI filename into the packaged app. */
function stampBuildId(stamp) {
  process.env.NEO_BUILD_STAMP = stamp
  run(`node scripts/sync-version.mjs --stamp=${stamp}`)
}

function ensurePublished() {
  const builtExe = path.join(PUBLISH_DIR, STAGE_EXE)
  if (!fs.existsSync(builtExe)) {
    throw new Error(`Publish output not found: ${builtExe}`)
  }
}

function resolveWixCmd() {
  try {
    execSync('wix --version', { stdio: 'pipe' })
    return 'wix'
  } catch {
    /* look under Program Files */
  }

  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const candidates = [
    path.join(programFiles, 'WiX Toolset v7.0', 'bin', 'wix.exe'),
    path.join(programFiles, 'WiX Toolset v6.0', 'bin', 'wix.exe')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(
    'WiX CLI not found. Install: winget install WiXToolset.WiXCLI\nThen run: wix eula accept wix7'
  )
}

function ensureWix() {
  wixCmd = resolveWixCmd()
  execFileSync(wixCmd, ['--version'], { stdio: 'pipe' })
}

function resolveAppIcon() {
  const candidates = [
    path.join(ROOT, 'build', 'icon.ico'),
    path.join(ROOT, 'build', 'app.ico'),
    path.join(ROOT, 'icon.ico')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && candidate.endsWith('.ico')) {
      return candidate
    }
  }
  throw new Error('App icon (.ico) not found (expected build/icon.ico)')
}

/**
 * 배포본에는 공휴일 API 키를 넣지 않는다 — 휴일은 3년치 시드로 이미 들어가 있고,
 * 최신화가 필요한 사용자는 설정에서 본인 키로 동기화한다.
 */
function stripHolidayKeyLines(content) {
  const note = '# 공휴일 API 키는 배포본에 포함하지 않습니다 (필요하면 설정에서 직접 입력).'
  let removed = 0
  const lines = content.split(/\r?\n/).flatMap((line) => {
    if (!/^\s*(DATA_GO_KR_SERVICE_KEY|HOLIDAY_API_KEY)\s*=/.test(line)) return [line]
    removed += 1
    return removed === 1 ? [note] : []
  })
  return { content: lines.join('\n'), removed }
}

function writeStagedEnv(stageDir) {
  const rootEnvPath = path.join(ROOT, '.env')
  const examplePath = path.join(ROOT, '.env.example')
  const targetPath = path.join(stageDir, '.env')

  let raw = ''
  if (fs.existsSync(rootEnvPath)) {
    raw = fs.readFileSync(rootEnvPath, 'utf8')
  } else if (fs.existsSync(examplePath)) {
    raw = fs.readFileSync(examplePath, 'utf8')
  }

  const { content, removed } = stripHolidayKeyLines(raw)
  if (/^\s*(DATA_GO_KR_SERVICE_KEY|HOLIDAY_API_KEY)\s*=\s*\S/m.test(content)) {
    throw new Error('스테이징 .env 에 공휴일 API 키가 남아 있습니다 — 배포를 중단합니다.')
  }
  fs.writeFileSync(targetPath, content.replace(/\r?\n/g, '\r\n'), 'utf8')
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, path.join(stageDir, '.env.example'))
  }
  return removed
}

/** 읽기 전용 — 어떤 휴일 데이터가 이 MSI 에 들어가는지 남긴다 (갱신은 하지 않음). */
function logBundledHolidaySeed() {
  const seedPath = path.join(ROOT, 'src', 'shared', 'seed', 'holidays-kr.json')
  if (!fs.existsSync(seedPath)) {
    log('holidays-kr seed 없음 — 첫 실행 시 휴일이 비어 있습니다 (npm run seed:holidays)')
    return
  }
  try {
    const events = JSON.parse(fs.readFileSync(seedPath, 'utf8')).events ?? []
    const years = [...new Set(events.map((e) => String(e.startDate).slice(0, 4)))].sort()
    log(`holidays-kr seed: ${events.length}건 (${years.join(', ')}) — 갱신: npm run seed:holidays`)
  } catch (error) {
    log(`holidays-kr seed 확인 실패: ${error.message ?? error}`)
  }
}

function publishPortable() {
  run('npm run build:desktop-hit')
  run('npm run build')
  run('npx electron-builder --win --dir')
  const builtExe = path.join(PUBLISH_DIR, STAGE_EXE)
  if (!fs.existsSync(builtExe)) {
    throw new Error(`Publish output not found: ${builtExe}`)
  }
}

function prepareWorkDir() {
  // Temp paths are typically space-free (…\AppData\Local\Temp\…), unlike this repo folder.
  workDir = path.join(os.tmpdir(), `neo-desktop-calendar-msi-${process.pid}`)
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  if (/\s/.test(workDir)) {
    throw new Error(`Work dir unexpectedly contains spaces: ${workDir}`)
  }
  return workDir
}

function stageForMsi() {
  const builtExe = path.join(PUBLISH_DIR, STAGE_EXE)
  if (!fs.existsSync(builtExe)) {
    throw new Error(`Publish output not found: ${builtExe}`)
  }
  if (!fs.existsSync(PRODUCT_WXS_SRC)) {
    throw new Error(`Missing ${PRODUCT_WXS_SRC}`)
  }
  if (!fs.existsSync(LICENSE_RTF_SRC)) {
    throw new Error(`Missing ${LICENSE_RTF_SRC}`)
  }

  const dir = prepareWorkDir()
  const stageDir = path.join(dir, STAGE_NAME)

  fs.cpSync(PUBLISH_DIR, stageDir, { recursive: true })
  fs.copyFileSync(resolveAppIcon(), path.join(stageDir, 'app-icon.ico'))
  fs.copyFileSync(PRODUCT_WXS_SRC, path.join(dir, 'Product.wxs'))
  fs.copyFileSync(LICENSE_RTF_SRC, path.join(dir, 'License.rtf'))

  for (const name of ['LICENSE', 'README.md']) {
    const src = path.join(ROOT, name)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(stageDir, name))
    }
  }

  const removedKeys = writeStagedEnv(stageDir)
  log(
    removedKeys > 0
      ? `staged .env without holiday API key (${removedKeys} line(s) removed)`
      : 'staged .env contains no holiday API key'
  )
  // Do not ship data/ inside the MSI — first-launch writes then fail with access denied.
  // Holidays come from the bundled seed (resources/seed/holidays-kr.json) on first run.
  fs.rmSync(path.join(stageDir, 'data'), { recursive: true, force: true })
  log(`staged: ${stageDir}`)
}

function buildMsi(timestamp) {
  if (!workDir) throw new Error('Work dir not prepared')

  const version = readVersion()
  const productVersion = toMsiVersion(version)
  // New ProductCode every build + MajorUpgrade AllowSameVersionUpgrades removes prior ARP entries.
  const productCode = randomUUID().toUpperCase()
  const outputName = `${APP_NAME} v${version}_${timestamp}.msi`
  const outputPath = path.join(MSI_OUT_DIR, outputName)
  const workOutput = path.join(workDir, outputName.replace(/\s/g, '_'))

  fs.mkdirSync(MSI_OUT_DIR, { recursive: true })
  fs.rmSync(outputPath, { force: true })

  // WiX 7 expects: -d Name=Value  (flag and value as separate argv entries).
  // MsiDir has no spaces (temp), so Files Include="$(var.MsiDir)\payload\**" is safe.
  const wixArgs = [
    'build',
    path.join(workDir, 'Product.wxs'),
    '-d',
    `ProductVersion=${productVersion}`,
    '-d',
    `ProductCode=${productCode}`,
    '-d',
    `MsiDir=${workDir}`,
    '-bindpath',
    workDir,
    '-ext',
    'WixToolset.UI.wixext',
    '-ext',
    'WixToolset.Util.wixext',
    '-o',
    workOutput
  ]
  log(`> ${wixCmd} ${wixArgs.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
  execFileSync(wixCmd, wixArgs, { stdio: 'inherit', cwd: workDir })

  fs.copyFileSync(workOutput, outputPath)
  const sizeMb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1)
  log(`output: ${outputPath} (${sizeMb} MB)`)
  log(`ProductVersion=${productVersion} ProductCode={${productCode}}`)
  log(`site: ${SITE_URL}`)
}

function cleanupWorkDir() {
  if (!workDir) return
  fs.rmSync(workDir, { recursive: true, force: true })
  workDir = null
  log('removed staging folder')
}

function main() {
  ensureWix()
  const timestamp = resolveBuildStamp()
  if (process.env.NEO_SKIP_STAMP !== '1') {
    stampBuildId(timestamp)
  }
  log(`build stamp: ${timestamp}`)
  logBundledHolidaySeed()
  if (process.env.NEO_SKIP_PUBLISH === '1') {
    ensurePublished()
    log('skip publish (reuse release/win-unpacked)')
  } else {
    publishPortable()
  }
  stageForMsi()

  try {
    buildMsi(timestamp)
  } finally {
    cleanupWorkDir()
  }

  log('설치: msi 폴더의 .msi 파일을 더블 클릭하세요 (관리자 권한 불필요).')
  log('done')
}

try {
  main()
} catch (error) {
  console.error('[msi] failed:', error.message ?? error)
  process.exit(1)
}
