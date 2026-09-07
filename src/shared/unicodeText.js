/**
 * Mac (NFD) and Windows (NFC / CP949) interchange helpers for Korean text.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function toNfc(value) {
  return String(value ?? '').normalize('NFC')
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameUnicodeText(a, b) {
  return toNfc(a) === toNfc(b)
}

/**
 * Recursively NFC-normalize every string (JSON backup / import payloads).
 * @param {unknown} value
 * @returns {unknown}
 */
export function nfcWalk(value) {
  if (typeof value === 'string') return toNfc(value)
  if (Array.isArray(value)) return value.map((item) => nfcWalk(item))
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = nfcWalk(item)
    }
    return out
  }
  return value
}

/**
 * @param {Buffer} buffer
 */
function looksLikeUtf8(buffer) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} label
 * @param {Buffer} buffer
 */
function decodeLabeled(label, buffer) {
  try {
    return new TextDecoder(label).decode(buffer)
  } catch {
    return null
  }
}

/**
 * Decode JSON / ICS / CSV bytes from UTF-8 (BOM), UTF-16, or Windows Korean (EUC-KR).
 * @param {Buffer | Uint8Array} input
 */
export function decodeInterchangeText(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buf.length === 0) return ''

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return toNfc(buf.subarray(3).toString('utf8'))
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return toNfc(buf.toString('utf16le'))
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2)
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1]
      swapped[i - 1] = buf[i]
    }
    return toNfc(swapped.subarray(0, swapped.length - (swapped.length % 2)).toString('utf16le'))
  }

  if (looksLikeUtf8(buf)) {
    return toNfc(buf.toString('utf8'))
  }

  const korean = decodeLabeled('euc-kr', buf) ?? decodeLabeled('windows-949', buf)
  return toNfc(korean ?? buf.toString('utf8'))
}
