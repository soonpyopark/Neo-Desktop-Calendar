#!/usr/bin/env node
/**
 * Build portable zip for Neo Desktop Calendar (Electron).
 * Requires 7-Zip on the build machine (default: C:\Program Files\7-Zip\7z.exe).
 *
 * Flow:
 * 1) stamp APP_BUILD_STAMP + sync-version (same YYMMDD_HHMMSS as zip filename)
 * 2) build desktop-hit helper + electron-vite build + electron-builder --win --dir
 * 3) stage win-unpacked (+ .env without holiday API key; no data/)
 * 4) 7z a -tzip → msi/Neo Desktop Calendar v{version}_YYMMDD_HHMMSS_portable.zip
 */

import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP_NAME = 'Neo Desktop Calendar'
const SITE_URL = 'https://note4all.tistory.com'
const PUBLISH_DIR = path.join(ROOT, 'release', 'win-unpacked')
const OUT_DIR = path.join(ROOT, 'msi')
const STAGE_EXE = `${APP_NAME}.exe`
/** @type {string | null} */
let workDir = null

function log(msg) {
  console.log(`[portable] ${msg}`)
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

function resolveBuildStamp() {
  const fromEnv = String(process.env.NEO_BUILD_STAMP || '').trim()
  if (/^\d{6}_\d{6}$/.test(fromEnv)) return fromEnv
  return formatTimestamp()
}

/** Embed the same YYMMDD_HHMMSS used in the zip filename into the packaged app. */
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

function resolve7z() {
  const fromEnv = process.env.SEVEN_ZIP?.trim()
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv

  const candidates = [
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', '7-Zip', '7z.exe')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  try {
    const which = execSync('where.exe 7z', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().endsWith('7z.exe'))
    if (which && fs.existsSync(which)) return which
  } catch {
    /* not on PATH */
  }

  throw new Error(
    '7-Zip not found. Install 7-Zip or set SEVEN_ZIP to 7z.exe (e.g. C:\\Program Files\\7-Zip\\7z.exe)'
  )
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

function publishApp() {
  run('npm run build:desktop-hit')
  run('npm run build')
  run('npx electron-builder --win --dir')
  const builtExe = path.join(PUBLISH_DIR, STAGE_EXE)
  if (!fs.existsSync(builtExe)) {
    throw new Error(`Publish output not found: ${builtExe}`)
  }
}

function prepareWorkDir() {
  workDir = path.join(os.tmpdir(), `neo-desktop-calendar-portable-${process.pid}`)
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  return workDir
}

function stagePortable() {
  const builtExe = path.join(PUBLISH_DIR, STAGE_EXE)
  if (!fs.existsSync(builtExe)) {
    throw new Error(`Publish output not found: ${builtExe}`)
  }

  const dir = prepareWorkDir()
  const stageDir = path.join(dir, APP_NAME)

  fs.cpSync(PUBLISH_DIR, stageDir, { recursive: true })

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
  fs.rmSync(path.join(stageDir, 'data'), { recursive: true, force: true })
  log(`staged: ${stageDir}`)
  return stageDir
}

function buildZip(sevenZip, timestamp) {
  if (!workDir) throw new Error('Work dir not prepared')

  const version = readVersion()
  const outputName = `${APP_NAME} v${version}_${timestamp}_portable.zip`
  const outputPath = path.join(OUT_DIR, outputName)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.rmSync(outputPath, { force: true })

  // Zip the app folder so extract yields "Neo Desktop Calendar/…"
  const args = ['a', '-tzip', '-mx=9', '-y', outputPath, APP_NAME]
  log(`> ${sevenZip} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
  execFileSync(sevenZip, args, { stdio: 'inherit', cwd: workDir })

  const sizeMb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1)
  log(`output: ${outputPath} (${sizeMb} MB)`)
  log(`site: ${SITE_URL}`)
  return outputPath
}

function cleanupWorkDir() {
  if (!workDir) return
  fs.rmSync(workDir, { recursive: true, force: true })
  workDir = null
  log('removed staging folder')
}

function main() {
  const sevenZip = resolve7z()
  log(`7-Zip: ${sevenZip}`)
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
    publishApp()
  }
  stagePortable()

  try {
    buildZip(sevenZip, timestamp)
  } finally {
    cleanupWorkDir()
  }

  log('실행: zip 압축 해제 후 Neo Desktop Calendar.exe')
  log('done')
}

try {
  main()
} catch (error) {
  console.error('[portable] failed:', error.message ?? error)
  process.exit(1)
}
