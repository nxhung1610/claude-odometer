import type { ContextRow } from '../types'

import { compactTokens } from './format'

/** The groups the context bar is split into, each with its colour and the label the tokens pane gives it. */
export const CONTEXT_GROUPS = [
  { key: 'system', label: 'System', color: '#3987e5' },
  { key: 'tools', label: 'Tools', color: '#8e6fd8' },
  { key: 'memory', label: 'Memory', color: '#2aa198' },
  { key: 'messages', label: 'Messages', color: '#d56aa0' },
  { key: 'other', label: 'Other', color: '#898781' },
] as const

export type ContextGroup = (typeof CONTEXT_GROUPS)[number]['key']

/** The buffer auto-compaction keeps back and the free space: the parts of the window that no group holds. */
const BUFFER = { label: 'Buffer', glyph: '░', color: 'inactive' }
const FREE = { label: 'Free', glyph: '─', color: 'subtle' }
/** The glyph of a group in use. */
const USED_GLYPH = '█'
/** The gap between two items of a legend line. */
export const LEGEND_SPLIT = '   '

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

/** The tokens of the rows of one kind, summed. */
function sumKind(rows: ContextRow[], kind: ContextRow['kind']): number {
  return rows.filter(row => row.kind === kind).reduce((sum, row) => sum + row.tokens, 0)
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

/** One part of the bar: `cells` copies of `glyph`, in `color`. */
export type BarRun = { color: string; glyph: string; cells: number }

/**
 * The window as one bar of `width` cells, from left to right: each group in use in its colour, then the buffer,
 * then the free space. A group in use gets at least one cell, taken from the largest part when rounding leaves none.
 */
export function contextBar(rows: ContextRow[], width: number): BarRun[] {
  const totals = usedByGroup(rows)
  const parts = [
    ...CONTEXT_GROUPS.map(group => ({ label: group.label, color: group.color, glyph: USED_GLYPH, tokens: totals.get(group.key) ?? 0, used: true })),
    { ...BUFFER, tokens: sumKind(rows, 'buffer'), used: false },
    { ...FREE, tokens: sumKind(rows, 'free'), used: false },
  ].filter(part => part.tokens > 0)
  const cells = allocateCells(width, parts.map(part => part.tokens))
  parts.forEach((part, index) => {
    if (!part.used || (cells[index] ?? 0) > 0) return
    const donor = cells.indexOf(Math.max(...cells))
    if ((cells[donor] ?? 0) > 1) {
      cells[donor] = (cells[donor] ?? 0) - 1
      cells[index] = 1
    }
  })
  return parts
    .map((part, index) => ({ color: part.color, glyph: part.glyph, cells: cells[index] ?? 0 }))
    .filter(run => run.cells > 0)
}

/** One item of the legend: a group, the buffer, or the free space, with its glyph, its colour and its tokens. */
export type LegendItem = { label: string; glyph: string; color: string; tokens: number }

/** What the legend lists: each group in use, the buffer when it holds tokens, then the free space. */
export function contextLegend(rows: ContextRow[]): LegendItem[] {
  const totals = usedByGroup(rows)
  const groups = CONTEXT_GROUPS.filter(group => (totals.get(group.key) ?? 0) > 0).map(group => ({
    label: group.label,
    glyph: '■',
    color: group.color,
    tokens: totals.get(group.key) ?? 0,
  }))
  const buffer = sumKind(rows, 'buffer')
  return [
    ...groups,
    ...(buffer > 0 ? [{ ...BUFFER, tokens: buffer }] : []),
    { ...FREE, tokens: sumKind(rows, 'free') },
  ]
}

/** A share of the window as a whole percent, or `<1%` for tokens that are under one percent of it. */
export function shareOf(tokens: number, window: number): string {
  const percent = window > 0 ? (tokens / window) * 100 : 0
  if (percent > 0 && percent < 1) return '<1%'
  return `${Math.round(percent)}%`
}

/** One legend item as the legend writes it, e.g. `■ System 10k 5%`: the width `packLegend` fits it into a line. */
export function legendText(item: LegendItem, window: number): string {
  return `${item.glyph} ${item.label} ${compactTokens(item.tokens)} ${shareOf(item.tokens, window)}`
}

/** The legend packed into lines no wider than `width`: an item that would overflow starts the next line. */
export function packLegend(items: LegendItem[], window: number, width: number): LegendItem[][] {
  const lines: LegendItem[][] = []
  let used = 0
  for (const item of items) {
    const size = legendText(item, window).length
    const last = lines[lines.length - 1]
    if (last !== undefined && used + LEGEND_SPLIT.length + size <= width) {
      last.push(item)
      used += LEGEND_SPLIT.length + size
    } else {
      lines.push([item])
      used = size
    }
  }
  return lines
}
