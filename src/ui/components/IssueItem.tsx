import type { Issue } from '../../../src/types'

interface Props {
  issue: Issue
  onSelect: (nodeId: string) => void
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

// ── Violation renderer ────────────────────────────────────────────────────────
function ViolationLine({ issue }: { issue: Issue }) {
  const { type, currentValue } = issue

  // Hardcoded color: just show swatch + hex
  if (type === 'HARDCODED_COLOR') {
    return (
      <span className="violation-color">
        <ColorSwatch hex={currentValue} />
        <span className="violation-hex">{currentValue}</span>
      </span>
    )
  }

  // Missing text style
  if (type === 'MISSING_TEXT_STYLE') {
    return (
      <span className="violation-tag violation-tag--missing">
        <span className="violation-tag-icon">T</span>
        未套用文字樣式
      </span>
    )
  }

  // Component rule: try structured parsing
  if (type === 'COMPONENT_RULE') {
    const parts = parseViolation(currentValue)

    if (parts.label && (parts.from || parts.to)) {
      return (
        <span className="violation-structured">
          <span className="violation-prop">{parts.label}</span>
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
  }

  // Default: plain red text
  return <span className="violation-plain">{currentValue}</span>
}

// ── Main component ────────────────────────────────────────────────────────────
export default function IssueItem({ issue, onSelect }: Props) {
  const breadcrumb = issue.breadcrumb.slice(-3).join(' › ')

  // Color issues: layout is node + breadcrumb on left, swatch + hex on right (same row)
  if (issue.type === 'HARDCODED_COLOR') {
    return (
      <div className="issue-item" onClick={() => onSelect(issue.nodeId)} title="點擊定位至此元素">
        <div className="issue-row-color">
          <div className="issue-left">
            <span className="issue-node-name">{issue.nodeName}</span>
            {breadcrumb && <span className="issue-breadcrumb">{breadcrumb}</span>}
          </div>
          <ViolationLine issue={issue} />
        </div>
      </div>
    )
  }

  return (
    <div className="issue-item" onClick={() => onSelect(issue.nodeId)} title="點擊定位至此元素">
      <span className="issue-node-name">{issue.nodeName}</span>
      {breadcrumb && <span className="issue-breadcrumb">{breadcrumb}</span>}
      <ViolationLine issue={issue} />
    </div>
  )
}
