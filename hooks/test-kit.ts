import type { CommandSpec, On, TurnStepInput } from 'claude-code'
import type { MockClock } from 'claude-code/testing'

export const NOW = new Date(2026, 9, 14, 12, 0)

export const TODAY = '2026-10-14'

export const TERMINAL = 'terminal' as const

export const WIDE = { columns: 140, rows: 40 }

export const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
}

export const PANE = {
  title: 'Tokens per day',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

export const QUOTA = { plugin: 'odometer', surface: TERMINAL, component: 'AbovePrompt' as const, props: BAND }

export const TOKENS_PANE = { plugin: 'odometer', surface: TERMINAL, component: 'Pane' as const, requestId: 'tokens', props: PANE, viewport: WIDE }

export const TOKENS = {
  command: 'tokens',
  args: '',
  origin: { kind: 'sdk' as const },
  presentation: { isFullscreen: true, columns: 140 },
}

export const SCAN = {
  root: '/home/me/.claude/projects',
  sessions: { week: 2, month: 2, all: 2 },
  days: { [TODAY]: { 'claude-opus-5-5': { input: 100, output: 50, cacheRead: 200, cacheWrite: 10 } } },
}

export type RateWindow = { kind: string; percentUsed: number; resetsAt?: string }

export type ContextReading = {
  window: number
  percent?: number
  tokens?: number
  breakdown?: { categories: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[] }
}

/**
 * What the engine answers beneath the mod, which a test gives itself: a session
 * with these rate-limit windows, and the commands and panes the mod registers
 * and opens. Each command the mod registers is pushed onto `commands`.
 */
export function engine(on: On, rateLimits: RateWindow[] = [], commands: CommandSpec[] = [], context: ContextReading = { window: 200_000 }, spend?: number) {
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.usage', () => ({ value: { startedAt: NOW.getTime(), context: context as never, rateLimits, cost: spend === undefined ? undefined : { usd: spend } } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('command.register', (_, e) => {
    commands.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

/** What `$.process.run` answers once the child has exited. */
export function ran(exitCode: number, stdout = '', stderr = '') {
  return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
}

/**
 * A machine with Python 3 as `python3`: its version probe passes, and the
 * scanner's run answers what `scan` returns. `runs` keeps each call's argv.
 */
export function withPython(on: On, scan: () => ReturnType<typeof ran>, runs: string[][] = []) {
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: e.argv.includes('--version') ? ran(0, 'Python 3.13.0') : scan() }
  })
}

/** The scanner's own runs out of `runs`, the version probes left out. */
export function scans(runs: string[][]) {
  return runs.filter(argv => argv.includes('-I'))
}

export const MAIN: TurnStepInput = { turnId: 'turn-1', index: 0, model: 'claude-haiku-5-5', messageCount: 1 }

export const SUB: TurnStepInput = { ...MAIN, agentId: 'sub-1' }

/** One model step's timing in ms: its first text comes `firstAfter` after the step is asked for, its stop `stopAfter` after the next ask. */
export type StepTiming = { firstAfter: number; stopAfter: number; outputTokens: number }

/**
 * The model beneath the mod for `turn.step`. Each step waits as `timing` says for its agent (none on the main
 * conversation), writes one text chunk, then stops with the output tokens it was given.
 */
export function model(on: On, clock: MockClock, timing: (agentId: string | undefined) => StepTiming) {
  on('turn.step', async function* (_, e) {
    const { firstAfter, stopAfter, outputTokens } = timing(e.agentId)
    await clock.sleep(firstAfter)
    yield { kind: 'text', index: 0, text: 'hi' }
    await clock.sleep(stopAfter)
    yield {
      kind: 'stop',
      stopReason: 'end_turn',
      usage: {
        model: MAIN.model,
        input_tokens: 10,
        output_tokens: outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }
  })
}

/** Stops a step's stream before it ends, as a consumer that stops reading does, so the mod's cleanup runs. */
export function stopStep(step: AsyncGenerator<unknown, unknown>) {
  return step.return(undefined)
}

export const OPUS: TurnStepInput = { ...MAIN, model: 'claude-opus-5-5', effort: 'high' }

export const CONTEXT_IN_USE: ContextReading = {
  window: 200_000,
  percent: 40,
  tokens: 80_000,
  breakdown: {
    categories: [
      { name: 'System prompt', tokens: 10_000, kind: 'used' },
      { name: 'Messages', tokens: 70_000, kind: 'used' },
      { name: 'Free space', tokens: 120_000, kind: 'free' },
    ],
  },
}

/** Every element of a drawing that `match` accepts, in document order. */
export function drawnWhere(node: any, match: (element: any) => boolean, found: any[] = []): any[] {
  if (!node || typeof node !== 'object') return found
  if (match(node)) found.push(node)
  for (const child of node.children ?? []) drawnWhere(child, match, found)
  return found
}

/** The solid bars of a drawing, in order: each Box one row high with a colour, as its colour and width in cells. */
export function barRuns(root: any): { color: string; cells: number }[] {
  return drawnWhere(root, el => el.type === 'Box' && el.props?.height === 1 && el.props?.backgroundColor !== undefined).map(el => ({
    color: el.props.backgroundColor,
    cells: el.props.width,
  }))
}

/** Collects the lines the mod raises with $.ui.toast. */
export function collectToasts(on: On): string[] {
  const lines: string[] = []
  on('ui.toast', (_, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  return lines
}
