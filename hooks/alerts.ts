import type { QuotaWindow } from '../types'

import { labelOf, resetLabel } from './format'

/** A limit or the context that passes this percentage raises a toast, once per crossing. */
export const ALERT_AT = 90

/** Whether a reading passed the alert line since the one before it. */
export function passed(previous: number | undefined, percent: number): boolean {
  return previous !== undefined && previous < ALERT_AT && percent >= ALERT_AT
}

/** Minutes until 100%, at the pace between two readings; undefined when the limit is not filling. */
export function minutesToFull(
  previous: { percent: number; at: number },
  now: { percent: number; at: number },
): number | undefined {
  const minutes = (now.at - previous.at) / 60_000
  const rise = now.percent - previous.percent
  if (minutes <= 0 || rise <= 0) return undefined
  return (100 - now.percent) / (rise / minutes)
}

/** `about 2 min`, or `about 1h 30m` for a longer span. */
export function spanText(minutes: number): string {
  const whole = Math.max(1, Math.round(minutes))
  return whole < 60 ? `about ${whole} min` : `about ${Math.floor(whole / 60)}h ${whole % 60}m`
}

/** The toast for a limit that passed the alert line: its share, the time left at its pace, and its reset. */
export function limitAlert(window: QuotaWindow, minutes: number | undefined, now: Date): string {
  const pace = minutes === undefined ? '' : `, ${spanText(minutes)} to 100% at this pace`
  const reset = resetLabel(window.resetsAt, now)
  return `${labelOf(window.kind)} at ${Math.round(window.percentUsed)}%${pace}${reset ? `, resets ${reset}` : ''}`
}

/** The toast for the context that passed the alert line. */
export function contextAlert(percent: number): string {
  return `Context at ${Math.round(percent)}%: consider /compact soon`
}
