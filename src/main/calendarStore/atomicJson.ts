import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Compact JSON (no pretty-print). Atomic replace via temp + rename. */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(value), 'utf8')
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
    renameSync(tmp, filePath)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw error
  }
}

export function readJsonFile<T>(filePath: string): T | null {
  try {
    const text = readFileSync(filePath, 'utf8')
    if (!text.trim()) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
