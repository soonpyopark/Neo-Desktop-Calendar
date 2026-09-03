#!/usr/bin/env node
/**
 * Update npm dependencies (NAS4USB-style update:all).
 *
 * Electron is always installed at npm `latest` (including major bumps).
 * Other packages stay within package.json semver ranges (`npm update`).
 *
 * Options:
 *   --skip-git    Skip git pull --ff-only
 *   --skip-npm    Skip npm install / electron latest / npm update
 *   --skip-verify Skip typecheck + export verify (not recommended)
 *   --skip-hit    Skip desktop-hit helper rebuild
 *   --build      Run production build (desktop-hit + electron-vite)
 *   --msi        Run npm run build:msi after updates
 *   --release    Run npm run build:release (MSI + portable, same stamp)
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
  return {
    skipGit: argv.includes('--skip-git'),
    skipNpm: argv.includes('--skip-npm'),
    skipVerify: argv.includes('--skip-verify'),
    skipHit: argv.includes('--skip-hit'),
    build: argv.includes('--build'),
    msi: argv.includes('--msi'),
    release
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

function latestElectronVersion() {
  const result = spawnSync('npm', ['view', 'electron', 'version'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    throw new Error(`npm view electron version failed (exit ${result.status ?? 1})`)
  }
  const version = result.stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? ''
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
    throw new Error(`unexpected electron version: ${version}`)
  }
  return version
}

/**
 * npm allowScripts keys are name@version. Approve the new Electron before install.
 * @param {string} version
 */
async function approveElectronScript(version) {
  const pkgPath = path.join(root, 'package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))
  const allowScripts = { ...(pkg.allowScripts ?? {}) }
  for (const key of Object.keys(allowScripts)) {
    if (key.startsWith('electron@')) delete allowScripts[key]
  }
  allowScripts[`electron@${version}`] = true
  pkg.allowScripts = allowScripts
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function updateElectronLatest() {
  const version = latestElectronVersion()
  console.log(`[update-all] electron latest: ${version}`)
  await approveElectronScript(version)
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
    await updateElectronLatest()
    run('npm update', 'npm', ['update'])
  }

  if (!opts.skipVerify) {
    run('typecheck', 'npm', ['run', 'typecheck'])
    run('verify export', 'npm', ['run', 'verify:export'])
  }

  if (!opts.skipHit && !opts.release) {
    run('build desktop-hit helper', 'npm', ['run', 'build:desktop-hit'])
  }

  if (opts.build && !opts.release) {
    run('production build', 'npm', ['run', 'build'])
  }

  if (opts.release) {
    run('build release (MSI + portable)', 'npm', ['run', 'build:release'])
  } else if (opts.msi) {
    run('build MSI', 'npm', ['run', 'build:msi'])
  }

  console.log('[update-all] ===== finished =====')
}

main().catch((error) => {
  console.error('[update-all] ERROR:', error instanceof Error ? error.message : error)
  process.exit(1)
})
