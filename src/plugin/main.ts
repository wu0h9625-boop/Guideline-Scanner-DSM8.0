import type { PluginMessage, UIMessage } from '../types'
import { loadCache, saveCache, isCacheStale, refreshCacheFromLibrary, applyRulesJson, finaliseCache, toCacheInfo } from './cache'
import { scanNodes } from './scanner'

declare const __html__: string

// ─── Ignore list (stored in Figma file, shared across all users) ──────────────
const IGNORE_STORAGE_KEY = 'ignoreList_v1'

function loadIgnoreKeys(): Set<string> {
  try {
    const raw = figma.root.getPluginData(IGNORE_STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch (_) {
    return new Set()
  }
}

function saveIgnoreKeys(keys: Set<string>): void {
  figma.root.setPluginData(IGNORE_STORAGE_KEY, JSON.stringify(Array.from(keys)))
}

figma.showUI(__html__, { width: 400, height: 700, themeColors: true })

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
        console.warn('[SynoDesign Linter] Rules JSON fetch error:', error)
      }
      cache = await applyRulesJson(cache, data)
    } else {
      cache = await finaliseCache(cache)
    }

    send({ type: 'CACHE_INFO', info: toCacheInfo(cache) })
  } catch (e) {
    console.error('[SynoDesign Linter] Cache refresh failed:', e)
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

  send({ type: 'IGNORE_LIST', keys: Array.from(loadIgnoreKeys()) })
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
    send({ type: 'IGNORE_LIST', keys: Array.from(loadIgnoreKeys()) })
    send({ type: 'SELECTION_CHANGED', hasSelection: figma.currentPage.selection.length > 0 })
    return
  }

  if (msg.type === 'IGNORE_ISSUE') {
    const keys = loadIgnoreKeys()
    keys.add(msg.key)
    saveIgnoreKeys(keys)
    return
  }

  if (msg.type === 'UNIGNORE_ISSUE') {
    const keys = loadIgnoreKeys()
    keys.delete(msg.key)
    saveIgnoreKeys(keys)
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
      console.error('[SynoDesign Linter] Scan error:', e)
      send({ type: 'ERROR', message: '掃描時發生錯誤，請重試。' })
    }
    return
  }

  if (msg.type === 'RESIZE') {
    figma.ui.resize(msg.width, msg.height)
    return
  }

  if (msg.type === 'SELECT_NODE') {
    try {
      const node = await figma.getNodeByIdAsync(msg.nodeId)
      if (!node || (node as SceneNode & { removed?: boolean }).removed) {
        figma.notify('找不到該元素（可能已被刪除）', { error: true })
        return
      }
      if (node.type === 'DOCUMENT' || node.type === 'PAGE') return

      // Navigate to the page containing this node if needed
      let ancestor: BaseNode | null = node
      while (ancestor && ancestor.type !== 'PAGE') ancestor = ancestor.parent
      if (ancestor && ancestor.type === 'PAGE' && ancestor !== figma.currentPage) {
        figma.currentPage = ancestor as PageNode
      }

      figma.currentPage.selection = [node as SceneNode]
      figma.viewport.scrollAndZoomIntoView([node as SceneNode])
      figma.notify(`已選取：${(node as SceneNode).name}`, { timeout: 1500 })
    } catch (e) {
      figma.notify(`選取失敗：${String(e)}`, { error: true })
    }
    return
  }
}

init()
