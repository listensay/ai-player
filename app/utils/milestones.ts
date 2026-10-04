export const MILESTONE_CATEGORIES = [
  { id: 'streak', name: '连续打卡', icon: 'flame', unit: '天' },
  { id: 'courses', name: '课程通关', icon: 'graduation', unit: '门' },
  { id: 'hours', name: '学习投入', icon: 'clock', unit: '小时' },
  { id: 'notes', name: '笔记积累', icon: 'note', unit: '字' },
  { id: 'practice', name: '练习达标', icon: 'check', unit: '题' },
  { id: 'focus', name: '专注时刻', icon: 'sparkles', unit: '次' },
] as const
export type MilestoneCategory = (typeof MILESTONE_CATEGORIES)[number]['id']
export type MilestoneMetrics = Record<MilestoneCategory, number>
const TIERS: Record<MilestoneCategory, readonly [number, string][]> = {
  streak: [
    [1, '今日启程'],
    [3, '三日热忱'],
    [7, '一周不辍'],
    [14, '双周坚守'],
    [21, '习惯成形'],
  ],
  courses: [
    [1, '首课通关'],
    [2, '再下一城'],
    [3, '知识三连'],
    [5, '五课成章'],
    [10, '十课里程碑'],
  ],
  hours: [
    [1, '一小时之光'],
    [5, '渐入佳境'],
    [10, '十小时积淀'],
    [25, '深耕不息'],
    [50, '五十小时远行'],
  ],
  notes: [
    [100, '灵感落笔'],
    [1000, '千字札记'],
    [5000, '思考成册'],
    [10000, '万字沉淀'],
    [30000, '知识手稿'],
  ],
  practice: [
    [1, '初试身手'],
    [10, '十题小成'],
    [30, '熟能生巧'],
    [50, '解题能手'],
    [100, '百题斩'],
  ],
  focus: [
    [1, '专注初体验'],
    [5, '心流入门'],
    [15, '专注进阶'],
    [30, '心流常客'],
    [60, '专注大师'],
  ],
}
export interface Milestone {
  id: string
  name: string
  category: MilestoneCategory
  description: string
  unit: string
  value: number
  target: number
  tier: number
  unlocked: boolean
}
export function buildMilestones(metrics: MilestoneMetrics): Milestone[] {
  return MILESTONE_CATEGORIES.flatMap((category) =>
    TIERS[category.id].map(([target, name], index) => ({
      id: category.id + '-' + target,
      name,
      category: category.id,
      unit: category.unit,
      target,
      tier: index + 1,
      description:
        category.id === 'streak'
          ? '连续打卡 ' + target + ' 天'
          : category.id === 'courses'
            ? '学完 ' + target + ' 门课程'
            : category.id === 'hours'
              ? '学习投入 ' + target + ' 小时'
              : category.id === 'notes'
                ? '笔记累计达到 ' + target + ' 字'
                : category.id === 'practice'
                  ? '完成 ' + target + ' 道练习'
                  : '完成 ' + target + ' 次专注计时',
      value: Math.max(0, Number.isFinite(metrics[category.id]) ? metrics[category.id] : 0),
      unlocked: metrics[category.id] >= target,
    })),
  )
}
export interface MilestoneLedger {
  version: 1
  unlocked: Record<string, number>
}
export function restoreMilestoneLedger(raw: unknown): MilestoneLedger | null {
  if (raw === null || raw === undefined) return null
  if (
    typeof raw !== 'object' ||
    !('version' in raw) ||
    raw.version !== 1 ||
    !('unlocked' in raw) ||
    !raw.unlocked ||
    typeof raw.unlocked !== 'object' ||
    Array.isArray(raw.unlocked) ||
    Object.values(raw.unlocked).some((at) => !Number.isSafeInteger(at) || Number(at) < 0)
  )
    throw Error('勋章记录格式异常，请重试。')
  return { version: 1, unlocked: { ...raw.unlocked } as Record<string, number> }
}
