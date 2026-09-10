#!/usr/bin/env node
/**
 * Update npm dependencies (NAS4USB-style update:all).
 *
 * Direct dependencies and devDependencies are reinstalled at npm `latest`
 * (including major bumps). `npm update` still refreshes nested deps in range.
 *
 * Options:
 *   --skip-git    Skip git pull --ff-only
 *   --skip-npm    Skip npm install / latest bumps / npm update
 *   --skip-majors Stay inside package.json ranges; Electron still goes to latest
 *   --skip-verify Skip typecheck + export verify (not recommended)
 *   --skip-hit    Skip desktop-hit helper rebuild
 *   --build      Run production build (desktop-hit + electron-vite)
 *   --msi         Run npm run build:msi after updates
 *   --release     Run npm run build:release (MSI + portable, same stamp)
 *   --release-mac Run npm run build:dist:mac (DMG + zip, same stamp; macOS only)
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const release = argv.includes('--release')
  const releaseMac = argv.includes('--release-mac')
  return {
    skipGit: argv.includes('--skip-git'),
    skipNpm: argv.includes('--skip-npm'),
    skipMajors: argv.includes('--skip-majors'),
    skipVerify: argv.includes('--skip-verify'),
    skipHit: argv.includes('--skip-hit'),
    build: argv.includes('--build'),
    msi: argv.includes('--msi'),
    release,
    releaseMac
  }
}

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 */
function run(label, command, args) {
  console.log(`[update-all] ${label}…`)
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? 1})`)
  }
}

async function gitPull() {
  try {
    await fs.access(path.join(root, '.git'))
  } catch {
    console.log('[update-all] Not a git repo; skip git pull')
    return
  }

  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8'
  })
  if (status.stdout?.trim()) {
    console.log('[update-all] Git working tree has local changes; skip git pull')
    return
  }

  run('git pull', 'git', ['pull', '--ff-only'])
}

function queryNpmVersion(pkgName) {
  const result = spawnSync('npm', ['view', pkgName, 'version'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    throw new Error(`npm view ${pkgName} version failed (exit ${result.status ?? 1})`)
  }
  const version = result.stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? ''
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
    throw new Error(`unexpected ${pkgName} version: ${version}`)
  }
  return version
}

/** Packages whose postinstall must be allowlisted before `@latest` install. */
const INSTALL_SCRIPT_PACKAGES = ['electron', 'koffi']

/**
 * npm allowScripts keys are name@version. Approve latest install scripts first.
 */
async function approveInstallScripts() {
  const pkgPath = path.join(root, 'package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
  const allowScripts = { ...(pkg.allowScripts ?? {}) }
  for (const name of INSTALL_SCRIPT_PACKAGES) {
    const version = queryNpmVersion(name)
    for (const key of Object.keys(allowScripts)) {
      if (key.startsWith(`${name}@`)) delete allowScripts[key]
    }
    allowScripts[`${name}@${version}`] = true
    console.log(`[update-all] allowScripts ${name}@${version}`)
  }
  pkg.allowScripts = allowScripts
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

/**
 * @param {unknown} spec
 */
function isInstallableRegistrySpec(spec) {
  const value = String(spec || '').trim()
  if (!value) return false
  if (/^(file|link|workspace|npm):/i.test(value)) return false
  if (/^https?:\/\//i.test(value)) return false
  if (/^git(\+|$)/i.test(value)) return false
  return true
}

/**
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} pkg
 */
function collectDirectPackageNames(pkg) {
  /** @type {string[]} */
  const names = []
  for (const field of ['dependencies', 'devDependencies']) {
    const block = pkg[field] && typeof pkg[field] === 'object' ? pkg[field] : {}
    for (const [name, spec] of Object.entries(block)) {
      if (isInstallableRegistrySpec(spec)) names.push(name)
    }
  }
  return [...new Set(names)].sort()
}

function runCollect(label, command, args) {
  console.log(`[update-all] ${label}…`)
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result
}

function queryPeerDependency(pkgName, depName) {
  const result = spawnSync('npm', ['view', pkgName, `peerDependencies.${depName}`], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) return ''
  return (result.stdout.trim().split(/\r?\n/).at(-1) ?? '').replace(/^"|"$/g, '').trim()
}

/**
 * electron-vite 5 accepts Vite 5–7; @vitejs/plugin-react 6 needs Vite 8.
 * Anchor the bundler stack on electron-vite so majors still move together.
 * @param {string[]} names
 */
function installElectronViteFamily(names) {
  if (!names.includes('electron-vite')) return
  run('electron-vite latest', 'npm', ['install', 'electron-vite@latest', '--save-dev'])
  const viteRange = queryPeerDependency('electron-vite', 'vite')
  if (names.includes('vite') && viteRange) {
    console.log(`[update-all] vite → latest in electron-vite peer ${viteRange}`)
    run(`vite ${viteRange}`, 'npm', ['install', `vite@${viteRange}`, '--save-dev'])
  }
  if (!names.includes('@vitejs/plugin-react')) return
  const latestPlugin = runCollect('@vitejs/plugin-react latest', 'npm', [
    'install',
    '@vitejs/plugin-react@latest',
    '--save-dev'
  ])
  if (latestPlugin.status === 0) return
  console.log('[update-all] @vitejs/plugin-react@latest needs a newer vite; using v5')
  run('@vitejs/plugin-react v5', 'npm', [
    'install',
    '@vitejs/plugin-react@5',
    '--save-dev'
  ])
}

/**
 * `npm update` stays inside package.json ranges (`^4` never becomes 5).
 * Reinstall every direct dependency at `@latest` so majors move too.
 */
async function updateDirectPackagesLatest() {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const names = collectDirectPackageNames(pkg)
  if (names.length === 0) {
    console.log('[update-all] no registry packages to bump')
    return
  }
  const viteFamily = new Set(['electron-vite', 'vite', '@vitejs/plugin-react'])
  const rest = names.filter((name) => !viteFamily.has(name))
  console.log(`[update-all] ${names.length} direct packages → @latest (majors included)`)
  if (rest.length > 0) {
    run('npm latest (majors)', 'npm', [
      'install',
      ...rest.map((name) => `${name}@latest`)
    ])
  }
  installElectronViteFamily(names)
}

async function updateElectronLatest() {
  const version = queryNpmVersion('electron')
  console.log(`[update-all] electron latest: ${version}`)
  await approveInstallScripts()
  run(`npm install electron@${version}`, 'npm', [
    'install',
    `electron@${version}`,
    '--save-dev'
  ])
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  console.log('[update-all] ===== started =====')
  console.log(`[update-all] Project root: ${root}`)

  run('stop dev server', 'node', ['scripts/kill-dev.mjs'])

  if (!opts.skipGit) {
    await gitPull()
  }

  if (!opts.skipNpm) {
    run('npm install', 'npm', ['install'])
    run('npm update', 'npm', ['update'])
    if (opts.skipMajors) {
      await updateElectronLatest()
    } else {
      await approveInstallScripts()
      await updateDirectPackagesLatest()
    }
  }

  if (!opts.skipVerify) {
    run('typecheck', 'npm', ['run', 'typecheck'])
    run('verify export', 'npm', ['run', 'verify:export'])
  }

  if (!opts.skipHit && !opts.release && !opts.releaseMac && process.platform === 'win32') {
    run('build desktop-hit helper', 'npm', ['run', 'build:desktop-hit'])
  }

  if (opts.build && !opts.release && !opts.releaseMac) {
    run('production build', 'npm', ['run', 'build'])
  }

  if (opts.release) {
    run('build release (MSI + portable)', 'npm', ['run', 'build:release'])
  } else if (opts.releaseMac) {
    run('build mac dist (DMG + zip)', 'npm', ['run', 'build:dist:mac'])
  } else if (opts.msi) {
    run('build MSI', 'npm', ['run', 'build:msi'])
  }

  console.log('[update-all] ===== finished =====')
}

main().catch((error) => {
  console.error('[update-all] ERROR:', error instanceof Error ? error.message : error)
  process.exit(1)
})
