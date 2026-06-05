import { useState } from 'react'
import type { Issue, IssueType } from '../../../src/types'
import { ISSUE_LABELS } from '../../../src/types'
import IssueItem from './IssueItem'

interface Props {
  issues: Issue[]
  onSelectNode: (id: string) => void
}

const TYPE_ORDER: IssueType[] = [
  'HARDCODED_COLOR',
  'HARDCODED_SPACING',
  'WRONG_TOKEN',
  'DEPRECATED_TOKEN',
  'MISSING_TEXT_STYLE',
  'COMPONENT_RULE',
]

// For COMPONENT_RULE: sub-group by rule id
interface RuleGroup {
  ruleId: string
  ruleName: string
  description: string
  issues: Issue[]
}

function groupByRule(issues: Issue[]): RuleGroup[] {
  const map = new Map<string, RuleGroup>()
  for (const issue of issues) {
    const ruleId = issue.property.replace(/^rule:/, '')
    if (!map.has(ruleId)) {
      map.set(ruleId, {
        ruleId,
        ruleName: issue.ruleName ?? ruleId,
        description: issue.ruleDescription ?? '',
        issues: [],
      })
    }
    map.get(ruleId)!.issues.push(issue)
  }
  return Array.from(map.values())
}

function RuleSubGroup({ group, onSelectNode }: { group: RuleGroup; onSelectNode: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  const [descOpen, setDescOpen] = useState(false)

  return (
    <div className="rule-subgroup">
      <button className="rule-subgroup-header" onClick={() => setOpen(o => !o)}>
        <span className="rule-subgroup-name">{group.ruleName}</span>
        <span className="rule-subgroup-count">{group.issues.length}</span>
        {group.description && (
          <span
            className="rule-info-btn"
            title={descOpen ? '收合說明' : '展開說明'}
            onClick={e => { e.stopPropagation(); setDescOpen(o => !o) }}
          >ℹ</span>
        )}
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </button>

      {descOpen && group.description && (
        <div className="rule-subgroup-desc">{group.description}</div>
      )}

      {open && group.issues.map((issue, i) => (
        <IssueItem
          key={`${issue.nodeId}-${issue.property}-${i}`}
          issue={issue}
          onSelect={onSelectNode}
        />
      ))}
    </div>
  )
}

export default function IssueList({ issues, onSelectNode }: Props) {
  const grouped = TYPE_ORDER.reduce<Record<IssueType, Issue[]>>((acc, type) => {
    acc[type] = issues.filter(i => i.type === type)
    return acc
  }, {} as Record<IssueType, Issue[]>)

  const [open, setOpen] = useState<Record<IssueType, boolean>>(() =>
    TYPE_ORDER.reduce<Record<IssueType, boolean>>((acc, t) => { acc[t] = true; return acc }, {} as Record<IssueType, boolean>)
  )

  const toggle = (type: IssueType) => setOpen(o => ({ ...o, [type]: !o[type] }))

  const total = issues.length

  return (
    <div className="issue-list">
      <div className="issue-total">共 {total} 個問題</div>
      {TYPE_ORDER.map(type => {
        const group = grouped[type]
        if (group.length === 0) return null
        const isOpen = open[type]

        return (
          <div key={type} className="issue-group">
            <button className={`group-header ${isOpen ? 'open' : ''}`} onClick={() => toggle(type)}>
              <span className={`group-dot dot-${type}`} />
              <span className="group-label">{ISSUE_LABELS[type]}</span>
              <span className="group-count">{group.length}</span>
              <span className="chevron">{isOpen ? '▾' : '▸'}</span>
            </button>

            {isOpen && (
              type === 'COMPONENT_RULE'
                ? groupByRule(group).map(ruleGroup => (
                    <RuleSubGroup key={ruleGroup.ruleId} group={ruleGroup} onSelectNode={onSelectNode} />
                  ))
                : group.map((issue, i) => (
                    <IssueItem key={`${issue.nodeId}-${issue.property}-${i}`} issue={issue} onSelect={onSelectNode} />
                  ))
            )}
          </div>
        )
      })}
    </div>
  )
}
