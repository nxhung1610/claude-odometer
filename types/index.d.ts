/** One rate-limit window as the engine reports it: `five_hour`, `seven_day`, or `spend_limit`. */
export type QuotaWindow = {
  kind: string
  /** How much of the window is used, 0 to 100 (past 100 on an exceeded spend limit). */
  percentUsed: number
  /** When the window resets, as an ISO 8601 timestamp. */
  resetsAt?: string
}

/** Tokens one model used: input, output, and the cache reads and writes, each response counted once. */
export type ModelTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** What the transcript scan found: the sessions read, and per local day (YYYY-MM-DD) each model's tokens. */
export type TokenScan = {
  sessions: number
  days: Record<string, Record<string, ModelTokens>>
}

/** The `/tokens` pane's scan: waiting, running, then the result or why it failed. */
export type TokenScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'ready'; scan: TokenScan }
  | { status: 'failed'; reason: string }

/** The span the `/tokens` pane charts. */
export type TokenRange = 'week' | 'month' | 'all'

/** How fast the last turn ran: the wait before its first output, and the output speed after it. */
export type TurnTiming = {
  /** Milliseconds from the turn's start to its first output: a chunk of text, thinking, or a tool call. */
  ttftMs: number
  /** Output tokens per second from the first output to the turn's end; absent when the turn wrote no output. */
  tps?: number
}

declare module 'claude-code' {
  interface PluginState {
    'odometer': {
      windows: QuotaWindow[]
      tokens: TokenScanState
      range: TokenRange
      timing: TurnTiming | null
    }
  }
}
