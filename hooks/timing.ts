/** `850ms` under a second, then `1.2s`. */
export function formatTtft(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** `42 tok/s`. */
export function formatTps(tps: number): string {
  return `${Math.round(tps)} tok/s`
}

/**
 * Output tokens per second over the stretch from a turn's first output to its end.
 * Absent when the turn wrote no output, or no time passed between the two.
 */
export function tpsOf(outputTokens: number, firstOutputAt: number, endedAt: number): number | undefined {
  const seconds = (endedAt - firstOutputAt) / 1000
  if (outputTokens <= 0 || seconds <= 0) return undefined
  return outputTokens / seconds
}
