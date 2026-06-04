import type { PluginMessage, UIMessage } from '../types'
import { loadCache, saveCache, isCacheStale, refreshCache, toCacheInfo, emptyCache } from './cache'
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

async function init(): Promise<void> {
  send({ type: 'LOADING', message: '正在讀取設計規則...' })

  let cache = await loadCache()

  if (isCacheStale(cache)) {
    try {
      cache = await refreshCache(cache)
    } catch (e) {
      console.warn('[Design Linter] Cache refresh failed, using stale cache:', e)
    }
  }

  send({ type: 'CACHE_INFO', info: toCacheInfo(cache) })
  send({ type: 'SELECTION_CHANGED', hasSelection: figma.currentPage.selection.length > 0 })
}

figma.ui.onmessage = async (rawMsg: unknown) => {
  const msg = rawMsg as PluginMessage

  if (msg.type === 'GET_CACHE') {
    const cache = await loadCache()
    send({ type: 'CACHE_INFO', info: toCacheInfo(cache) })
    send({ type: 'SELECTION_CHANGED', hasSelection: figma.currentPage.selection.length > 0 })
    return
  }

  if (msg.type === 'REFRESH_CACHE') {
    send({ type: 'LOADING', message: '正在更新設計規則...' })
    try {
      const current = await loadCache()
      const urlToUse = msg.rulesJsonUrl !== undefined ? msg.rulesJsonUrl : current.rulesJsonUrl
      const base = { ...current, rulesJsonUrl: urlToUse }
      const updated = await refreshCache(base)
      send({ type: 'CACHE_INFO', info: toCacheInfo(updated) })
    } catch (e) {
      send({ type: 'ERROR', message: '更新規則失敗，請確認網路連線與 URL。' })
    }
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
