import type { PluginMessage, UIMessage } from '../types'
import { loadCache, saveCache, isCacheStale, refreshCacheFromLibrary, applyRulesJson, finaliseCache, toCacheInfo } from './cache'
import { scanNodes } from './scanner'

declare const __html__: string

figma.showUI(__html__, { width: 340, height: 500, themeColors: true })

function send(msg: UIMessage): void {
  figma.ui.postMessage(msg)
}

// Notify UI when selection changes
figma.on('selectionchange', () => {
  send({ type: 'SELECTION_CHANGED', hasSelection: figma.currentPage.selection.length > 0 })
})

// ─── Pending fetch resolver ───────────────────────────────────────────────────
// Network requests must run in the UI iframe. When the plugin needs to fetch
// rules JSON, it sends FETCH_RULES_JSON to the UI, then suspends here until
// the UI returns RULES_JSON_RESULT.
type FetchResolver = (result: { data: unknown; error?: string }) => void
let pendingFetchResolver: FetchResolver | null = null

function fetchRulesViaUI(url: string): Promise<{ data: unknown; error?: string }> {
  return new Promise(resolve => {
    pendingFetchResolver = resolve
    send({ type: 'FETCH_RULES_JSON', url })
  })
}

// ─── Cache refresh helper ─────────────────────────────────────────────────────
async function doRefreshCache(urlOverride?: string): Promise<void> {
  send({ type: 'LOADING', message: '正在更新設計規則...' })
  try {
    const current = await loadCache()
    const url = urlOverride !== undefined ? urlOverride : current.rulesJsonUrl
    const base = { ...current, rulesJsonUrl: url }

    // Step 1: read Figma library (runs in plugin sandbox — no network needed)
    let cache = await refreshCacheFromLibrary(base)

    // Step 2: fetch rules JSON via UI iframe (only if URL is set)
    if (url) {
      const { data, error } = await fetchRulesViaUI(url)
      if (error) {
        console.warn('[Design Linter] Rules JSON fetch error:', error)
      }
      cache = await applyRulesJson(cache, data)
    } else {
      cache = await finaliseCache(cache)
    }

    send({ type: 'CACHE_INFO', info: toCacheInfo(cache) })
  } catch (e) {
    console.error('[Design Linter] Cache refresh failed:', e)
    send({ type: 'ERROR', message: '更新規則失敗，請確認網路連線與 URL。' })
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  send({ type: 'LOADING', message: '正在讀取設計規則...' })

  const cache = await loadCache()

  if (isCacheStale(cache)) {
    await doRefreshCache()
  } else {
    send({ type: 'CACHE_INFO', info: toCacheInfo(cache) })
  }

  send({ type: 'SELECTION_CHANGED', hasSelection: figma.currentPage.selection.length > 0 })
}

// ─── Message handler ──────────────────────────────────────────────────────────
figma.ui.onmessage = async (rawMsg: unknown) => {
  const msg = rawMsg as PluginMessage

  // Result from UI's fetch — resume the suspended doRefreshCache()
  if (msg.type === 'RULES_JSON_RESULT') {
    if (pendingFetchResolver) {
      pendingFetchResolver({ data: msg.data, error: msg.error })
      pendingFetchResolver = null
    }
    return
  }

  if (msg.type === 'GET_CACHE') {
    const cache = await loadCache()
    send({ type: 'CACHE_INFO', info: toCacheInfo(cache) })
    send({ type: 'SELECTION_CHANGED', hasSelection: figma.currentPage.selection.length > 0 })
    return
  }

  if (msg.type === 'REFRESH_CACHE') {
    await doRefreshCache(msg.rulesJsonUrl)
    return
  }

  if (msg.type === 'SAVE_RULES_URL') {
    const cache = await loadCache()
    cache.rulesJsonUrl = msg.url
    await saveCache(cache)
    send({ type: 'CACHE_INFO', info: toCacheInfo(cache) })
    return
  }

  if (msg.type === 'SCAN') {
    const selection = figma.currentPage.selection
    if (selection.length === 0) {
      send({ type: 'ERROR', message: '請先選取要掃描的元素。' })
      return
    }
    try {
      const cache = await loadCache()
      const { issues, nodeCount } = await scanNodes(selection, cache)
      send({ type: 'SCAN_RESULT', issues, nodeCount })
    } catch (e) {
      console.error('[Design Linter] Scan error:', e)
      send({ type: 'ERROR', message: '掃描時發生錯誤，請重試。' })
    }
    return
  }

  if (msg.type === 'RESIZE') {
    figma.ui.resize(msg.width, msg.height)
    return
  }

  if (msg.type === 'SELECT_NODE') {
    const node = figma.getNodeById(msg.nodeId)
    if (node && node.type !== 'DOCUMENT' && node.type !== 'PAGE') {
      figma.currentPage.selection = [node as SceneNode]
      figma.viewport.scrollAndZoomIntoView([node as SceneNode])
    }
    return
  }
}

init()
