import { useState } from 'react'
import type { Issue, IssueType } from '../../../src/types'
import { ISSUE_LABELS } from '../../../src/types'
import IssueItem from './IssueItem'

interface Props {
  issues: Issue[]
  onSelectNode: (id: string) => void
}

const GROUP_ORDER: IssueType[] = [
  'HARDCODED_COLOR',
  'HARDCODED_SPACING',
  'WRONG_TOKEN',
  'DEPRECATED_TOKEN',
  'MISSING_TEXT_STYLE',
  'COMPONENT_RULE',
]

export default function IssueList({ issues, onSelectNode }: Props) {
  const grouped = GROUP_ORDER.reduce<Record<IssueType, Issue[]>>((acc, type) => {
    acc[type] = issues.filter(i => i.type === type)
    return acc
  }, {} as Record<IssueType, Issue[]>)

  const [open, setOpen] = useState<Record<IssueType, boolean>>(() =>
    GROUP_ORDER.reduce<Record<IssueType, boolean>>((acc, t) => { acc[t] = true; return acc }, {} as Record<IssueType, boolean>)
  )

  const toggle = (type: IssueType) => setOpen(o => ({ ...o, [type]: !o[type] }))

  return (
    <div className="issue-list">
      {GROUP_ORDER.map(type => {
        const group = grouped[type]
        if (group.length === 0) return null
        const isOpen = open[type]
        return (
          <div key={type} className="issue-group">
            <button
              className={`group-header ${isOpen ? 'open' : ''}`}
              onClick={() => toggle(type)}
            >
              <span className={`group-dot dot-${type}`} />
              <span className="group-label">{ISSUE_LABELS[type]}</span>
              <span className="group-count">{group.length}</span>
              <span className="chevron">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && group.map((issue, i) => (
              <IssueItem key={`${issue.nodeId}-${issue.property}-${i}`} issue={issue} onSelect={onSelectNode} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
