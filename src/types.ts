export type IssueType =
  | 'HARDCODED_COLOR'
  | 'HARDCODED_SPACING'
  | 'WRONG_TOKEN'
  | 'DEPRECATED_TOKEN'
  | 'MISSING_TEXT_STYLE'
  | 'COMPONENT_RULE'

export const ISSUE_LABELS: Record<IssueType, string> = {
  HARDCODED_COLOR: '顏色未使用 Token',
  HARDCODED_SPACING: '間距未使用 Token',
  WRONG_TOKEN: '使用了錯誤的 Token',
  DEPRECATED_TOKEN: '使用了廢棄的 Token',
  MISSING_TEXT_STYLE: '未套用文字樣式',
  COMPONENT_RULE: '元件使用規則違規',
}

export interface Issue {
  nodeId: string
  nodeName: string
  breadcrumb: string[]
  type: IssueType
  property: string
  currentValue: string
  // COMPONENT_RULE only
  ruleName?: string
  ruleDescription?: string
}

export interface ComponentRule {
  id: string
  name: string
  description: string
  targetComponentName: string
  excludeComponentName?: string
  nodeTypeFilter?: string
  exemptHardcodedSpacing?: number[]
  checks: RuleCheck[]
}

export type RuleCheck =
  | { type: 'mustHaveParentFrame' }
  | { type: 'parentPadding'; side: 'top' | 'right' | 'bottom' | 'left'; variableName: string }
  | { type: 'parentItemSpacing'; variableName: string }
  | { type: 'mustHaveParentNamed'; parentName: string }
  | { type: 'skipIfParentNamed'; parentName: string }
  | { type: 'ownPadding'; side: 'top' | 'right' | 'bottom' | 'left'; variableName: string }
  | { type: 'ownPaddingByContext'; side: 'top' | 'right' | 'bottom' | 'left'; ifParentSiblingNamed: string; thenExpectedPx: number; elseVariableName: string }
  | { type: 'ownPaddingByAncestor'; side: 'top' | 'right' | 'bottom' | 'left'; ifHasAncestorNamed: string; thenVariableName: string; elseVariableName: string }
  | { type: 'ownItemSpacingByChildType'; ifHasChildNamed: string; thenVariableName: string; elseVariableName: string }
  | { type: 'requiredProperty'; property: string; expectedValue: string | number }
  | { type: 'forbiddenProperty'; property: string }
  | { type: 'fillVariablePrefix'; prefix: string }
  | { type: 'requiredPropertyIfHasChild'; ifHasChildNamed: string; property: string; expectedValue: string | number }

export interface DesignSystemCache {
  version: number
  lastUpdated: string
  rulesJsonUrl: string
  approvedCollectionKeys: string[]
  approvedCollectionNames: string[]
  deprecatedCollectionKeys: string[]
  allowedSpacingValues: number[]
  componentRules: ComponentRule[]
}

export interface CacheInfo {
  lastUpdated: string
  rulesJsonUrl: string
  approvedCollectionNames: string[]
  deprecatedCollectionNames: string[]
  allowedSpacingValues: number[]
  componentRuleCount: number
}

// Plugin → UI
export type UIMessage =
  | { type: 'LOADING'; message: string }
  | { type: 'CACHE_INFO'; info: CacheInfo }
  | { type: 'SCAN_RESULT'; issues: Issue[]; nodeCount: number }
  | { type: 'ERROR'; message: string }
  | { type: 'SELECTION_CHANGED'; hasSelection: boolean }
  // Plugin delegates network fetch to UI (which has full browser network access)
  | { type: 'FETCH_RULES_JSON'; url: string }

// UI → Plugin
export type PluginMessage =
  | { type: 'SCAN' }
  | { type: 'GET_CACHE' }
  | { type: 'REFRESH_CACHE'; rulesJsonUrl?: string }
  | { type: 'SELECT_NODE'; nodeId: string }
  | { type: 'SAVE_RULES_URL'; url: string }
  // UI returns fetch result back to plugin
  | { type: 'RULES_JSON_RESULT'; data: unknown; error?: string }
  | { type: 'RESIZE'; width: number; height: number }
