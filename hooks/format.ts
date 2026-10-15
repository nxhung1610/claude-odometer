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
  return LABELS[kind] ?? clip(kind, 8)
}

/** Green under 70%, amber from 70%, red from 90%. */
export function toneOf(percent: number): Tone {
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'
  return 'success'
}

/** The background of the context's percentage badge, in the same three steps as its tone. */
export function pillColorOf(tone: Tone): string {
  if (tone === 'error') return 'red'
  if (tone === 'warning') return 'yellow'
  return 'green'
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
  return { filled: '█'.repeat(filled), empty: '─'.repeat(width - filled) }
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

/**
 * Which windows of the quota line keep their reset time. A window takes its label, bar, badge and, while shown, its
 * reset, with a gap between windows; the line may be `width` cells at most, so the last resets go first until it fits.
 */
export function resetsThatFit(windows: { label: string; badge: string; reset: string }[], width: number, barWidth: number, roomy: boolean): boolean[] {
  const shown = windows.map(window => window.reset !== '')
  const lineWidth = (): number =>
    windows.reduce((sum, window, index) => {
      const gap = index === 0 ? 0 : roomy ? 7 : 3
      const reset = shown[index] ? (roomy ? 4 : 3) + window.reset.length : 0
      return sum + gap + window.label.length + 1 + barWidth + window.badge.length + reset
    }, 0)
  for (let index = windows.length - 1; index >= 0 && lineWidth() > width; index--) shown[index] = false
  return shown
}

/** `364`, `92k`, `1.2M`: a token count in few enough characters to sit on the quota row. */
export function compactTokens(count: number): string {
  if (count >= 999_500) return `${(count / 1e6).toFixed(1)}M`
  if (count >= 1e3) return `${Math.round(count / 1e3)}k`
  return String(Math.round(count))
}

/** `$1.24`; a spend under a cent reads as `<$0.01`. */
export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/** Cuts text to `max` characters, ending with an ellipsis when it is cut. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
