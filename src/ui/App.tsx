import { useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import type { Issue, UIMessage, PluginMessage, CacheInfo } from '../../src/types'
import IssueList from './components/IssueList'
import AdminPanel from './components/AdminPanel'

type AppState = 'loading' | 'idle' | 'scanning' | 'results'

function postMessage(msg: PluginMessage) {
  parent.postMessage({ pluginMessage: msg }, '*')
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading')
  const [loadingMsg, setLoadingMsg] = useState('正在讀取設計規則...')
  const [issues, setIssues] = useState<Issue[]>([])
  const [nodeCount, setNodeCount] = useState(0)
  const [hasSelection, setHasSelection] = useState(false)
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showAdmin, setShowAdmin] = useState(false)
  const titleClickCount = useRef(0)
  const titleClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleResizeMouseDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startW = window.innerWidth
    const startH = window.innerHeight

    const onMove = (ev: globalThis.MouseEvent) => {
      const w = Math.max(300, startW + ev.clientX - startX)
      const h = Math.max(300, startH + ev.clientY - startY)
      postMessage({ type: 'RESIZE', width: Math.round(w), height: Math.round(h) })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage as UIMessage | undefined
      if (!msg) return

      switch (msg.type) {
        case 'FETCH_RULES_JSON':
          // Plugin sandbox cannot make network requests — UI does it on its behalf
          fetch(msg.url)
            .then(r => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`)
              return r.json()
            })
            .then(data => postMessage({ type: 'RULES_JSON_RESULT', data }))
            .catch(err => postMessage({ type: 'RULES_JSON_RESULT', data: null, error: String(err) }))
          break
        case 'LOADING':
          setAppState('loading')
          setLoadingMsg(msg.message)
          break
        case 'CACHE_INFO':
          setCacheInfo(msg.info)
          setAppState(s => s === 'loading' ? 'idle' : s)
          break
        case 'SELECTION_CHANGED':
          setHasSelection(msg.hasSelection)
          break
        case 'SCAN_RESULT':
          setIssues(msg.issues)
          setNodeCount(msg.nodeCount)
          setAppState('results')
          break
        case 'ERROR':
          setErrorMsg(msg.message)
          setAppState(s => s === 'scanning' ? 'idle' : s)
          break
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  })

  useEffect(() => {
    postMessage({ type: 'GET_CACHE' })
  }, [])

  const handleTitleClick = useCallback(() => {
    titleClickCount.current += 1
    if (titleClickTimer.current) clearTimeout(titleClickTimer.current)
    titleClickTimer.current = setTimeout(() => { titleClickCount.current = 0 }, 2000)
    if (titleClickCount.current >= 5) {
      titleClickCount.current = 0
      setShowAdmin(v => !v)
    }
  }, [])

  const handleScan = () => {
    setAppState('scanning')
    setErrorMsg('')
    postMessage({ type: 'SCAN' })
  }

  const handleRefreshCache = (url?: string) => {
    setAppState('loading')
    setLoadingMsg('正在更新設計規則...')
    postMessage({ type: 'REFRESH_CACHE', rulesJsonUrl: url })
  }

  if (showAdmin) {
    return (
      <div className="app">
        <header className="header">
          <button className="back-btn" onClick={() => setShowAdmin(false)}>←</button>
          <h1 className="title">管理員設定</h1>
        </header>
        <AdminPanel cacheInfo={cacheInfo} onRefresh={handleRefreshCache} />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header-tap" onClick={handleTitleClick} />

      {appState === 'loading' && (
        <div className="loading-state">
          <div className="spinner" />
          <p className="loading-text">{loadingMsg}</p>
        </div>
      )}

      {appState !== 'loading' && (
        <div className="content">
          {errorMsg && (
            <div className="error-banner">
              <span>{errorMsg}</span>
              <button onClick={() => setErrorMsg('')}>✕</button>
            </div>
          )}

          <div className="scan-bar">
            <button
              className="scan-btn"
              onClick={handleScan}
              disabled={appState === 'scanning' || !hasSelection}
            >
              {appState !== 'scanning' && (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="6" cy="6" r="4.5" />
                  <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" />
                </svg>
              )}
              {appState === 'scanning' ? '掃描中...' : '掃描選取範圍'}
            </button>
          </div>

          {appState === 'idle' && !hasSelection && (
            <div className="empty-state">
              <p>請在 Figma 中選取要掃描的元素</p>
            </div>
          )}

          {appState === 'idle' && hasSelection && (
            <div className="empty-state" style={{ color: '#aaa' }}>
              <p>已選取元素，按上方按鈕開始掃描</p>
            </div>
          )}

          {appState === 'results' && (
            <>
              {issues.length === 0 ? (
                <div className="success-state">
                  <div className="check-icon">✓</div>
                  <p>選取範圍符合設計規範</p>
                  <p className="sub">已掃描 {nodeCount} 個元素</p>
                </div>
              ) : (
                <IssueList
                  issues={issues}
                  categoryMap={cacheInfo?.categoryMap ?? []}
                  onSelectNode={id => postMessage({ type: 'SELECT_NODE', nodeId: id })}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Resize handle — bottom-right corner */}
      <div className="resize-handle" onMouseDown={handleResizeMouseDown} />
    </div>
  )
}
