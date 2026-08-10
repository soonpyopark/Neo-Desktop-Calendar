#!/usr/bin/env node
/**
 * Sync display version into package.json / .env.example / MSI License.rtf / README.
 * Source of truth: src/shared/constants.ts → APP_VERSION
 *
 * MSI license body (AGPL-3.0 + third-party summary): legal/msi-license-body.txt
 * Full notices: legal/THIRD_PARTY_NOTICES.md (also shipped via extraResources)
 * App license text: LICENSE (AGPL-3.0)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP_NAME = 'Neo Desktop Calendar'
const SITE_URL = 'https://note4all.tistory.com'
const CONSTANTS_PATH = path.join(ROOT, 'src', 'shared', 'constants.ts')
const MSI_LICENSE_BODY = path.join(ROOT, 'legal', 'msi-license-body.txt')
/** Matches the current heading and the pre-rename "Neo Calendar" one. */
const HEADING_NAME = 'Neo (?:Desktop )?Calendar'

function readVersion() {
  const constants = fs.readFileSync(CONSTANTS_PATH, 'utf8')
  const match = constants.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const version = match?.[1] ?? pkg.version
  if (!version) throw new Error('Could not resolve app version')
  return version
}

/**
 * electron-builder requires strict semver. Display may use a 4th part (1.1.8.1);
 * map that to 1.1.8-1 for package.json only.
 */
function toNpmVersion(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/)
  if (!match) return version
  if (match[4] != null) return `${match[1]}.${match[2]}.${match[3]}-${match[4]}`
  return `${match[1]}.${match[2]}.${match[3]}`
}

function writeIfChanged(filePath, next) {
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
  if (prev === next) return false
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, next, 'utf8')
  return true
}

function syncPackageJson(version) {
  const filePath = path.join(ROOT, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const npmVersion = toNpmVersion(version)
  if (pkg.version !== npmVersion) {
    pkg.version = npmVersion
    fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
    console.log(
      npmVersion === version
        ? `[sync-version] package.json -> ${npmVersion}`
        : `[sync-version] package.json -> ${npmVersion} (display ${version})`
    )
  }
}

function syncReadme(version) {
  const filePath = path.join(ROOT, 'README.md')
  if (!fs.existsSync(filePath)) return
  let text = fs.readFileSync(filePath, 'utf8')
  const next = text.replace(
    new RegExp(`^# ${HEADING_NAME}(?:\\s+v[^\\n]+)?`, 'm'),
    `# ${APP_NAME} v${version}`
  )
  if (writeIfChanged(filePath, next)) {
    console.log(`[sync-version] README.md -> ${APP_NAME} v${version}`)
  }
}

function syncEnvExample(version) {
  const filePath = path.join(ROOT, '.env.example')
  if (!fs.existsSync(filePath)) return
  let text = fs.readFileSync(filePath, 'utf8')
  const heading = `# ${APP_NAME} v${version} — Electron`
  if (new RegExp(`^# ${HEADING_NAME}`, 'm').test(text)) {
    text = text.replace(new RegExp(`^# ${HEADING_NAME}[^\\n]*`, 'm'), heading)
  } else {
    text = `${heading}\n${text}`
  }
  if (writeIfChanged(filePath, text)) {
    console.log(`[sync-version] .env.example -> ${version}`)
  }
}

/** Escape plain text for RTF (Unicode via \\uN?). */
function toRtfText(text) {
  let out = ''
  for (const ch of text) {
    if (ch === '\\' || ch === '{' || ch === '}') {
      out += `\\${ch}`
      continue
    }
    if (ch === '\r') continue
    if (ch === '\n') {
      out += '\\par\n'
      continue
    }
    const code = ch.codePointAt(0) ?? 0
    if (code < 128) {
      out += ch
    } else if (code <= 0xffff) {
      // RTF \\u is signed 16-bit
      const signed = code > 32767 ? code - 65536 : code
      out += `\\u${signed}?`
    } else {
      const h = Math.floor((code - 0x10000) / 0x400) + 0xd800
      const l = ((code - 0x10000) % 0x400) + 0xdc00
      const hs = h > 32767 ? h - 65536 : h
      const ls = l > 32767 ? l - 65536 : l
      out += `\\u${hs}?\\u${ls}?`
    }
  }
  return out
}

function syncMsiLicenseRtf(version) {
  const filePath = path.join(ROOT, 'msi', 'License.rtf')
  const bodyPath = MSI_LICENSE_BODY
  const rawBody = fs.existsSync(bodyPath)
    ? fs.readFileSync(bodyPath, 'utf8').replace(/\r\n/g, '\n').trimEnd()
    : `${APP_NAME}\n${SITE_URL}`

  // Inject version into the first line if it starts with the app name alone.
  const lines = rawBody.split('\n')
  if (lines[0]?.trim() === APP_NAME) {
    lines[0] = `${APP_NAME} v${version}`
  } else if (!lines[0]?.includes(`v${version}`)) {
    lines.unshift(`${APP_NAME} v${version}`)
  }

  const rtfBody = toRtfText(lines.join('\n'))
  const body =
    '{\\rtf1\\ansi\\ansicpg65001\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Segoe UI;}}\n'
    + '\\viewkind4\\uc1\\pard\\sa200\\sl276\\slmult1\\f0\\fs20 '
    + rtfBody
    + '\n}\n'

  if (writeIfChanged(filePath, body)) {
    console.log(`[sync-version] msi/License.rtf -> ${APP_NAME} v${version} (+ notices)`)
  }
}

const version = readVersion()
syncPackageJson(version)
syncReadme(version)
syncEnvExample(version)
syncMsiLicenseRtf(version)
console.log(`[sync-version] done (${APP_NAME} v${version})`)
