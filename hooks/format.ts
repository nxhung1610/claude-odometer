export const BAR_WIDTH = 10

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type Tone = 'success' | 'warning' | 'error'

/** Short label for a window kind, e.g. `five_hour` to `5h`. */
export function labelOf(kind: string): string {
  return LABELS[kind] ?? kind
}

/** Green under 70%, amber from 70%, red from 90%. */
export function toneOf(percent: number): Tone {
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'
  return 'success'
}

/** How many of the bar's cells are filled for a percentage. */
export function filledCells(percent: number, width = BAR_WIDTH): number {
  const clamped = Math.min(100, Math.max(0, percent))
  const cells = Math.round((clamped / 100) * width)

  // Any usage shows at least one cell, so 1% does not draw as an empty bar.
  return clamped > 0 ? Math.max(1, cells) : 0
}

/** The filled and empty runs of the bar, ready to draw in two colors. */
export function barCells(percent: number, width = BAR_WIDTH) {
  const filled = filledCells(percent, width)
  return { filled: '▓'.repeat(filled), empty: '░'.repeat(width - filled) }
}

/** `14:20` when the reset is today, `Mon 14:00` otherwise. Empty when unknown. */
export function resetLabel(resetsAt: string | undefined, now: Date): string {
  if (!resetsAt) return ''
  const at = new Date(resetsAt)
  if (Number.isNaN(at.getTime())) return ''

  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const isToday = at.toDateString() === now.toDateString()
  return isToday ? time : `${DAYS[at.getDay()]} ${time}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
