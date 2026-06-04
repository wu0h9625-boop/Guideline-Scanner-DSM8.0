import type { Issue, DesignSystemCache } from '../types'

// Per-scan cache to avoid redundant variable lookups
const varCollectionKeyCache = new Map<string, string | null>()

export function clearVarCache(): void {
  varCollectionKeyCache.clear()
}

async function getCollectionKey(variableId: string): Promise<string | null> {
  if (varCollectionKeyCache.has(variableId)) {
    return varCollectionKeyCache.get(variableId)!
  }
  try {
    const variable = await figma.variables.getVariableByIdAsync(variableId)
    if (!variable) {
      varCollectionKeyCache.set(variableId, null)
      return null
    }
    const collection = figma.variables.getVariableCollectionById(variable.variableCollectionId)
    const key = collection?.key ?? null
    varCollectionKeyCache.set(variableId, key)
    return key
  } catch (_) {
    varCollectionKeyCache.set(variableId, null)
    return null
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

async function checkTokenBinding(
  variableId: string,
  cache: DesignSystemCache,
  base: Omit<Issue, 'type' | 'currentValue'>,
  valueLabel: string
): Promise<Issue | null> {
  const colKey = await getCollectionKey(variableId)
  if (colKey === null) return null // Can't resolve → skip

  if (cache.deprecatedCollectionKeys.includes(colKey)) {
    return { ...base, type: 'DEPRECATED_TOKEN', currentValue: `${valueLabel}（廢棄的 token）` }
  }
  if (cache.approvedCollectionKeys.length > 0 && !cache.approvedCollectionKeys.includes(colKey)) {
    return { ...base, type: 'WRONG_TOKEN', currentValue: `${valueLabel}（來自未核准的 collection）` }
  }
  return null
}

export async function checkFillsAndStrokes(
  node: SceneNode,
  cache: DesignSystemCache,
  nodeId: string,
  nodeName: string,
  breadcrumb: string[]
): Promise<Issue[]> {
  const issues: Issue[] = []
  const base = { nodeId, nodeName, breadcrumb }

  const sources: Array<{ list: readonly Paint[] | typeof figma.mixed; label: string }> = []
  if ('fills' in node) sources.push({ list: node.fills, label: 'fill' })
  if ('strokes' in node) sources.push({ list: node.strokes, label: 'stroke' })

  for (const { list, label } of sources) {
    if (!Array.isArray(list)) continue
    for (let i = 0; i < list.length; i++) {
      const paint = list[i]
      if (paint.type !== 'SOLID') continue

      const boundVarId = (paint as SolidPaint & { boundVariables?: { color?: VariableAlias } })
        .boundVariables?.color?.id

      if (!boundVarId) {
        const hex = rgbToHex(paint.color.r, paint.color.g, paint.color.b)
        issues.push({ ...base, type: 'HARDCODED_COLOR', property: `${label}[${i}]`, currentValue: hex })
      } else {
        const issue = await checkTokenBinding(boundVarId, cache, { ...base, property: `${label}[${i}]` }, 'color')
        if (issue) issues.push(issue)
      }
    }
  }

  return issues
}

const SPACING_PROPS = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing'] as const
type SpacingProp = typeof SPACING_PROPS[number]

export async function checkSpacing(
  node: SceneNode,
  cache: DesignSystemCache,
  nodeId: string,
  nodeName: string,
  breadcrumb: string[]
): Promise<Issue[]> {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE') return []

  const issues: Issue[] = []
  const base = { nodeId, nodeName, breadcrumb }
  const boundVars = (node as FrameNode).boundVariables ?? {}

  for (const prop of SPACING_PROPS) {
    if (!(prop in node)) continue
    const value = (node as unknown as Record<SpacingProp, number>)[prop]
    const alias = (boundVars as Record<string, VariableAlias | undefined>)[prop]

    if (alias?.id) {
      const issue = await checkTokenBinding(alias.id, cache, { ...base, property: prop }, `${value}px`)
      if (issue) issues.push(issue)
    } else if (value !== 0 && !cache.allowedSpacingValues.includes(value)) {
      issues.push({ ...base, type: 'HARDCODED_SPACING', property: prop, currentValue: `${value}px` })
    }
  }

  return issues
}

export function checkTextStyle(
  node: SceneNode,
  nodeId: string,
  nodeName: string,
  breadcrumb: string[]
): Issue[] {
  if (node.type !== 'TEXT') return []
  const id = node.textStyleId
  if (!id || id === '' || id === figma.mixed) {
    return [{
      nodeId, nodeName, breadcrumb,
      type: 'MISSING_TEXT_STYLE',
      property: 'textStyle',
      currentValue: '未套用文字樣式',
    }]
  }
  return []
}

export async function checkComponentRules(
  node: SceneNode,
  cache: DesignSystemCache,
  nodeId: string,
  nodeName: string,
  breadcrumb: string[]
): Promise<Issue[]> {
  if (!cache.componentRules.length) return []

  const issues: Issue[] = []
  const nameLower = nodeName.toLowerCase()

  for (const rule of cache.componentRules) {
    if (!nameLower.includes(rule.targetComponentName.toLowerCase())) continue

    for (const check of rule.checks) {
      const ruleBase = { nodeId, nodeName, breadcrumb, ruleDescription: rule.description, property: `rule:${rule.id}` }

      if (check.type === 'mustHaveParentFrame') {
        if (!node.parent || node.parent.type !== 'FRAME') {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: '未包在 frame 內' })
        }

      } else if (check.type === 'parentPadding') {
        const parent = node.parent
        if (!parent || !('layoutMode' in parent)) continue

        const propMap: Record<string, SpacingProp> = {
          top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft'
        }
        const prop = propMap[check.side]
        const parentBoundVars = (parent as FrameNode).boundVariables ?? {}
        const alias = (parentBoundVars as Record<string, VariableAlias | undefined>)[prop]

        if (!alias?.id) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `父層 ${check.side} padding 未綁定 ${check.variableName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !variable.name.toLowerCase().includes(check.variableName.toLowerCase())) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `父層使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'mustHaveParentNamed') {
        const parent = node.parent
        if (!parent || !('name' in parent) || !parent.name.toLowerCase().includes(check.parentName.toLowerCase())) {
          const actualName = parent && 'name' in parent ? parent.name : '（無父層）'
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `父層為「${actualName}」，應放在名稱含「${check.parentName}」的 frame 內` })
        }

      } else if (check.type === 'parentItemSpacing') {
        const parent = node.parent
        if (!parent || !('layoutMode' in parent)) continue

        const parentBoundVars = (parent as FrameNode).boundVariables ?? {}
        const alias = (parentBoundVars as Record<string, VariableAlias | undefined>)['itemSpacing']

        if (!alias?.id) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `父層 item spacing 未綁定 ${check.variableName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !variable.name.toLowerCase().includes(check.variableName.toLowerCase())) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `父層使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'ownPadding') {
        if (!('layoutMode' in node)) continue

        const propMap: Record<string, SpacingProp> = {
          top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft'
        }
        const prop = propMap[check.side]
        const boundVars = (node as FrameNode).boundVariables ?? {}
        const alias = (boundVars as Record<string, VariableAlias | undefined>)[prop]

        if (!alias?.id) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding 未綁定 ${check.variableName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !variable.name.toLowerCase().includes(check.variableName.toLowerCase())) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding 使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'ownPaddingByContext') {
        if (!('layoutMode' in node)) continue

        const propMap: Record<string, SpacingProp> = {
          top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft'
        }
        const prop = propMap[check.side]
        const grandparent = node.parent?.parent
        const hasSibling = grandparent && 'children' in grandparent &&
          grandparent.children.some(c => c !== node.parent && c.name.toLowerCase().includes(check.ifParentSiblingNamed.toLowerCase()))

        if (hasSibling) {
          const value = (node as unknown as Record<SpacingProp, number>)[prop]
          if (value !== check.thenExpectedPx) {
            issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding = ${value}px，有 ${check.ifParentSiblingNamed} 時應為 ${check.thenExpectedPx}px` })
          }
        } else {
          const boundVars = (node as FrameNode).boundVariables ?? {}
          const alias = (boundVars as Record<string, VariableAlias | undefined>)[prop]
          if (!alias?.id) {
            issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding 未綁定 ${check.elseVariableName}（無 ${check.ifParentSiblingNamed} 時需綁定）` })
          } else {
            try {
              const variable = await figma.variables.getVariableByIdAsync(alias.id)
              if (variable && !variable.name.toLowerCase().includes(check.elseVariableName.toLowerCase())) {
                issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding 使用了 ${variable.name}，應使用 ${check.elseVariableName}` })
              }
            } catch (_) { /* ignore */ }
          }
        }

      } else if (check.type === 'ownItemSpacingByChildType') {
        if (!('children' in node) || !('layoutMode' in node)) continue

        const hasMatchingChild = (node as FrameNode).children
          .some(c => c.name.toLowerCase().includes(check.ifHasChildNamed.toLowerCase()))
        const expectedVarName = hasMatchingChild ? check.thenVariableName : check.elseVariableName

        const boundVars = (node as FrameNode).boundVariables ?? {}
        const alias = (boundVars as Record<string, VariableAlias | undefined>)['itemSpacing']

        if (!alias?.id) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `item spacing 未綁定 ${expectedVarName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !variable.name.toLowerCase().includes(expectedVarName.toLowerCase())) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `item spacing 使用了 ${variable.name}，應使用 ${expectedVarName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'ownPaddingByAncestor') {
        if (!('layoutMode' in node)) continue

        const propMap: Record<string, SpacingProp> = {
          top: 'paddingTop', right: 'paddingRight', bottom: 'paddingBottom', left: 'paddingLeft'
        }
        const prop = propMap[check.side]

        let current: BaseNode | null = node.parent
        let hasAncestor = false
        while (current) {
          if ('name' in current && current.name.toLowerCase().includes(check.ifHasAncestorNamed.toLowerCase())) {
            hasAncestor = true
            break
          }
          current = current.parent
        }

        const expectedVarName = hasAncestor ? check.thenVariableName : check.elseVariableName
        const boundVars = (node as FrameNode).boundVariables ?? {}
        const alias = (boundVars as Record<string, VariableAlias | undefined>)[prop]

        if (!alias?.id) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding 未綁定 ${expectedVarName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !variable.name.toLowerCase().includes(expectedVarName.toLowerCase())) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding 使用了 ${variable.name}，應使用 ${expectedVarName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'requiredProperty') {
        const actual = (node as unknown as Record<string, unknown>)[check.property]
        if (actual !== check.expectedValue) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.property} = ${String(actual)}，應為 ${check.expectedValue}` })
        }

      } else if (check.type === 'forbiddenProperty') {
        const actual = (node as unknown as Record<string, unknown>)[check.property]
        if (actual !== undefined && actual !== null) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `不應設定 ${check.property}` })
        }
      }
    }
  }

  return issues
}
