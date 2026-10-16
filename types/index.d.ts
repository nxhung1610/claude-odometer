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

/**
 * What the transcript scan found: the projects folder it read, how many sessions had usage in each range, and each
 * model's tokens per local day (YYYY-MM-DD).
 */
export type TokenScan = {
  root: string
  sessions: Record<TokenRange, number>
  days: Record<string, Record<string, ModelTokens>>
  /** The tokens of each local day (YYYY-MM-DD) by local hour: 24 counts, from midnight. */
  hours: Record<string, number[]>
}

/** The `/tokens` pane's scan: waiting, running, then the result or why it failed. */
export type TokenScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  /** The scan's result, and when it finished, in milliseconds since the epoch. */
  | { status: 'ready'; scan: TokenScan; at: number }
  | { status: 'failed'; reason: string }

/** The span the `/tokens` pane charts. */
export type TokenRange = 'week' | 'month' | 'all'

/** A model step that has started and not yet stopped: when it started, and when its first output came (0 until it does). */
export type RunningStep = {
  startedAt: number
  firstOutputAt: number
}

/** How fast the model answers: the step running now, its latest time to first output, and its latest output speed. */
export type ModelSpeed = {
  /** The step running now; null between steps. */
  running: RunningStep | null
  /** Milliseconds from a step's start to its first output, for the latest step that had output. */
  ttftMs?: number
  /** Output tokens per second, for the latest step that measured one; kept until the next step does. */
  tps?: number
}

/**
 * The live context window: its size in tokens, and its fill once a response of the window has reported one.
 * The fill is absent in a fresh session, and after a compaction until the next response.
 */
export type ContextFill = {
  /** Input tokens the last response was answered over, once the window has reported them. */
  tokens?: number
  /** The context window's size, in tokens. */
  window: number
  /** The fill as a whole percentage, once a response of the window has reported one. */
  percent?: number
}

/** The session's model, as `/model` shows it, and the effort its latest main-conversation step was given, when its model has one. */
export type ModelInUse = {
  model: string
  effort?: string
}

/** One row of the context breakdown: its name as /context prints it, its estimated tokens, and what it is. */
export type ContextRow = {
  name: string
  tokens: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

declare module 'claude-code' {
  interface PluginState {
    'odometer': {
      windows: QuotaWindow[]
      tokens: TokenScanState
      range: TokenRange
      timing: ModelSpeed | null
      /** Frames drawn while a model step runs; the light on the word `working` moves with it. */
      sweep: number
      /** The live context window, shown at the end of the quota row. */
      context: ContextFill | null
      /** The session's model, as `/model` shows it, at the start of the speed row. */
      model: ModelInUse | null
      /** The session's cost in US dollars, shown at the end of the speed row. */
      cost: number | null
      /** The rows of the live context breakdown, which colour the bar and fill the tokens pane's legend. */
      contextRows: ContextRow[] | null
      /** When the rate-limit windows were last read, in milliseconds: the pace of a limit is taken from it. */
      windowsAt: number | null
    }
  }
}
