import type { DesignSystemCache, ComponentRule, CacheInfo, CategoryEntry } from '../types'

const CACHE_KEY = 'dsCache_v2'
const CACHE_VERSION = 2
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

const DEFAULT_SPACING_VALUES = [0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96]

const DEFAULT_RULES_URL = 'https://raw.githubusercontent.com/wu0h9625-boop/Guideline-Scanner-DSM8.0/main/rules.json'

export function emptyCache(rulesJsonUrl = DEFAULT_RULES_URL): DesignSystemCache {
  return {
    version: CACHE_VERSION,
    lastUpdated: '',
    rulesJsonUrl,
    approvedCollectionKeys: [],
    approvedCollectionNames: [],
    deprecatedCollectionKeys: [],
    allowedSpacingValues: DEFAULT_SPACING_VALUES,
    leftPaddingIndentMultipleOf: 28,
    componentRules: [],
    categoryMap: [],
  }
}

export async function loadCache(): Promise<DesignSystemCache> {
  try {
    const raw = await figma.clientStorage.getAsync(CACHE_KEY)
    if (!raw) return emptyCache()
    const cache = JSON.parse(raw as string) as DesignSystemCache
    if (cache.version !== CACHE_VERSION) return emptyCache()
    if (cache.rulesJsonUrl.includes('git.synology.inc')) {
      cache.rulesJsonUrl = DEFAULT_RULES_URL
    }
    return cache
  } catch (_) {
    return emptyCache()
  }
}

export async function saveCache(cache: DesignSystemCache): Promise<void> {
  await figma.clientStorage.setAsync(CACHE_KEY, JSON.stringify(cache))
}

export function isCacheStale(cache: DesignSystemCache): boolean {
  if (!cache.lastUpdated) return true
  return Date.now() - new Date(cache.lastUpdated).getTime() > CACHE_TTL_MS
}

export function toCacheInfo(cache: DesignSystemCache): CacheInfo {
  // Build deprecated names from keys by matching against approved names
  const deprecatedCollectionNames = cache.deprecatedCollectionKeys.map((_, i) => `廢棄 Collection ${i + 1}`)
  return {
    lastUpdated: cache.lastUpdated,
    rulesJsonUrl: cache.rulesJsonUrl,
    approvedCollectionNames: cache.approvedCollectionNames,
    deprecatedCollectionNames,
    allowedSpacingValues: cache.allowedSpacingValues,
    componentRuleCount: cache.componentRules.length,
    categoryMap: cache.categoryMap,
  }
}

/** Step 1: Read Figma team library collections and spacing values. */
export async function refreshCacheFromLibrary(currentCache: DesignSystemCache): Promise<DesignSystemCache> {
  const newCache: DesignSystemCache = {
    ...emptyCache(currentCache.rulesJsonUrl),
    rulesJsonUrl: currentCache.rulesJsonUrl,
    // Keep existing rules and config until we get a fresh fetch result
    componentRules: currentCache.componentRules,
    ...(currentCache.leftPaddingIndentMultipleOf !== undefined && {
      leftPaddingIndentMultipleOf: currentCache.leftPaddingIndentMultipleOf,
    }),
  }

  try {
    const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()

    const approvedKeys: string[] = []
    const approvedNames: string[] = []
    const deprecatedKeys: string[] = []

    for (const col of collections) {
      const nameLower = col.name.toLowerCase()
      if (nameLower.includes('deprecated')) {
        deprecatedKeys.push(col.key)
      } else {
        approvedKeys.push(col.key)
        approvedNames.push(`${col.libraryName} / ${col.name}`)
      }
    }

    newCache.approvedCollectionKeys = approvedKeys
    newCache.approvedCollectionNames = approvedNames
    newCache.deprecatedCollectionKeys = deprecatedKeys

    // Extract spacing values by scanning ALL approved collections for variables
    // whose names start with "spacing". Works even when the collection itself
    // is not named "spacing" (e.g. Synology's "Primitive" collection).
    const spacingValues = new Set<number>([0])
    for (const key of approvedKeys) {
      try {
        const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(key)
        for (const v of vars) {
          if (v.resolvedType === 'FLOAT' && /^spac/i.test(v.name)) {
            const match = v.name.match(/(\d+(?:\.\d+)?)(?:\D*)$/)
            if (match) spacingValues.add(parseFloat(match[1]))
          }
        }
      } catch (_) { /* ignore per-collection errors */ }
    }
    if (spacingValues.size > 1) {
      newCache.allowedSpacingValues = Array.from(spacingValues).sort((a, b) => a - b)
    }
  } catch (e) {
    console.error('[Design Linter] Failed to load library collections:', e)
  }

  return newCache
}

/** Step 2: Apply fetched rules JSON data to cache and save. */
export async function applyRulesJson(cache: DesignSystemCache, data: unknown): Promise<DesignSystemCache> {
  const updated = { ...cache }

  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (Array.isArray(d.rules)) {
      updated.componentRules = (d.rules as ComponentRule[]).filter(r => r.id && r.checks)
    }
    const spacingConfig = d.spacingConfig as Record<string, unknown> | undefined
    if (Array.isArray(spacingConfig?.allowedValues)) {
      updated.allowedSpacingValues = spacingConfig!.allowedValues as number[]
    }
    if (Array.isArray(spacingConfig?.additionalAllowedValues)) {
      const extra = spacingConfig!.additionalAllowedValues as number[]
      updated.allowedSpacingValues = Array.from(new Set([...updated.allowedSpacingValues, ...extra])).sort((a, b) => a - b)
    }
    if (typeof spacingConfig?.leftPaddingIndentMultipleOf === 'number') {
      updated.leftPaddingIndentMultipleOf = spacingConfig!.leftPaddingIndentMultipleOf as number
    }
    if (Array.isArray(d.categoryMap)) {
      updated.categoryMap = d.categoryMap as CategoryEntry[]
    }
  }

  updated.lastUpdated = new Date().toISOString()
  await saveCache(updated)
  return updated
}

/** Finalise cache without rules JSON (no URL configured) and save. */
export async function finaliseCache(cache: DesignSystemCache): Promise<DesignSystemCache> {
  const updated = { ...cache, lastUpdated: new Date().toISOString() }
  await saveCache(updated)
  return updated
}
