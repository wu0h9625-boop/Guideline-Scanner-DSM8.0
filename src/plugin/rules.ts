import type { Issue, DesignSystemCache, ComponentRule } from '../types'

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

/** 把間距數值寫成人看得懂的字串，整數不補小數。 */
function pxLabel(n: number): string {
  return `${Number.isInteger(n) ? n : Math.round(n * 100) / 100}px`
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

/** Returns spacing values that should be exempt from HARDCODED_SPACING for a given node. */
export function getExemptSpacingValues(nodeName: string, componentRules: ComponentRule[]): number[] {
  const exempt = new Set<number>()
  for (const rule of componentRules) {
    if (rule.exemptHardcodedSpacing?.length && nameMatches(nodeName, rule.targetComponentName)) {
      rule.exemptHardcodedSpacing.forEach(v => exempt.add(v))
    }
  }
  return Array.from(exempt)
}

export async function checkSpacing(
  node: SceneNode,
  cache: DesignSystemCache,
  nodeId: string,
  nodeName: string,
  breadcrumb: string[],
  extraAllowedValues: number[] = []
): Promise<Issue[]> {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE') return []

  const issues: Issue[] = []
  const base = { nodeId, nodeName, breadcrumb }
  const boundVars = (node as FrameNode).boundVariables ?? {}
  const allowedValues = extraAllowedValues.length
    ? new Set([...cache.allowedSpacingValues, ...extraAllowedValues])
    : null

  const indentBase = cache.leftPaddingIndentMultipleOf

  for (const prop of SPACING_PROPS) {
    if (!(prop in node)) continue
    const value = (node as unknown as Record<SpacingProp, number>)[prop]
    const alias = (boundVars as Record<string, VariableAlias | undefined>)[prop]

    if (prop === 'paddingLeft' && indentBase && value > 0 && value % indentBase === 0) continue

    if (alias?.id) {
      const issue = await checkTokenBinding(alias.id, cache, { ...base, property: prop }, `${value}px`)
      if (issue) issues.push(issue)
    } else if (value !== 0) {
      const allowed = allowedValues ? allowedValues.has(value) : cache.allowedSpacingValues.includes(value)
      if (!allowed) {
        issues.push({ ...base, type: 'HARDCODED_SPACING', property: prop, currentValue: `${value}px` })
      }
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

/** 名稱比對：pattern 和 name 都先切成 token（以非英數字元為分隔符）。
 *  比對策略（任一成立即視為符合）：
 *  1. 所有 pattern token 都以完整詞彙出現在 name tokens 中（防止 "tab" 誤中 "table"）
 *  2. pattern tokens join 後的字串，等於 name tokens 中某段連續 join 的字串
 *     （使 "toolbar" 同時匹配 "Toolbar" 和 "Tool Bar"、"Nav/Tool Bar"）
 *  空 pattern 匹配任意名稱。 */
function nameMatches(name: string, pattern: string): boolean {
  const nameTokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const patternTokens = pattern.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (patternTokens.length === 0) return true

  // 1. All pattern tokens present as whole words
  if (patternTokens.every(w => nameTokens.includes(w))) return true

  // 2. Pattern tokens compacted must appear as consecutive run in name tokens
  const patternCompact = patternTokens.join('')
  for (let i = 0; i < nameTokens.length; i++) {
    let joined = ''
    for (let j = i; j < nameTokens.length; j++) {
      joined += nameTokens[j]
      if (joined === patternCompact) return true
      if (joined.length >= patternCompact.length) break
    }
  }

  return false
}

/** Variable 名稱比對：將 "/" 和 "-" 視為相同分隔符，不分大小寫。
 *  "spacing/8" 和 "spacing-8" 視為相符。 */
function varNameMatches(variableName: string, pattern: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[-/]/g, '\u0000')
  return norm(variableName).includes(norm(pattern))
}

const STRUCTURAL_CHECKS = new Set([
  'mustHaveParentFrame', 'mustHaveParentNamed', 'skipIfParentNamed',
  'parentPadding', 'parentItemSpacing', 'ownPadding',
  'ownPaddingByContext', 'ownPaddingByAncestor', 'ownItemSpacingByChildType',
])

export async function checkComponentRules(
  node: SceneNode,
  cache: DesignSystemCache,
  nodeId: string,
  nodeName: string,
  breadcrumb: string[],
  withinInstance = false,
  rootNodeIds?: ReadonlySet<string>
): Promise<Issue[]> {
  if (!cache.componentRules.length) return []

  const issues: Issue[] = []

  for (const rule of cache.componentRules) {
    if (rule.targetComponentNames) {
      const nodeTokens = nodeName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
      const nodeSet = new Set(nodeTokens)
      const matchesAny = rule.targetComponentNames.some(pattern => {
        const pts = pattern.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
        return pts.length === nodeSet.size && pts.every(t => nodeSet.has(t))
      })
      if (!matchesAny) continue
    } else {
      if (!nameMatches(nodeName, rule.targetComponentName)) continue
    }
    if (rule.excludeComponentName && nameMatches(nodeName, rule.excludeComponentName)) continue
    if (rule.excludeComponentNames?.some(p => nameMatches(nodeName, p))) continue
    if (rule.nodeTypeFilter && node.type !== rule.nodeTypeFilter) continue
    if (rule.requiredAncestorName) {
      let cur: BaseNode | null = node.parent
      let found = false
      while (cur) {
        if ('name' in cur && nameMatches(cur.name, rule.requiredAncestorName)) { found = true; break }
        cur = cur.parent
      }
      if (!found) continue
    }

    let skipRule = false
    for (const check of rule.checks) {
      if (skipRule) break
      // Inside an instance, only run token-related checks (skip structural checks)
      if (withinInstance && STRUCTURAL_CHECKS.has(check.type)) continue
      const ruleBase = { nodeId, nodeName, breadcrumb, ruleName: rule.name, ruleDescription: rule.description, property: `rule:${rule.id}` }

      if (check.type === 'skipIfParentNamed') {
        const parent = node.parent
        if (parent && 'name' in parent && nameMatches(parent.name, check.parentName)) {
          skipRule = true
        }

      } else if (check.type === 'skipIfHasChildNamed') {
        if ('children' in node) {
          const hasChild = (node as FrameNode).children
            .some(c => nameMatches(c.name, check.childName))
          if (hasChild) skipRule = true
        }

      } else if (check.type === 'skipIfHasAncestorNamed') {
        let cur: BaseNode | null = node.parent
        while (cur) {
          if ('name' in cur && nameMatches(cur.name, check.ancestorName)) { skipRule = true; break }
          cur = cur.parent
        }

      } else if (check.type === 'mustBeTopLevel') {
        const parentType = node.parent?.type
        if (parentType !== 'PAGE' && parentType !== 'SECTION') {
          skipRule = true
        }

      } else if (check.type === 'mustBeRootNode') {
        if (!rootNodeIds?.has(nodeId)) {
          skipRule = true
        }

      } else if (check.type === 'mustHaveParentFrame') {
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
            if (variable && !varNameMatches(variable.name, check.variableName)) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `父層使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'mustHaveParentNamed') {
        const parent = node.parent
        if (!parent || !('name' in parent) || !nameMatches(parent.name, check.parentName)) {
          const actualName = parent && 'name' in parent ? parent.name : '（無父層）'
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `父層為「${actualName}」，應放在名稱含「${check.parentName}」的 frame 內` })
        }

      } else if (check.type === 'parentItemSpacing') {
        const parent = node.parent
        if (!parent || !('layoutMode' in parent)) continue

        // 要改的是父層 frame，所以問題掛在父層上，點擊才會選到正確的節點
        const target = parent as FrameNode
        const targetBase = { ...ruleBase, nodeId: target.id, nodeName: target.name, breadcrumb: breadcrumb.slice(0, -1) }
        const alias = ((target.boundVariables ?? {}) as Record<string, VariableAlias | undefined>)['itemSpacing']

        if (!alias?.id) {
          issues.push({ ...targetBase, type: 'COMPONENT_RULE', currentValue: `item spacing = ${pxLabel(target.itemSpacing)} 未綁 token，應為 ${check.variableName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !varNameMatches(variable.name, check.variableName)) {
              issues.push({ ...targetBase, type: 'COMPONENT_RULE', currentValue: `item spacing 使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'grandparentItemSpacing') {
        const grandparent = node.parent?.parent
        if (!grandparent || !('layoutMode' in grandparent)) continue

        // 要改的是祖父層 frame，所以問題掛在祖父層上，點擊才會選到正確的節點
        const target = grandparent as FrameNode
        const targetBase = { ...ruleBase, nodeId: target.id, nodeName: target.name, breadcrumb: breadcrumb.slice(0, -2) }
        const alias = ((target.boundVariables ?? {}) as Record<string, VariableAlias | undefined>)['itemSpacing']

        if (!alias?.id) {
          issues.push({ ...targetBase, type: 'COMPONENT_RULE', currentValue: `item spacing = ${pxLabel(target.itemSpacing)} 未綁 token，應為 ${check.variableName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !varNameMatches(variable.name, check.variableName)) {
              issues.push({ ...targetBase, type: 'COMPONENT_RULE', currentValue: `item spacing 使用了 ${variable.name}，應使用 ${check.variableName}` })
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
            if (variable && !varNameMatches(variable.name, check.variableName)) {
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
              if (variable && !varNameMatches(variable.name, check.elseVariableName)) {
                issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding 使用了 ${variable.name}，應使用 ${check.elseVariableName}` })
              }
            } catch (_) { /* ignore */ }
          }
        }

      } else if (check.type === 'ownItemSpacing') {
        if (!('layoutMode' in node)) continue
        const boundVars = (node as FrameNode).boundVariables ?? {}
        const alias = (boundVars as Record<string, VariableAlias | undefined>)['itemSpacing']
        if (!alias?.id) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `item spacing 未綁定 ${check.variableName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !varNameMatches(variable.name, check.variableName)) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `item spacing 使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'ownItemSpacingIfHasChild') {
        if (!('children' in node) || !('layoutMode' in node)) continue
        const hasChild = (node as FrameNode).children
          .some(c => nameMatches(c.name, check.childName))
        if (!hasChild) continue
        const boundVars = (node as FrameNode).boundVariables ?? {}
        const alias = (boundVars as Record<string, VariableAlias | undefined>)['itemSpacing']
        if (!alias?.id) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `item spacing 未綁定 ${check.variableName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(alias.id)
            if (variable && !varNameMatches(variable.name, check.variableName)) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `item spacing 使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
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
            if (variable && !varNameMatches(variable.name, expectedVarName)) {
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
          if ('name' in current && nameMatches(current.name, check.ifHasAncestorNamed)) {
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
            if (variable && !varNameMatches(variable.name, expectedVarName)) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.side} padding 使用了 ${variable.name}，應使用 ${expectedVarName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'requiredPropertyIfHasChild') {
        if (!('children' in node)) continue

        // Recursively check all descendants, not just direct children
        function hasDescendantNamed(n: BaseNode, pattern: string): boolean {
          if ('name' in n && nameMatches((n as SceneNode).name, pattern)) return true
          if ('children' in n) {
            for (const child of (n as ChildrenMixin).children) {
              if (hasDescendantNamed(child, pattern)) return true
            }
          }
          return false
        }

        // Check descendants (exclude the node itself)
        const hasMatch = (node as FrameNode).children
          .some(c => hasDescendantNamed(c, check.ifHasChildNamed))
        if (!hasMatch) continue // condition not met, skip

        const actual = (node as unknown as Record<string, unknown>)[check.property]
        if (actual !== check.expectedValue) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.property} = ${String(actual)}，應為 ${check.expectedValue}` })
        }

      } else if (check.type === 'strokeVariableName') {
        if (!('strokes' in node)) continue
        const strokes = (node as SceneNode & { strokes: readonly Paint[] }).strokes
        if (!Array.isArray(strokes) || strokes.length === 0) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `stroke 未綁定 ${check.variableName}` })
          continue
        }
        const firstStroke = strokes[0]
        const boundVarId = (firstStroke as SolidPaint & { boundVariables?: { color?: VariableAlias } })
          .boundVariables?.color?.id
        if (!boundVarId) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `stroke 未綁定 ${check.variableName}` })
        } else {
          try {
            const variable = await figma.variables.getVariableByIdAsync(boundVarId)
            if (variable && !varNameMatches(variable.name, check.variableName)) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `stroke 使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'requiredEffectStyleName') {
        const styleId = ('effectStyleId' in node) ? (node as FrameNode).effectStyleId : undefined
        if (!styleId) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `effect style 未綁定 ${check.styleName}` })
        } else {
          try {
            const style = figma.getStyleById(styleId as string)
            if (!style) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `effect style 未綁定 ${check.styleName}` })
            } else if (!varNameMatches(style.name, check.styleName)) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `effect style 使用了 ${style.name}，應使用 ${check.styleName}` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'requiredPropertyByDescendant') {
        if (!('children' in node)) continue

        function hasDescendant(n: BaseNode, pattern: string): boolean {
          if ('name' in n && nameMatches((n as SceneNode).name, pattern)) return true
          if ('children' in n) {
            for (const child of (n as ChildrenMixin).children) {
              if (hasDescendant(child, pattern)) return true
            }
          }
          return false
        }

        const found = (node as FrameNode).children.some(c => hasDescendant(c, check.ifHasDescendantNamed))
        const expectedValue = found ? check.thenExpectedValue : check.elseExpectedValue
        const actual = (node as unknown as Record<string, unknown>)[check.property]
        if (actual !== expectedValue) {
          issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `${check.property} = ${String(actual)}，應為 ${expectedValue}` })
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

      } else if (check.type === 'fillVariablePrefix') {
        // Collect solid fills from this node and all descendants (icon fills live on inner vectors)
        type BoundFill = { paint: SolidPaint & { boundVariables?: { color?: VariableAlias } } }
        const boundFills: BoundFill[] = []

        function collectFills(n: BaseNode): void {
          if ('fills' in n) {
            const f = (n as SceneNode & { fills: readonly Paint[] | typeof figma.mixed }).fills
            if (Array.isArray(f)) {
              for (const paint of f) {
                if (paint.type === 'SOLID') {
                  boundFills.push({ paint: paint as SolidPaint & { boundVariables?: { color?: VariableAlias } } })
                }
              }
            }
          }
          if ('children' in n) {
            for (const child of (n as ChildrenMixin).children) collectFills(child)
          }
        }

        collectFills(node)

        for (const { paint } of boundFills) {
          const boundVarId = paint.boundVariables?.color?.id
          if (!boundVarId) continue // unbound fills already caught by checkFillsAndStrokes

          try {
            const variable = await figma.variables.getVariableByIdAsync(boundVarId)
            if (variable && !variable.name.toLowerCase().startsWith(check.prefix.toLowerCase())) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `fill 使用了 ${variable.name}，應使用 ${check.prefix} 前綴的 token` })
            }
          } catch (_) { /* ignore */ }
        }

      } else if (check.type === 'fillVariableName') {
        // Same fill collection logic as fillVariablePrefix
        type BoundFill2 = { paint: SolidPaint & { boundVariables?: { color?: VariableAlias } } }
        const boundFills2: BoundFill2[] = []
        function collectFills2(n: BaseNode): void {
          if ('fills' in n) {
            const f = (n as SceneNode & { fills: readonly Paint[] | typeof figma.mixed }).fills
            if (Array.isArray(f)) {
              for (const paint of f) {
                if (paint.type === 'SOLID') boundFills2.push({ paint: paint as SolidPaint & { boundVariables?: { color?: VariableAlias } } })
              }
            }
          }
          if ('children' in n) {
            for (const child of (n as ChildrenMixin).children) collectFills2(child)
          }
        }
        collectFills2(node)

        for (const { paint } of boundFills2) {
          const boundVarId = paint.boundVariables?.color?.id
          if (!boundVarId) continue

          try {
            const variable = await figma.variables.getVariableByIdAsync(boundVarId)
            if (variable && !varNameMatches(variable.name, check.variableName)) {
              issues.push({ ...ruleBase, type: 'COMPONENT_RULE', currentValue: `fill 使用了 ${variable.name}，應使用 ${check.variableName}` })
            }
          } catch (_) { /* ignore */ }
        }
      }
    }
  }

  return issues
}
