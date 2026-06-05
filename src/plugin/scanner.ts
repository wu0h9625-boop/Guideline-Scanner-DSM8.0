import type { Issue, DesignSystemCache } from '../types'
import {
  checkFillsAndStrokes,
  checkSpacing,
  checkTextStyle,
  checkComponentRules,
  getExemptSpacingValues,
  clearVarCache,
} from './rules'

const SKIP_TYPES: SceneNode['type'][] = ['CONNECTOR', 'STICKY', 'SHAPE_WITH_TEXT', 'CODE_BLOCK']

async function checkNode(
  node: SceneNode,
  cache: DesignSystemCache,
  breadcrumb: string[],
  withinInstance = false
): Promise<Issue[]> {
  if (SKIP_TYPES.includes(node.type)) return []

  const { id, name } = node
  const issues: Issue[] = []

  const exemptSpacing = getExemptSpacingValues(name, cache.componentRules)
  const [colorIssues, spacingIssues] = await Promise.all([
    checkFillsAndStrokes(node, cache, id, name, breadcrumb),
    checkSpacing(node, cache, id, name, breadcrumb, exemptSpacing),
  ])

  const componentIssues = await checkComponentRules(node, cache, id, name, breadcrumb, withinInstance)

  issues.push(...colorIssues, ...spacingIssues, ...checkTextStyle(node, id, name, breadcrumb), ...componentIssues)
  return issues
}

export async function scanNodes(
  roots: readonly SceneNode[],
  cache: DesignSystemCache
): Promise<{ issues: Issue[]; nodeCount: number }> {
  clearVarCache()

  const issues: Issue[] = []
  let nodeCount = 0

  async function traverse(node: SceneNode, breadcrumb: string[], withinInstance = false): Promise<void> {
    if (node.visible === false || node.locked) return

    nodeCount++
    const nodeIssues = await checkNode(node, cache, breadcrumb, withinInstance)
    issues.push(...nodeIssues)

    if ('children' in node) {
      const childBreadcrumb = [...breadcrumb, node.name]
      const nextWithinInstance = withinInstance || node.type === 'INSTANCE'
      for (const child of node.children) {
        await traverse(child, childBreadcrumb, nextWithinInstance)
      }
    }
  }

  for (const root of roots) {
    await traverse(root, [])
  }

  return { issues, nodeCount }
}
