import type { EngineInterface, Register, Timer } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { ContextFill, ContextRow, ModelInUse, ModelSpeed, ModelTokens, QuotaWindow, TokenRange, TokenScan, TokenScanState } from '../types'

import { contextAlert, limitAlert, minutesToFull, passed } from './alerts'
import { desktopBand } from './band'
import { desktopPane } from './pane'
import { terminalBand } from './terminal-band'
import { terminalPane } from './terminal-pane'
import { FRAME_MS, applyStep, speedLine, sweepIndex } from './timing'
import { columnsWithSegments, daysInRange, hourGrid, rankEntries, sumModels, tokensOf } from './tokens'

const windows = atom(
  { plugin: 'odometer', key: 'windows' } as const,
  [] as QuotaWindow[],
)

const context = atom(
  { plugin: 'odometer', key: 'context' } as const,
  null as ContextFill | null,
)

const model = atom(
  { plugin: 'odometer', key: 'model' } as const,
  null as ModelInUse | null,
)

const cost = atom(
  { plugin: 'odometer', key: 'cost' } as const,
  null as number | null,
)

const contextRows = atom(
  { plugin: 'odometer', key: 'contextRows' } as const,
  null as ContextRow[] | null,
)

const windowsAt = atom(
  { plugin: 'odometer', key: 'windowsAt' } as const,
  null as number | null,
)

const tokens = atom(
  { plugin: 'odometer', key: 'tokens' } as const,
  { status: 'idle' } as TokenScanState,
)

const range = atom(
  { plugin: 'odometer', key: 'range' } as const,
  'week' as TokenRange,
)

const timing = atom(
  { plugin: 'odometer', key: 'timing' } as const,
  null as ModelSpeed | null,
)

// Counts the frames drawn while a step runs. The light's place on the word comes from it,
// and the band reads it, so each frame redraws the band alone.
const sweep = atom(
  { plugin: 'odometer', key: 'sweep' } as const,
  0,
)

const PANE = 'tokens'

/** The chunks that mean the model has begun to answer; the stop and the engine's own do not. */
const OUTPUT = new Set<string>(['text', 'thinking', 'tool', 'input'])

/** How often the session's model is read again, so `/model` shows in the speed row without waiting for a step. */
const MODEL_POLL_MS = 1000

const RANGES: ReadonlyArray<{ key: TokenRange; label: string }> = [
  { key: 'all', label: 'All time' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' },
]

// `python3` is the name on macOS and Linux, and Windows usually has only `python`.
// A candidate passes when it answers `--version` as Python 3: a missing command,
// a Windows stub that exits non-zero, or an older Python 2 fails the probe.
async function pythonFor(
  run: (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
): Promise<string | undefined> {
  for (const name of ['python3', 'python']) {
    const probe = await run([name, '--version']).catch(() => undefined)
    if (probe?.exitCode === 0 && /Python 3\./.test(`${probe.stdout}${probe.stderr}`)) return name
  }
  return undefined
}

/** The rows of a context breakdown, as the state keeps them. */
function rowsOf(breakdown: { categories: ContextRow[] } | undefined): ContextRow[] | null {
  return breakdown ? breakdown.categories.map(({ name, tokens, kind }) => ({ name, tokens, kind })) : null
}

/**
 * Scans the transcripts with the scanner the mod ships, and keeps the result, and when it finished, in the tokens state.
 * The scanner keeps a cache in the plugin's own folder, so a later scan reads only the transcripts that have changed.
 */
async function scanTranscripts($: EngineInterface): Promise<void> {
  await update($, tokens, () => ({ status: 'scanning' as const }))
  try {
    const python = await pythonFor(argv => $.process.run(argv, { timeoutMs: 10_000 }))
    if (!python) throw new Error('Python 3 was not found on the PATH, as python3 or python')
    const ran = await $.process.run(
      [python, '-I', `${$.plugin.root}/hooks/scan_usage.py`, '--cache', `${$.plugin.root}/.cache/usage.json`],
      { timeoutMs: 120_000 },
    )
    // The reply is cut at 4 MiB; a cut reply is not valid JSON, so say why instead.
    if (ran.isStdoutTruncated) throw new Error('The scan printed more than 4 MiB, too much to read')
    if (ran.exitCode === 0) {
      const scan = JSON.parse(ran.stdout) as TokenScan
      const at = await $.clock.now()
      await update($, tokens, () => ({ status: 'ready' as const, scan, at }))
    } else {
      const reason = ran.stderr.trim().split('\n')[0] || 'the scanner exited with an error'
      await update($, tokens, () => ({ status: 'failed' as const, reason }))
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await update($, tokens, () => ({ status: 'failed' as const, reason }))
  }
}

export const register: Register = on => {
  // The timer that follows the session's model, cancelled when a new session starts or the session ends.
  let followTimer: Timer | undefined

  on('session.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const reading = await $.session.usage({ breakdown: 'summary' })
    await Promise.all([
      update($, windows, () => reading.rateLimits),
      update($, windowsAt, () => startedAt),
      update($, context, () => reading.context),
      update($, contextRows, () => rowsOf(reading.context.breakdown)),
      update($, cost, () => reading.cost?.usd ?? null),
      // A new session starts with no speed to show, not the last session's, and with the model it opens on.
      update($, model, () => null),
      update($, timing, () => null),
    ])
    // The model follows `/model`. The engine pushes no event for it, so the session's model is read on a timer, and
    // the band redraws only when it has changed. The effort belonged to the old model, so it goes with it: the new
    // model's next step reports its own.
    let followed: string | undefined
    const follow = async () => {
      const current = await $.session.model().catch(() => undefined)
      if (!current || current === followed) return
      followed = current
      await update($, model, () => ({ model: current }))
    }
    await follow()
    followTimer?.cancel()
    followTimer = $.clock.every(MODEL_POLL_MS, () => follow().catch(() => undefined))
    // Runs at once when typed mid-turn: it reads the transcripts on disk, not the turn's state.
    await $.command.register({
      name: 'tokens',
      description: 'Show tokens per day, by model, in a pane',
      immediate: true,
    })

    return next(e)
  })

  // The model's timer stops with the session, so a session that has ended reads nothing more.
  on('session.end', async (_, e, next) => {
    followTimer?.cancel()
    followTimer = undefined
    return next(e)
  })

  // Pushed by the engine when a window moves a whole point or the context fill moves, so the
  // line refreshes without polling.
  on('session.measure', async ($, e, next) => {
    const before = await read($, windows)
    const beforeAt = await read($, windowsAt)
    const fillBefore = await read($, context)
    const at = await $.clock.now()
    await update($, windows, () => e.rateLimits)
    await update($, windowsAt, () => at)
    await update($, context, () => e.context)
    await update($, cost, () => e.cost?.usd ?? null)
    // The measure never carries the breakdown, so a change of the fill asks for it.
    if (e.changed.includes('context')) {
      const reading = await $.session.usage({ breakdown: 'summary' })
      await update($, contextRows, () => rowsOf(reading.context.breakdown))
    }
    // A limit or the context that has just passed the alert line raises one toast. A limit's toast says how long
    // it has left at the pace it has been filling.
    for (const window of e.rateLimits) {
      const previous = before.find(w => w.kind === window.kind)
      if (previous && passed(previous.percentUsed, window.percentUsed)) {
        const minutes =
          beforeAt === null
            ? undefined
            : minutesToFull({ percent: previous.percentUsed, at: beforeAt }, { percent: window.percentUsed, at })
        $.ui.toast(limitAlert(window, minutes, new Date(at)), { timeoutMs: 8000 })
      }
    }
    if (e.context.percent !== undefined && passed(fillBefore?.percent, e.context.percent)) {
      $.ui.toast(contextAlert(e.context.percent), { timeoutMs: 8000 })
    }

    return next(e)
  })

  // Times each model step of the main conversation. A step starts when its stream does; its
  // time to first output is the wait for its first chunk of text, thinking, a tool call or its
  // input; and its stop carries the output tokens. The steps pass on unchanged. A sub-agent's
  // steps pass on untimed: sub-agents can run alongside the main conversation and each other,
  // and the row has one timing slot, so their steps would overwrite each other's readings.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)

    const startedAt = await $.clock.now()
    await update($, timing, speed => applyStep(speed, { kind: 'start', at: startedAt }))
    await update($, model, () => ({ model: e.model, effort: e.effort === undefined ? undefined : String(e.effort) }))
    // Each frame, the band redraws: the elapsed seconds count up and the light moves on.
    const tick = $.clock.every(FRAME_MS, () => {
      update($, sweep, frames => (frames ?? 0) + 1).catch(() => undefined)
    })

    let answered = false
    try {
      for await (const chunk of next(e)) {
        if (!answered && OUTPUT.has(chunk.kind)) {
          answered = true
          const at = await $.clock.now()
          await update($, timing, speed => applyStep(speed, { kind: 'output', at }))
        }
        if (chunk.kind === 'stop') {
          const at = await $.clock.now()
          const outputTokens = chunk.usage?.output_tokens ?? 0
          await update($, timing, speed => applyStep(speed, { kind: 'stop', at, outputTokens }))
        }
        yield chunk
      }
    } finally {
      tick.cancel()
      await update($, timing, speed => applyStep(speed, { kind: 'end' }))
    }
  })

  // Opens the pane first, then scans the transcripts. Only per-day token counts and session ids come back; no message
  // text is kept.
  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tokens per day' })
    await scanTranscripts($)

    return { text: 'Tokens pane updated.' }
  })

  // Draws the quota on one row of the band directly above the prompt, the model's speed on
  // the row beneath it, and the context window as a card at the foot of the band, nearest
  // the prompt. The band is shared with surveys, so it yields while one holds it. It sizes
  // to bodyColumns, which keeps clear of the band's own [-] mark.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    // One round trip for every state read the band needs, since the band redraws ten times a second while a step runs.
    const [rows, speed, nowMs, frames, fill, modelInUse, spend, ctxRows] = await Promise.all([
      read($, windows),
      read($, timing),
      $.clock.now(),
      read($, sweep),
      read($, context),
      read($, model),
      read($, cost),
      read($, contextRows),
    ])
    const now = new Date(nowMs)
    const { Box, Text } = $.ui.resolve(e)
    const running = speed?.running ?? null
    const line = speedLine(running, speed?.ttftMs, speed?.tps, nowMs)
    const lit = running ? sweepIndex(frames * FRAME_MS) : undefined
    // The desktop app draws its own band: the speed and the quota on one row, the quota as solid bars, and the context
    // left to its own panel. Every other surface draws the band as text, the terminal's way.
    if (e.surface === 'desktop') {
      return desktopBand(
        {
          now,
          windows: rows,
          model: e.props.bodyColumns >= 90 ? modelInUse : null,
          cost: e.props.bodyColumns >= 100 ? spend : null,
          speed: line,
          running: running !== null,
          lit,
        },
        { Box, Text },
      )
    }
    return terminalBand(
      {
        columns: e.props.bodyColumns,
        now,
        windows: rows,
        fill,
        breakdown: ctxRows ?? [],
        model: modelInUse,
        cost: spend,
        speed: line,
        running: running !== null,
        lit,
      },
      { Box, Text },
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const state = await read($, tokens)
    const selected = await read($, range)
    const ctxNow = await read($, context)
    const ctxRowsNow = await read($, contextRows)
    const now = new Date(await $.clock.now())
    const columns = e.viewport?.columns ?? 80

    const scan = state.status === 'ready' ? state.scan : undefined
    const days = scan ? daysInRange(selected, now, scan) : []
    const totals: Record<string, ModelTokens> = scan ? sumModels(scan, days) : {}
    const entries = rankEntries(totals)
    const order = entries.map(([id]) => id)
    const grand = entries.reduce((sum, [, t]) => sum + tokensOf(t), 0)
    const sessions = scan ? scan.sessions[selected] : 0
    const anyUsage = scan ? Object.keys(scan.days).length > 0 : false
    const hours = scan ? hourGrid(scan, days) : []
    const hourMax = Math.max(0, ...hours.flat())
    const maxColumns = Math.max(4, Math.min(60, Math.floor((columns - 12) / 2)))
    const bars = scan ? columnsWithSegments(scan, days, order, maxColumns) : []
    const max = Math.max(1, ...bars.map(bar => bar.total))
    const view = {
      state,
      selected,
      ranges: RANGES,
      onSelect: async (key: TokenRange) => {
        await update($, range, () => key)
      },
      onRefresh: () => scanTranscripts($),
      context: ctxNow,
      breakdown: ctxRowsNow ?? [],
      days,
      entries,
      grand,
      sessions,
      anyUsage,
      hours,
      hourMax,
      bars,
      max,
    }
    // The desktop app draws its own pane: solid bars and cells, with the figures in larger type. Every other surface
    // draws the pane as text, the terminal's way.
    if (e.surface === 'desktop') return desktopPane({ ...view, columns }, els)
    return terminalPane(view, els)
  })
}
