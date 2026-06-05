import { useState } from 'react'
import type { CacheInfo } from '../../../src/types'

interface Props {
  cacheInfo: CacheInfo | null
  onRefresh: (url?: string) => void
}

export default function AdminPanel({ cacheInfo, onRefresh }: Props) {
  const [urlInput, setUrlInput] = useState(cacheInfo?.rulesJsonUrl ?? '')

  const handleSaveUrl = () => {
    onRefresh(urlInput.trim())
  }

  const formatDate = (iso: string) => {
    if (!iso) return '從未更新'
    return new Date(iso).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <div className="admin-panel">

      <div className="admin-section">
        <div className="admin-section-title">規則 JSON URL</div>
        <div className="url-row">
          <input
            className="url-input"
            type="url"
            placeholder="https://raw.githubusercontent.com/wu0h9625-boop/Guideline-Scanner-DSM8.0/main/rules.json"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
          />
          <button className="url-save-btn" onClick={handleSaveUrl}>
            儲存並更新
          </button>
        </div>
        <p style={{ fontSize: 10, color: '#aaa', lineHeight: 1.5 }}>
          管理員維護此 JSON 檔案，設計師使用 plugin 時會自動拉取最新規則。
        </p>
      </div>

      <div className="admin-section">
        <div className="admin-section-title">已批准的 Token Collection</div>
        {cacheInfo?.approvedCollectionNames?.length ? (
          <div className="info-list">
            {cacheInfo.approvedCollectionNames.map(n => (
              <div key={n} className="info-item">✓ {n}</div>
            ))}
          </div>
        ) : (
          <p className="info-empty">尚未載入（請儲存 URL 或等待自動更新）</p>
        )}
      </div>

      {cacheInfo?.deprecatedCollectionNames?.length ? (
        <div className="admin-section">
          <div className="admin-section-title">廢棄的 Collection</div>
          <div className="info-list">
            {cacheInfo.deprecatedCollectionNames.map((n, i) => (
              <div key={i} className="info-item deprecated">⚠ {n}</div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="admin-section">
        <div className="admin-section-title">允許的間距值</div>
        {cacheInfo?.allowedSpacingValues?.length ? (
          <div className="spacing-chips">
            {cacheInfo.allowedSpacingValues.map(v => (
              <span key={v} className="spacing-chip">{v}</span>
            ))}
          </div>
        ) : (
          <p className="info-empty">使用預設值</p>
        )}
      </div>

      <div className="admin-section">
        <div className="admin-section-title">語意規則</div>
        <p className="rule-count">
          {cacheInfo?.componentRuleCount
            ? `已載入 ${cacheInfo.componentRuleCount} 條規則`
            : '尚未載入語意規則'}
        </p>
      </div>

      <div className="admin-section">
        <div className="admin-section-title">強制更新</div>
        <button className="refresh-btn" onClick={() => onRefresh()}>
          重新讀取設計規則
        </button>
        {cacheInfo?.lastUpdated && (
          <p className="last-updated">最後更新：{formatDate(cacheInfo.lastUpdated)}</p>
        )}
      </div>

    </div>
  )
}
