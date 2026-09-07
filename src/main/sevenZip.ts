import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { app } from 'electron'

function tryPath7zaFromPackage(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sevenBin = require('7zip-bin') as { path7za?: string }
    const p = sevenBin.path7za
    if (p && existsSync(p) && !p.includes(`${sep}app.asar${sep}`)) return p
  } catch {
    /* optional in packaged builds that ship extraResources only */
  }
  return null
}

/** Resolve bundled or dev `7za` (UTF-8 ZIP via `-mcu=on`). */
export function resolve7za(): string {
  const resources = process.resourcesPath ?? ''
  const archDir = process.arch === 'arm64' ? 'arm64' : 'x64'
  const winName = '7za.exe'
  const unixName = '7za'
  const candidates = [
    join(resources, '7zip', winName),
    join(resources, '7zip', unixName),
    join(resources, '7zip', archDir, unixName),
    join(app.getAppPath(), 'resources', '7zip', winName),
    join(app.getAppPath(), 'resources', '7zip', unixName),
    join(__dirname, '../../resources/7zip/7za.exe'),
    join(__dirname, '../../../resources/7zip/7za.exe'),
    join(__dirname, '../../node_modules/7zip-bin/win/x64/7za.exe'),
    join(__dirname, '../../../node_modules/7zip-bin/win/x64/7za.exe'),
    join(__dirname, `../../node_modules/7zip-bin/mac/${archDir}/7za`),
    join(__dirname, `../../../node_modules/7zip-bin/mac/${archDir}/7za`),
    tryPath7zaFromPackage()
  ].filter((p): p is string => Boolean(p))

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* ignore */
    }
  }

  throw new Error(
    '7za를 찾을 수 없습니다. 앱 resources/7zip 번들 또는 7zip-bin 설치를 확인해 주세요.'
  )
}

function run7za(args: string[], cwd?: string): void {
  const exe = resolve7za()
  try {
    execFileSync(exe, args, {
      cwd,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024
    })
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const detail = [err.stderr, err.stdout, err.message]
      .filter(Boolean)
      .join('\n')
      .trim()
    throw new Error(detail ? `7-Zip 실패: ${detail}` : '7-Zip 실패')
  }
}

/** Ensure every extracted path stays under `rootDir` (zip-slip / symlink guard). */
export function assertTreeContained(rootDir: string): void {
  const rootResolved = resolve(rootDir)
  const rootFull = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep
  const stack = [rootResolved]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name)
      const resolved = resolve(full)
      if (resolved !== rootResolved && !resolved.startsWith(rootFull)) {
        throw new Error('ZIP에 허용되지 않은 경로가 포함되어 있습니다.')
      }
      if (name.isSymbolicLink()) {
        throw new Error('ZIP에 심볼릭 링크는 허용되지 않습니다.')
      }
      if (name.isDirectory()) stack.push(full)
    }
  }
}

/**
 * Create a ZIP whose entries are the contents of `sourceDir` (folder root = zip root).
 * UTF-8 filenames (`-mcu=on`) so Korean names survive Windows ↔ macOS 7za.
 */
export function createZipFromDirectory(sourceDir: string, zipPath: string): void {
  const absZip = resolve(zipPath)
  const absSource = resolve(sourceDir)
  if (!existsSync(absSource)) {
    throw new Error(`ZIP 소스 폴더가 없습니다: ${absSource}`)
  }
  mkdirParent(absZip)
  if (existsSync(absZip)) unlinkSync(absZip)
  run7zaCompatible(
    ['a', '-tzip', '-mcu=on', '-mcl=off', '-sccUTF-8', '-y', absZip, '*'],
    ['a', '-tzip', '-mcu=on', '-y', absZip, '*'],
    absSource
  )
  if (!existsSync(absZip)) {
    throw new Error('ZIP 파일을 만들지 못했습니다.')
  }
}

/** Extract `zipPath` into `destDir`, then reject path escapes / symlinks. */
export function extractZipToDirectory(zipPath: string, destDir: string): void {
  const absZip = resolve(zipPath)
  const absDest = resolve(destDir)
  if (!existsSync(absZip)) {
    throw new Error(`ZIP 파일이 없습니다: ${absZip}`)
  }
  try {
    run7zaCompatible(
      ['x', '-y', '-mcp=65001', '-sccUTF-8', `-o${absDest}`, absZip],
      ['x', '-y', `-o${absDest}`, absZip]
    )
  } catch {
    run7za(['x', '-y', '-mcp=949', `-o${absDest}`, absZip])
  }
  assertTreeContained(absDest)
}

/**
 * Prefer UTF-8 7-Zip switches; older 7za builds may reject `-scc` / `-mcl`.
 * @param {string[]} preferred
 * @param {string[]} fallback
 * @param {string} [cwd]
 */
function run7zaCompatible(preferred: string[], fallback: string[], cwd?: string): void {
  try {
    run7za(preferred, cwd)
  } catch {
    run7za(fallback, cwd)
  }
}

function mkdirParent(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
}
