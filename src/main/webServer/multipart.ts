import type { IncomingMessage } from 'node:http'
import { toNfc } from '../../shared/unicodeText.js'

export type MultipartFile = {
  fieldName: string
  filename: string
  mime: string
  data: Buffer
}

const MAX_BODY_BYTES = 64 * 1024 * 1024

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function getMultipartBoundary(contentType: string | null): string | null {
  if (!contentType) return null
  const match = /multipart\/form-data\s*;\s*boundary\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(
    contentType
  )
  if (!match) return null
  return (match[1] ?? match[2] ?? '').trim() || null
}

export async function readRawBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) {
      throw new Error(`요청 본문이 너무 큽니다 (최대 ${Math.floor(maxBytes / (1024 * 1024))}MB).`)
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

/**
 * Minimal multipart/form-data parser for browser FormData file fields.
 */
export function parseMultipart(buffer: Buffer, boundary: string): MultipartFile[] {
  const delim = Buffer.from(`--${boundary}`)
  const files: MultipartFile[] = []
  let start = indexOf(buffer, delim, 0)
  if (start < 0) return files
  start += delim.length
  // Skip leading CRLF after first boundary
  if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2

  while (start < buffer.length) {
    const next = indexOf(buffer, delim, start)
    if (next < 0) break
    let partEnd = next
    // Trim trailing CRLF before boundary
    if (partEnd >= 2 && buffer[partEnd - 2] === 0x0d && buffer[partEnd - 1] === 0x0a) {
      partEnd -= 2
    }
    const part = buffer.subarray(start, partEnd)
    const headerSep = indexOf(part, Buffer.from('\r\n\r\n'), 0)
    if (headerSep >= 0) {
      const headerText = part.subarray(0, headerSep).toString('utf8')
      const body = part.subarray(headerSep + 4)
      const disposition = /content-disposition:\s*form-data;\s*(.+)/i.exec(headerText)
      if (disposition) {
        const nameMatch = /name="([^"]+)"/i.exec(disposition[1])
        const filename = decodeMultipartFilename(disposition[1])
        if (nameMatch && filename) {
          const mimeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText)
          files.push({
            fieldName: nameMatch[1],
            filename,
            mime: mimeMatch?.[1]?.trim() || 'application/octet-stream',
            data: Buffer.from(body)
          })
        }
      }
    }
    start = next + delim.length
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break // --
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2
  }
  return files
}

function decodeMultipartFilename(disposition: string): string {
  const star = /filename\*=(?:UTF-8|utf-8)''([^;\s]+)/i.exec(disposition)
  if (star?.[1]) {
    try {
      return toNfc(decodeURIComponent(star[1].replace(/["']/g, '')))
    } catch {
      /* fall through to filename= */
    }
  }
  const quoted = /filename="([^"]*)"/i.exec(disposition)
  return toNfc(quoted?.[1] ?? '')
}

function indexOf(haystack: Buffer, needle: Buffer, from: number): number {
  return haystack.indexOf(needle, from)
}

export function contentTypeOf(req: IncomingMessage): string | null {
  return headerValue(req.headers['content-type'])
}
