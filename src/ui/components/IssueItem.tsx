import type { Issue } from '../../../src/types'

interface Props {
  issue: Issue
  onSelect: (nodeId: string) => void
}

export default function IssueItem({ issue, onSelect }: Props) {
  const breadcrumb = issue.breadcrumb.slice(-2).join(' › ')

  return (
    <div className="issue-item" onClick={() => onSelect(issue.nodeId)} title="點擊定位至此元素">
      <div className="issue-row1">
        <span className="issue-node-name">{issue.nodeName}</span>
        <span className="issue-property">{issue.property}</span>
      </div>
      <div className="issue-row2">
        {breadcrumb && <span className="issue-breadcrumb">{breadcrumb}</span>}
        <span className="issue-value">{issue.currentValue}</span>
      </div>
      {issue.ruleDescription && (
        <div className="issue-rule-desc">{issue.ruleDescription}</div>
      )}
    </div>
  )
}
