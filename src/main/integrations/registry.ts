import type { IntegrationProvider } from './types'

const providers = new Map<string, IntegrationProvider>()

export function registerProvider(provider: IntegrationProvider): void {
  providers.set(provider.slug, provider)
  console.log(`[registry] Registered direct provider: ${provider.slug}`)
}

export function getProvider(slug: string): IntegrationProvider | null {
  return providers.get(slug) ?? null
}

export async function getDirectConnectedSlugs(): Promise<string[]> {
  const connected: string[] = []
  for (const [slug, provider] of providers) {
    try {
      if (await provider.hasConnections()) {
        connected.push(slug)
      }
    } catch {
      // Skip providers that error on status check
    }
  }
  return connected
}

export function getAllProviders(): IntegrationProvider[] {
  return Array.from(providers.values())
}
