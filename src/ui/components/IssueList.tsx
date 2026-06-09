import { useState } from 'react'
import type { Issue, CategoryEntry } from '../../../src/types'
import { ISSUE_LABELS } from '../../../src/types'
import IssueItem from './IssueItem'

interface Props {
  issues: Issue[]
  categoryMap: CategoryEntry[]
  onSelectNode: (id: string) => void
}

interface SubGroup {
  key: string
  label: string
  description?: string
  issues: Issue[]
}

interface CategoryGroup {
  name: string
  color: string
  subGroups: SubGroup[]
}

const CATEGORY_PALETTE = ['#2f7deb', '#f76808', '#e5484d', '#7a48e0', '#d2a106', '#d6409f', '#47a872']
const OTHER_COLOR = '#888'

function getRuleId(issue: Issue): string {
  return issue.property.replace(/^rule:/, '')
}

function buildCategoryGroups(issues: Issue[], categoryMap: CategoryEntry[]): CategoryGroup[] {
  const idToCat = new Map<string, string>()
  for (const cat of categoryMap) {
    for (const id of cat.ids) idToCat.set(id, cat.name)
  }

  // category name -> (subgroup key -> SubGroup)
  const catMap = new Map<string, Map<string, SubGroup>>()
  const catOrder = [...categoryMap.map(c => c.name), '其他']
  for (const name of catOrder) catMap.set(name, new Map())

  for (const issue of issues) {
    const lookupKey = issue.type === 'COMPONENT_RULE' ? getRuleId(issue) : issue.type
    const catName = idToCat.get(lookupKey) ?? '其他'
    const subGroupMap = catMap.get(catName)!

    const subKey = issue.type === 'COMPONENT_RULE' ? getRuleId(issue) : issue.type
    if (!subGroupMap.has(subKey)) {
      subGroupMap.set(subKey, {
        key: subKey,
        label: issue.type === 'COMPONENT_RULE' ? (issue.ruleName ?? subKey) : ISSUE_LABELS[issue.type],
        description: issue.type === 'COMPONENT_RULE' ? issue.ruleDescription : undefined,
        issues: [],
      })
    }
    subGroupMap.get(subKey)!.issues.push(issue)
  }

  const result: CategoryGroup[] = []
  let colorIdx = 0
  for (const name of catOrder) {
    const subGroupMap = catMap.get(name)!
    if (subGroupMap.size === 0) continue
    result.push({
      name,
      color: name === '其他' ? OTHER_COLOR : (CATEGORY_PALETTE[colorIdx++] ?? OTHER_COLOR),
      subGroups: Array.from(subGroupMap.values()),
    })
  }
  return result
}

function SubGroupBlock({ group, onSelectNode }: { group: SubGroup; onSelectNode: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  const [descOpen, setDescOpen] = useState(false)

  return (
    <div className="rule-subgroup">
      <button className="rule-subgroup-header" onClick={() => setOpen(o => !o)}>
        <span className="rule-subgroup-name">{group.label}</span>
        <span className="rule-subgroup-count">{group.issues.length}</span>
        {group.description && (
          <button
            className="rule-info-btn"
            title={descOpen ? '收合說明' : '展開說明'}
            onClick={e => { e.stopPropagation(); setDescOpen(o => !o) }}
          >i</button>
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

export default function IssueList({ issues, categoryMap, onSelectNode }: Props) {
  const categoryGroups = buildCategoryGroups(issues, categoryMap)
  const [closedCats, setClosedCats] = useState<Set<string>>(new Set())

  const toggle = (name: string) => setClosedCats(o => {
    const next = new Set(o)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })

  const total = issues.length

  return (
    <div className="issue-list">
      <div className="issue-total">
        共 {total} 個問題
        <span className="total-dot-group">
          {categoryGroups.map(g => (
            <span key={g.name} className="total-dot-count">
              <span className="total-dot" style={{ background: g.color }} />
              {g.subGroups.reduce((n, sg) => n + sg.issues.length, 0)}
            </span>
          ))}
        </span>
      </div>
      {categoryGroups.map(cat => {
        const isOpen = !closedCats.has(cat.name)
        const catCount = cat.subGroups.reduce((n, sg) => n + sg.issues.length, 0)
        return (
          <div key={cat.name} className="issue-group">
            <button className={`group-header ${isOpen ? 'open' : ''}`} onClick={() => toggle(cat.name)}>
              <span className="group-dot" style={{ background: cat.color }} />
              <span className="group-label">{cat.name}</span>
              <span className="group-count">{catCount}</span>
              <span className="chevron">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && cat.subGroups.map(sg => (
              <SubGroupBlock key={sg.key} group={sg} onSelectNode={onSelectNode} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
