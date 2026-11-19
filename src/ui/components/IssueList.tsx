import { useState } from 'react'
import type { Issue, CategoryEntry } from '../../../src/types'
import { ISSUE_LABELS } from '../../../src/types'
import IssueItem from './IssueItem'

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"
      stroke="#8A8A93" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  )
}

interface Props {
  issues: Issue[]
  ignoredKeys: Set<string>
  categoryMap: CategoryEntry[]
  onSelectNode: (id: string) => void
  onIgnore: (key: string) => void
  onUnignore: (key: string) => void
}

interface SubGroupData {
  key: string
  label: string
  description?: string
  issues: Issue[]
}

interface SubGroupProps {
  group: SubGroupData
  showHeader: boolean
  isIgnoredGroup: boolean
  onSelectNode: (id: string) => void
  onIgnore: (key: string) => void
  onUnignore: (key: string) => void
}

interface CategoryGroup {
  name: string
  color: string
  subGroups: SubGroupData[]
}

const CATEGORY_PALETTE = ['#2f7deb', '#f76808', '#e5484d', '#7a48e0', '#d2a106', '#d6409f', '#47a872']
const OTHER_COLOR = '#888'
const IGNORED_COLOR = '#aaa'

function issueKey(issue: Issue): string {
  return `${issue.nodeId}::${issue.property}`
}

function getRuleId(issue: Issue): string {
  return issue.property.replace(/^rule:/, '')
}

function buildSubGroups(issues: Issue[]): SubGroupData[] {
  const map = new Map<string, SubGroupData>()
  for (const issue of issues) {
    const subKey = issue.type === 'COMPONENT_RULE' ? getRuleId(issue) : issue.type
    if (!map.has(subKey)) {
      map.set(subKey, {
        key: subKey,
        label: issue.type === 'COMPONENT_RULE' ? (issue.ruleName ?? subKey) : ISSUE_LABELS[issue.type],
        description: issue.type === 'COMPONENT_RULE' ? issue.ruleDescription : undefined,
        issues: [],
      })
    }
    map.get(subKey)!.issues.push(issue)
  }
  return Array.from(map.values())
}

function buildCategoryGroups(issues: Issue[], categoryMap: CategoryEntry[]): CategoryGroup[] {
  const idToCat = new Map<string, string>()
  for (const cat of categoryMap) {
    for (const id of cat.ids) idToCat.set(id, cat.name)
  }

  const catIssues = new Map<string, Issue[]>()
  const catOrder = [...categoryMap.map(c => c.name), '其他']
  for (const name of catOrder) catIssues.set(name, [])

  for (const issue of issues) {
    const lookupKey = issue.type === 'COMPONENT_RULE' ? getRuleId(issue) : issue.type
    const catName = idToCat.get(lookupKey) ?? '其他'
    catIssues.get(catName)!.push(issue)
  }

  const result: CategoryGroup[] = []
  let colorIdx = 0
  for (const name of catOrder) {
    const catIss = catIssues.get(name)!
    if (catIss.length === 0) continue
    result.push({
      name,
      color: name === '其他' ? OTHER_COLOR : (CATEGORY_PALETTE[colorIdx++] ?? OTHER_COLOR),
      subGroups: buildSubGroups(catIss),
    })
  }
  return result
}

function SubGroupBlock({ group, showHeader, isIgnoredGroup, onSelectNode, onIgnore, onUnignore }: SubGroupProps) {
  const [open, setOpen] = useState(true)
  const [descOpen, setDescOpen] = useState(false)

  return (
    <div className="rule-subgroup">
      {showHeader && (
        <button className="rule-subgroup-header" onClick={() => setOpen(o => !o)}>
          <ChevronIcon open={open} />
          <span className="rule-subgroup-name">{group.label}</span>
          {group.description && (
            <button
              className="rule-info-btn"
              title={descOpen ? '收合說明' : '展開說明'}
              onClick={e => { e.stopPropagation(); setDescOpen(o => !o) }}
            >i</button>
          )}
          <span className="rule-subgroup-count">{group.issues.length}</span>
        </button>
      )}
      {descOpen && group.description && (
        <div className="rule-subgroup-desc">{group.description}</div>
      )}
      {(!showHeader || open) && group.issues.map((issue, i) => (
        <IssueItem
          key={`${issue.nodeId}-${issue.property}-${i}`}
          issue={issue}
          isIgnored={isIgnoredGroup}
          onSelect={onSelectNode}
          onIgnore={onIgnore}
          onUnignore={onUnignore}
        />
      ))}
    </div>
  )
}

export default function IssueList({ issues, ignoredKeys, categoryMap, onSelectNode, onIgnore, onUnignore }: Props) {
  const normalIssues = issues.filter(i => !ignoredKeys.has(issueKey(i)))
  const ignoredIssues = issues.filter(i => ignoredKeys.has(issueKey(i)))

  const categoryGroups = buildCategoryGroups(normalIssues, categoryMap)
  const ignoredSubGroups = buildSubGroups(ignoredIssues)

  const [closedCats, setClosedCats] = useState<Set<string>>(new Set(['__ignored__']))

  const toggle = (name: string) => setClosedCats(o => {
    const next = new Set(o)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })

  const total = normalIssues.length

  return (
    <div className="issue-list">
      <div className="issue-total">{total} 個問題</div>

      {/* Normal issue categories */}
      {categoryGroups.map(cat => {
        const isOpen = !closedCats.has(cat.name)
        const catCount = cat.subGroups.reduce((n, sg) => n + sg.issues.length, 0)
        return (
          <div key={cat.name} className="issue-group">
            <button className={`group-header ${isOpen ? 'open' : ''}`} onClick={() => toggle(cat.name)}>
              <span className="group-label">{cat.name}</span>
              <span className="group-count">{catCount}</span>
              <ChevronIcon open={isOpen} />
            </button>
            {isOpen && cat.subGroups.map(sg => (
              <SubGroupBlock
                key={sg.key}
                group={sg}
                showHeader={sg.issues[0]?.type === 'COMPONENT_RULE'}
                isIgnoredGroup={false}
                onSelectNode={onSelectNode}
                onIgnore={onIgnore}
                onUnignore={onUnignore}
              />
            ))}
          </div>
        )
      })}

      {/* Ignored category — default collapsed */}
      {ignoredIssues.length > 0 && (
        <div className="issue-group issue-group--ignored">
          <button
            className={`group-header ${!closedCats.has('__ignored__') ? 'open' : ''}`}
            onClick={() => toggle('__ignored__')}
          >
            <span className="group-dot" style={{ background: IGNORED_COLOR }} />
            <span className="group-label">已忽略</span>
            <span className="group-count">{ignoredIssues.length}</span>
            <ChevronIcon open={!closedCats.has('__ignored__')} />
          </button>
          {!closedCats.has('__ignored__') && ignoredSubGroups.map(sg => (
            <SubGroupBlock
              key={sg.key}
              group={sg}
              showHeader={sg.issues[0]?.type === 'COMPONENT_RULE'}
              isIgnoredGroup={true}
              onSelectNode={onSelectNode}
              onIgnore={onIgnore}
              onUnignore={onUnignore}
            />
          ))}
        </div>
      )}
    </div>
  )
}
