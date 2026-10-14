import type { ModelSpeed } from '../types'

/** The word the speed row shows while a step runs. */
export const WORKING = 'working'

/** How often the band redraws while a step runs: ten times a second. */
export const FRAME_MS = 100

/** `850ms` under a second, then `1.2s`. */
export function formatTtft(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** `42 tok/s`. */
export function formatTps(tps: number): string {
  return `${Math.round(tps)} tok/s`
}

/** `12s`: whole seconds since a step started. */
export function formatElapsed(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))}s`
}

/**
 * Output tokens per second over a model step: from its first output to its stop.
 * Absent when the step wrote no output, or the stretch is under half a second, too
 * short to read a rate from.
 */
export function tpsOf(outputTokens: number, firstOutputAt: number, stoppedAt: number): number | undefined {
  const seconds = (stoppedAt - firstOutputAt) / 1000
  if (outputTokens <= 0 || seconds < 0.5) return undefined
  return outputTokens / seconds
}

/**
 * The speed row's text. While a step runs it shows the time the step has taken, its
 * time to first output once that has come, and the last output speed. Between steps
 * it shows the latest time to first output and output speed.
 */
export function speedLine(
  running: { startedAt: number; firstOutputAt: number } | null,
  ttftMs: number | undefined,
  tps: number | undefined,
  nowMs: number,
): string {
  const tpsText = tps === undefined ? '—' : formatTps(tps)
  if (running) {
    const ttftText = running.firstOutputAt > 0 && ttftMs !== undefined ? formatTtft(ttftMs) : '…'
    return `${WORKING} ${formatElapsed(nowMs - running.startedAt)} · TTFT ${ttftText} · last TPS ${tpsText}`
  }
  const ttftText = ttftMs === undefined ? '—' : formatTtft(ttftMs)
  return `TTFT ${ttftText} · TPS ${tpsText}`
}

/**
 * Which letter of `WORKING` the light sits on at `nowMs`, or undefined while it is off
 * the word. The light crosses the word once per `periodMs`, entering just before the
 * first letter and leaving just after the last.
 */
export function sweepIndex(nowMs: number, periodMs = 1500): number | undefined {
  const step = ((nowMs % periodMs) * (WORKING.length + 2)) / periodMs
  const index = Math.floor(step) - 1
  return index >= 0 && index < WORKING.length ? index : undefined
}

/** What a model step's stream reports, in order: it starts, its first output comes, it stops, or the stream ends. */
export type StepEvent =
  | { kind: 'start'; at: number }
  | { kind: 'output'; at: number }
  | { kind: 'stop'; at: number; outputTokens: number }
  | { kind: 'end' }

/**
 * The speed state after one of a step's events. The time to first output is set at the
 * step's first output. Its output speed is set when it stops; a step with no output keeps
 * the speed the step before it measured. An output with no step running changes nothing.
 */
export function applyStep(speed: ModelSpeed | null, event: StepEvent): ModelSpeed {
  const prev: ModelSpeed = speed ?? { running: null }
  switch (event.kind) {
    case 'start':
      return { ...prev, running: { startedAt: event.at, firstOutputAt: 0 } }
    case 'output': {
      const running = prev.running
      if (!running || running.firstOutputAt > 0) return prev
      return { ...prev, running: { ...running, firstOutputAt: event.at }, ttftMs: event.at - running.startedAt }
    }
    case 'stop': {
      const running = prev.running
      const tps =
        running && running.firstOutputAt > 0 ? tpsOf(event.outputTokens, running.firstOutputAt, event.at) : undefined
      return { ...prev, running: null, tps: tps ?? prev.tps }
    }
    case 'end':
      return { ...prev, running: null }
  }
}
