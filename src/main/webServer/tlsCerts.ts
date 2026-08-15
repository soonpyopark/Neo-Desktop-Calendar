import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { X509Certificate } from 'node:crypto'
import forge from 'node-forge'
import { emptyTlsStatus, type WebServerTlsStatus } from '../../shared/httpsConfig'
import { getLocalIPv4Addresses } from './lanAddresses'

const TLS_DIR_NAME = 'tls'
const CA_CERT_NAME = 'ca.crt'
const CA_KEY_NAME = 'ca.key'
const SERVER_CERT_NAME = 'server.crt'
const SERVER_KEY_NAME = 'server.key'
const META_NAME = 'meta.json'

const CA_YEARS = 10
const SERVER_DAYS = 825

export function getTlsDir(root: string): string {
  return path.join(root, TLS_DIR_NAME)
}

export function getCaCertificatePath(root: string): string {
  return path.join(getTlsDir(root), CA_CERT_NAME)
}

function filePaths(root: string) {
  const dir = getTlsDir(root)
  return {
    dir,
    caCert: path.join(dir, CA_CERT_NAME),
    caKey: path.join(dir, CA_KEY_NAME),
    serverCert: path.join(dir, SERVER_CERT_NAME),
    serverKey: path.join(dir, SERVER_KEY_NAME),
    meta: path.join(dir, META_NAME)
  }
}

function randomSerial(): string {
  return forge.util.bytesToHex(forge.random.getBytesSync(16))
}

function generateKeyPair(): forge.pki.rsa.KeyPair {
  return forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })
}

export function desiredTlsSans(): string[] {
  const sans = new Set(['localhost', '127.0.0.1'])
  for (const address of getLocalIPv4Addresses()) {
    if (address) sans.add(address)
  }
  return [...sans]
}

function isIpv4(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)
}

function sansCover(needed: string[], have: unknown): boolean {
  if (!Array.isArray(have) || have.length === 0) return false
  const set = new Set(have.map((item) => String(item).toLowerCase()))
  return needed.every((item) => set.has(String(item).toLowerCase()))
}

function createCaCertificate(): { certPem: string; keyPem: string } {
  const keys = generateKeyPair()
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + CA_YEARS)
  const attrs = [
    { name: 'commonName', value: 'Neo Desktop Calendar Local CA' },
    { name: 'organizationName', value: 'Neo Desktop Calendar' }
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey)
  }
}

function createServerCertificate(
  caCertPem: string,
  caKeyPem: string,
  sans: string[]
): { certPem: string; keyPem: string; notAfter: string } {
  const caCert = forge.pki.certificateFromPem(caCertPem)
  const caKey = forge.pki.privateKeyFromPem(caKeyPem)
  const keys = generateKeyPair()
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + SERVER_DAYS)
  cert.setSubject([
    { name: 'commonName', value: 'Neo Desktop Calendar' },
    { name: 'organizationName', value: 'Neo Desktop Calendar' }
  ])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: sans.map((value) =>
        isIpv4(value) ? { type: 7, ip: value } : { type: 2, value }
      )
    },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: true }
  ])
  cert.sign(caKey, forge.md.sha256.create())
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    notAfter: cert.validity.notAfter.toISOString()
  }
}

async function ensureCa(root: string): Promise<{ certPem: string; keyPem: string }> {
  const files = filePaths(root)
  await mkdir(files.dir, { recursive: true })
  if (existsSync(files.caCert) && existsSync(files.caKey)) {
    return {
      certPem: await readFile(files.caCert, 'utf8'),
      keyPem: await readFile(files.caKey, 'utf8')
    }
  }
  const created = createCaCertificate()
  await writeFile(files.caCert, created.certPem, 'utf8')
  await writeFile(files.caKey, created.keyPem, 'utf8')
  return created
}

type TlsMeta = {
  sans?: string[]
  notAfter?: string
  generatedAt?: string
}

function readMeta(root: string): TlsMeta | null {
  const files = filePaths(root)
  try {
    return JSON.parse(readFileSync(files.meta, 'utf8')) as TlsMeta
  } catch {
    return null
  }
}

export async function ensureTlsMaterial(options: {
  root: string
  forceServer?: boolean
}): Promise<{ key: string; cert: string; ca: string; sans: string[] }> {
  const root = options.root
  const files = filePaths(root)
  const ca = await ensureCa(root)
  const sans = desiredTlsSans()
  const meta = readMeta(root)
  const haveServer = existsSync(files.serverCert) && existsSync(files.serverKey)
  const needsNewServer = Boolean(options.forceServer) || !haveServer || !sansCover(sans, meta?.sans)

  if (needsNewServer) {
    const server = createServerCertificate(ca.certPem, ca.keyPem, sans)
    await writeFile(files.serverCert, server.certPem, 'utf8')
    await writeFile(files.serverKey, server.keyPem, 'utf8')
    await writeFile(
      files.meta,
      `${JSON.stringify(
        { sans, notAfter: server.notAfter, generatedAt: new Date().toISOString() },
        null,
        2
      )}\n`,
      'utf8'
    )
  }

  const cert = await readFile(files.serverCert, 'utf8')
  const key = await readFile(files.serverKey, 'utf8')
  return {
    key,
    cert,
    ca: ca.certPem,
    sans: readMeta(root)?.sans ?? sans
  }
}

export function readServerCertificatePem(root: string): string {
  const files = filePaths(root)
  try {
    return readFileSync(files.serverCert, 'utf8')
  } catch {
    return ''
  }
}

export function isTrustedServerFingerprint(fingerprint256: string | undefined, root: string): boolean {
  const pem = readServerCertificatePem(root)
  if (!pem || !fingerprint256) return false
  try {
    const ours = new X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase()
    const theirs = String(fingerprint256).replace(/:/g, '').toLowerCase()
    return ours.length > 0 && ours === theirs
  } catch {
    return false
  }
}

export function isTrustedElectronCertificate(
  certificate: { fingerprint?: string; fingerprint256?: string; data?: string } | null | undefined,
  root: string
): boolean {
  const pem = readServerCertificatePem(root)
  if (!pem || !certificate) return false
  try {
    const ours = new X509Certificate(pem)
    const ours256 = ours.fingerprint256.replace(/:/g, '').toLowerCase()
    const ours1 = ours.fingerprint.replace(/:/g, '').toLowerCase()
    const claimed256 = String(certificate.fingerprint256 ?? '').replace(/:/g, '').toLowerCase()
    if (claimed256 && claimed256 === ours256) return true
    const claimed1 = String(certificate.fingerprint ?? '').replace(/:/g, '').toLowerCase()
    if (claimed1 && claimed1 === ours1) return true
    const data = String(certificate.data ?? '').trim()
    if (!data) return false
    const wrapped = data.includes('BEGIN CERTIFICATE')
      ? data
      : `-----BEGIN CERTIFICATE-----\n${data}\n-----END CERTIFICATE-----`
    const theirs = new X509Certificate(wrapped)
    return ours256 === theirs.fingerprint256.replace(/:/g, '').toLowerCase()
  } catch {
    return false
  }
}

export function getTlsStatus(root: string): WebServerTlsStatus {
  const files = filePaths(root)
  const meta = readMeta(root)
  let fingerprint256 = ''
  let notAfter = typeof meta?.notAfter === 'string' ? meta.notAfter : ''
  if (existsSync(files.serverCert)) {
    try {
      const x509 = new X509Certificate(readFileSync(files.serverCert))
      fingerprint256 = x509.fingerprint256
      notAfter = x509.validTo
    } catch {
      /* ignore */
    }
  }
  return {
    dir: files.dir,
    caPath: files.caCert,
    hasCa: existsSync(files.caCert) && existsSync(files.caKey),
    hasServer: existsSync(files.serverCert) && existsSync(files.serverKey),
    sans: Array.isArray(meta?.sans) ? meta.sans : [],
    notAfter,
    fingerprint256
  }
}

export function tlsStatusOrEmpty(root: string | null | undefined): WebServerTlsStatus {
  if (!root) return emptyTlsStatus()
  try {
    return getTlsStatus(root)
  } catch {
    return emptyTlsStatus(getTlsDir(root))
  }
}

export async function createAppHttpServer(
  httpsEnabled: boolean,
  requestListener: http.RequestListener,
  root: string
): Promise<http.Server | https.Server> {
  if (!httpsEnabled) {
    return http.createServer(requestListener)
  }
  const tls = await ensureTlsMaterial({ root })
  const options: https.ServerOptions = {
    key: tls.key,
    cert: `${tls.cert.trim()}\n${tls.ca.trim()}\n`,
    ca: tls.ca
  }
  return https.createServer(options, requestListener)
}
