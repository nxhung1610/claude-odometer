import type { ContextRow } from '../types'

/** The groups the context bar is split into, each with its colour and the label the tokens pane gives it. */
export const CONTEXT_GROUPS = [
  { key: 'system', label: 'System', color: '#3987e5' },
  { key: 'tools', label: 'Tools', color: '#8e6fd8' },
  { key: 'memory', label: 'Memory', color: '#2aa198' },
  { key: 'messages', label: 'Messages', color: '#d56aa0' },
  { key: 'other', label: 'Other', color: '#898781' },
] as const

export type ContextGroup = (typeof CONTEXT_GROUPS)[number]['key']

/** The group of a used row, by its name as /context prints it. */
export function groupOf(name: string): ContextGroup {
  if (/system prompt/i.test(name)) return 'system'
  if (/tool/i.test(name)) return 'tools'
  if (/memory|skill|command/i.test(name)) return 'memory'
  if (/message/i.test(name)) return 'messages'
  return 'other'
}

/** The tokens of the used rows, summed by group. Free, buffer and deferred rows are left out. */
function usedByGroup(rows: ContextRow[]): Map<ContextGroup, number> {
  const totals = new Map<ContextGroup, number>()
  for (const row of rows) {
    if (row.kind !== 'used') continue
    const key = groupOf(row.name)
    totals.set(key, (totals.get(key) ?? 0) + row.tokens)
  }
  return totals
}

/**
 * Shares `cells` among the weights in proportion to them, so the parts add up to `cells`. Ties go to the
 * earlier weight, and a weight of zero gets no cell.
 */
export function allocateCells(cells: number, weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (cells <= 0 || total <= 0) return weights.map(() => 0)
  const exact = weights.map(weight => (weight / total) * cells)
  const parts = exact.map(value => Math.floor(value))
  let left = cells - parts.reduce((sum, part) => sum + part, 0)
  const byRest = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of byRest) {
    if (left <= 0) break
    if ((weights[index] ?? 0) > 0) {
      parts[index] = (parts[index] ?? 0) + 1
      left -= 1
    }
  }
  return parts
}

/** The filled cells of the bar, as runs of one colour each, from the used rows of the breakdown. */
export function contextSegments(rows: ContextRow[], cells: number): { color: string; cells: number }[] {
  const totals = usedByGroup(rows)
  const present = CONTEXT_GROUPS.filter(group => (totals.get(group.key) ?? 0) > 0)
  const counts = allocateCells(cells, present.map(group => totals.get(group.key) ?? 0))
  return present.map((group, index) => ({ color: group.color, cells: counts[index] ?? 0 }))
}

/** What the tokens pane lists under the context: each group in use, then the free space. */
export function contextLegend(rows: ContextRow[]): { label: string; color: string; tokens: number }[] {
  const totals = usedByGroup(rows)
  const free = rows.filter(row => row.kind === 'free').reduce((sum, row) => sum + row.tokens, 0)
  const groups = CONTEXT_GROUPS.filter(group => (totals.get(group.key) ?? 0) > 0).map(group => ({
    label: group.label,
    color: group.color,
    tokens: totals.get(group.key) ?? 0,
  }))
  return [...groups, { label: 'Free', color: 'inactive', tokens: free }]
}
