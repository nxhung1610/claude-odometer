import type { ModelTokens, TokenRange, TokenScan } from '../types'

/** Rows the chart draws; each row is eight levels tall. */
export const CHART_ROWS = 8

const LEVELS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MODEL_ID = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/
const NONE: ModelTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export type ChartColor = 'claude' | 'success' | 'warning' | 'inactive'

/** One column of the chart: a day, or several days when the range is long. */
export type Column = {
  label: string
  total: number
  segments: Array<{ model: string; tokens: number }>
}

/** One cell of the chart: a level character in a color; an empty cell is a blank. */
export type Cell = { char: string; color: ChartColor }

/** `claude-haiku-5-5` reads as `Haiku 5.5`; an id it does not know reads as it is. */
export function modelName(id: string): string {
  const match = MODEL_ID.exec(id)
  if (!match) return id
  const [, family = '', major = '', minor = ''] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`
}

/** Opus, Sonnet and Haiku each have a color; any other model is drawn grey. */
export function colorOf(id: string): ChartColor {
  if (id.includes('opus')) return 'claude'
  if (id.includes('sonnet')) return 'success'
  if (id.includes('haiku')) return 'warning'
  return 'inactive'
}

/** `1.8B`, `230.5M`, `3.5k`, `364`. */
export function formatTokens(count: number): string {
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}k`
  return String(Math.round(count))
}

/** `99.3%`. */
export function formatShare(percent: number): string {
  return `${percent.toFixed(1)}%`
}

/** Every token a model used: input, output, and both cache counts. */
export function tokensOf(tokens: ModelTokens): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
}

/** `Oct 8`, from a `YYYY-MM-DD` day key. */
export function dayLabel(key: string): string {
  const [, month = '1', day = '1'] = key.split('-')
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)}`
}

/** The local day as a `YYYY-MM-DD` key. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function dayOf(key: string): Date {
  const [year = '1970', month = '1', day = '1'] = key.split('-')
  return new Date(Number(year), Number(month) - 1, Number(day))
}

/**
 * The days a range covers, oldest first, ending today. `all` starts at the
 * first day the scan has, so the chart spans every day with usage.
 */
export function daysInRange(range: TokenRange, today: Date, scan: TokenScan): string[] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (range !== 'all') {
    const length = range === 'week' ? 7 : 30
    return Array.from({ length }, (_, i) =>
      dayKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - (length - 1 - i))),
    )
  }
  const first = Object.keys(scan.days).sort()[0]
  const days: string[] = []
  const start = first ? dayOf(first) : end
  for (let day = start; day <= end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    days.push(dayKey(day))
  }
  return days.length > 0 ? days : [dayKey(end)]
}

/** Splits days into runs of equal length, at most `maxColumns` of them. */
export function columnsOf(days: string[], maxColumns: number): string[][] {
  const size = Math.max(1, Math.ceil(days.length / Math.max(1, maxColumns)))
  const groups: string[][] = []
  for (let i = 0; i < days.length; i += size) groups.push(days.slice(i, i + size))
  return groups
}

/** Each model's tokens over some days, summed. */
export function sumModels(scan: TokenScan, days: string[]): Record<string, ModelTokens> {
  const sums: Record<string, ModelTokens> = {}
  for (const day of days) {
    const models: Record<string, ModelTokens> = scan.days[day] ?? {}
    for (const [id, tokens] of Object.entries(models)) {
      const sum = (sums[id] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
      sum.input += tokens.input
      sum.output += tokens.output
      sum.cacheRead += tokens.cacheRead
      sum.cacheWrite += tokens.cacheWrite
    }
  }
  return sums
}

/** The models with their totals, most used first. */
export function rankEntries(totals: Record<string, ModelTokens>): Array<[string, ModelTokens]> {
  return Object.entries(totals).sort(([, a], [, b]) => tokensOf(b) - tokensOf(a))
}

/** One column per group of days, each with its models in the order given. */
export function columnsWithSegments(
  scan: TokenScan,
  days: string[],
  order: string[],
  maxColumns: number,
): Column[] {
  return columnsOf(days, maxColumns).map(group => {
    const sums = sumModels(scan, group)
    const segments = order.map(model => ({ model, tokens: tokensOf(sums[model] ?? NONE) }))
    const total = segments.reduce((sum, segment) => sum + segment.tokens, 0)
    return { label: group[0] ?? '', total, segments }
  })
}

/**
 * The chart as rows from the top down. Each column is as tall as its share of
 * the largest column, and at least one level when it has any tokens; its models
 * stack from the bottom in the order given, and a cell takes the color of the
 * model at its top.
 */
export function chartRows(columns: Column[], max: number, rows = CHART_ROWS): Cell[][] {
  const levels = rows * 8
  const heights = columns.map(column => {
    if (max <= 0 || column.total <= 0) return 0
    // Any usage shows at least one level, so a light day does not draw as a gap.
    return Math.max(1, Math.round((column.total / max) * levels))
  })
  const grid: Cell[][] = []
  for (let row = rows - 1; row >= 0; row--) {
    grid.push(
      columns.map((column, i) => {
        const height = heights[i] ?? 0
        const base = row * 8
        const fill = Math.min(8, Math.max(0, height - base))
        if (fill === 0) return { char: ' ', color: 'inactive' }

        const top = base + fill - 1
        let color: ChartColor = 'inactive'
        let cumulative = 0
        for (const segment of column.segments) {
          cumulative += segment.tokens
          color = colorOf(segment.model)
          if (top < Math.round((cumulative / column.total) * height)) break
        }
        return { char: LEVELS[fill] ?? '█', color }
      }),
    )
  }
  return grid
}

/** The top, middle and bottom labels of the vertical axis. */
export function axisLabels(max: number): [string, string, string] {
  return [formatTokens(max), formatTokens(max / 2), '0']
}
