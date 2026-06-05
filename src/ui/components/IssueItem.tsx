import type { Issue } from '../../../src/types'

interface Props {
  issue: Issue
  onSelect: (nodeId: string) => void
}

export default function IssueItem({ issue, onSelect }: Props) {
  const breadcrumb = issue.breadcrumb.slice(-3).join(' › ')

  return (
    <div className="issue-item" onClick={() => onSelect(issue.nodeId)} title="點擊定位至此元素">
      <span className="issue-node-name">{issue.nodeName}</span>
      {breadcrumb && <span className="issue-breadcrumb">{breadcrumb}</span>}
      <span className="issue-violation">{issue.currentValue}</span>
    </div>
  )
}
