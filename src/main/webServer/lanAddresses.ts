import { networkInterfaces } from 'node:os'

/** Non-internal IPv4 addresses currently attached to this machine. */
export function getLocalIPv4Addresses(): string[] {
  const addresses: string[] = []
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (net.address) addresses.push(net.address)
    }
  }
  return addresses
}
