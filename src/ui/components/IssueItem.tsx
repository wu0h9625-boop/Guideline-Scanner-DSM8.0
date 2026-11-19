import { useState, useEffect, useRef } from 'react'
import type { Issue } from '../../../src/types'

interface Props {
  issue: Issue
  isIgnored?: boolean
  onSelect: (nodeId: string) => void
  onIgnore: (key: string) => void
  onUnignore: (key: string) => void
}

// ── Violation text parser ─────────────────────────────────────────────────────
interface ViolationParts {
  label?: string
  from?: string
  to?: string
  raw?: string
}

function parseViolation(text: string): ViolationParts {
  // "X 使用了 Y，應使用 Z"
  let m = text.match(/^(.+?) 使用了 (.+?)，應使用 (.+)$/)
  if (m) return { label: m[1], from: m[2], to: m[3] }

  // "X = Y，應為 Z"
  m = text.match(/^(.+?) = (.+?)，應為 (.+)$/)
  if (m) return { label: m[1], from: m[2], to: m[3] }

  // "X 未綁定 Z"
  m = text.match(/^(.+?) 未綁定 (.+)$/)
  if (m) return { label: m[1], to: m[2] }

  return { raw: text }
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Chip({ text, variant }: { text: string; variant: 'wrong' | 'correct' }) {
  return <span className={`chip chip--${variant}`}>{text}</span>
}

function Arrow() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"
      stroke="#A0A0AA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  )
}

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <span className="color-swatch" style={{ background: hex }} />
  )
}

// ── Context menu ──────────────────────────────────────────────────────────────
interface CtxMenuProps {
  x: number
  y: number
  isIgnored: boolean
  onIgnore: () => void
  onClose: () => void
}

function ContextMenu({ x, y, isIgnored, onIgnore, onClose }: CtxMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside (or any click)
  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [onClose])

  // Clamp to viewport
  const menuW = 148
  const menuH = 36
  const left = Math.min(x, window.innerWidth - menuW - 8)
  const top = y + menuH > window.innerHeight ? y - menuH : y

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left, top }}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="ctx-menu-item"
        onClick={e => { e.stopPropagation(); onIgnore() }}
      >
        {isIgnored ? '取消忽略' : '忽略此問題'}
      </button>
    </div>
  )
}

// ── Component rule chips (right column only, no label) ────────────────────────
function ComponentRuleChips({ parts, raw }: { parts: ViolationParts; raw: string }) {
  if (parts.from || parts.to) {
    return (
      <span className="violation-structured">
        {parts.from && <Chip text={parts.from} variant="wrong" />}
        {parts.to && (
          <>
            <Arrow />
            <Chip text={parts.to} variant="correct" />
          </>
        )}
      </span>
    )
  }
  if (parts.to) return <Chip text={parts.to} variant="correct" />
  return <span className="violation-plain">{parts.raw ?? raw}</span>
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IssueItem({ issue, isIgnored = false, onSelect, onIgnore, onUnignore }: Props) {
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null)
  const breadcrumb = issue.breadcrumb.slice(-3).join(' › ')
  const key = `${issue.nodeId}::${issue.property}`

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxPos({ x: e.clientX, y: e.clientY })
  }

  const handleAction = () => {
    if (isIgnored) onUnignore(key)
    else onIgnore(key)
    setCtxPos(null)
  }

  const itemProps = {
    onClick: () => onSelect(issue.nodeId),
    onContextMenu: handleContextMenu,
    title: `點擊定位｜右鍵${isIgnored ? '取消忽略' : '忽略'}`,
  }

  const ctxMenu = ctxPos && (
    <ContextMenu
      x={ctxPos.x} y={ctxPos.y}
      isIgnored={isIgnored}
      onIgnore={handleAction}
      onClose={() => setCtxPos(null)}
    />
  )

  // Determine subtitle, right-column content, and layout per issue type
  let subtitle = breadcrumb
  let rightContent: React.ReactNode
  let vertical = false   // vertical = stacked layout for long text

  if (issue.type === 'COMPONENT_RULE') {
    const parts = parseViolation(issue.currentValue)
    if (parts.label) subtitle = parts.label
    if (parts.raw) {
      // raw text → too long for horizontal, use vertical
      rightContent = <span className="violation-plain">{parts.raw}</span>
      vertical = true
    } else {
      rightContent = <ComponentRuleChips parts={parts} raw={issue.currentValue} />
    }
  } else if (issue.type === 'HARDCODED_COLOR') {
    rightContent = (
      <span className="violation-color">
        <ColorSwatch hex={issue.currentValue} />
        <span className="violation-hex">{issue.currentValue}</span>
      </span>
    )
  } else if (issue.type === 'MISSING_TEXT_STYLE') {
    rightContent = (
      <span className="violation-tag violation-tag--missing">
        <span className="violation-tag-icon">T</span>
        未套用樣式
      </span>
    )
  } else {
    // HARDCODED_SPACING, WRONG_TOKEN, DEPRECATED_TOKEN — text can be long
    rightContent = <span className="violation-plain">{issue.currentValue}</span>
    vertical = true
  }

  const className = `issue-item${isIgnored ? ' issue-item--ignored' : ''}${vertical ? ' issue-item--vertical' : ''}`

  return (
    <>
      <div {...itemProps} className={className}>
        <div className="issue-left">
          <span className="issue-node-name">{issue.nodeName}</span>
          {subtitle && <span className="issue-breadcrumb">{subtitle}</span>}
        </div>
        <div className="issue-right">{rightContent}</div>
      </div>
      {ctxMenu}
    </>
  )
}
