export interface GuideRouteConstraints {
  version: 1
  order: 'ai' | 'catalog'
  orderExplicit: boolean
  excludedFolders: string[]
  includedFolders: string[] | null
  includeRemaining: boolean
  weeklyMinutes: { min: number; max: number | null } | null
}
