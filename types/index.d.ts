/** One rate-limit window as the engine reports it: `five_hour`, `seven_day`, or `spend_limit`. */
export type QuotaWindow = {
  kind: string
  /** How much of the window is used, 0 to 100 (past 100 on an exceeded spend limit). */
  percentUsed: number
  /** When the window resets, as an ISO 8601 timestamp. */
  resetsAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    'account-quota': { windows: QuotaWindow[] }
  }
}
