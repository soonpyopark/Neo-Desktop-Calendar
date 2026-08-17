export type AllowedIpEntry = { cidr: string; description?: string }

export function parseIPv4(ip: string): number | null
export function isValidIpOrCidr(value: string): boolean
export function normalizeAllowedIpCidrs(list: unknown): AllowedIpEntry[]
export function getAllowedIpCidrStrings(list: unknown): string[]
export const TAILSCALE_CGNAT_CIDR: string
export function isTailscaleIpv4(ipString: string): boolean
export function ipMatchesCidrRule(ipString: string, cidrRule: string): boolean
