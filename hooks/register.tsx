import type { Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { ContextFill, ModelInUse, ModelSpeed, ModelTokens, QuotaWindow, TokenRange, TokenScan, TokenScanState } from '../types'

import { BAR_WIDTH, barCells, compactTokens, formatCost, labelOf, resetLabel, toneOf } from './format'
import { FRAME_MS, WORKING, applyStep, speedLine, sweepIndex } from './timing'
import {
  CHART_ROWS,
  axisLabels,
  chartRows,
  colorOf,
  columnsWithSegments,
  dayLabel,
  daysInRange,
  formatShare,
  formatTokens,
  modelName,
  rankEntries,
  sessionsIn,
  sumModels,
  tokensOf,
} from './tokens'

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const reading = await $.session.usage()
    await update($, windows, () => reading.rateLimits)
    await update($, context, () => reading.context)
    await update($, cost, () => reading.cost?.usd ?? null)
    // Runs at once when typed mid-turn: it reads the transcripts on disk, not the turn's state.
    await $.command.register({
      name: 'tokens',
      description: 'Show tokens per day, by model, in a pane',
      immediate: true,
    })

    return next(e)
  })

  // Pushed by the engine when a window moves a whole point or the context fill moves, so the
  // line refreshes without polling.
  on('session.measure', async ($, e, next) => {
    await update($, windows, () => e.rateLimits)
    await update($, context, () => e.context)
    await update($, cost, () => e.cost?.usd ?? null)

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

  // Opens the pane first, then runs the scanner the mod ships. Only per-day
  // token counts and session ids come back; no message text is kept.
  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tokens per day' })
    await update($, tokens, () => ({ status: 'scanning' as const }))
    try {
      const python = await pythonFor(argv => $.process.run(argv, { timeoutMs: 10_000 }))
      if (!python) throw new Error('Python 3 was not found on the PATH, as python3 or python')
      const ran = await $.process.run(
        [python, '-I', `${$.plugin.root}/hooks/scan_usage.py`],
        { timeoutMs: 120_000 },
      )
      // The reply is cut at 4 MiB; a cut reply is not valid JSON, so say why instead.
      if (ran.isStdoutTruncated) throw new Error('The scan printed more than 4 MiB, too much to read')
      if (ran.exitCode === 0) {
        const scan = JSON.parse(ran.stdout) as TokenScan
        await update($, tokens, () => ({ status: 'ready' as const, scan }))
      } else {
        const reason = ran.stderr.trim().split('\n')[0] || 'the scanner exited with an error'
        await update($, tokens, () => ({ status: 'failed' as const, reason }))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await update($, tokens, () => ({ status: 'failed' as const, reason }))
    }

    return { text: 'Tokens pane updated.' }
  })

  // Draws the quota on one row of the band directly above the prompt, and the model's
  // speed on the row beneath it, both aligned left. The band is shared with surveys, so
  // it yields while one holds it. It sizes to bodyColumns, which keeps clear of the
  // band's own [-] mark.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const rows = await read($, windows)
    const speed = await read($, timing)
    const nowMs = await $.clock.now()
    const now = new Date(nowMs)
    const { Box, Text } = $.ui.resolve(e)
    const roomy = e.props.bodyColumns >= 105
    const withReset = e.props.bodyColumns >= 97
    const barWidth = e.props.bodyColumns >= 90 ? BAR_WIDTH : 6
    const frames = await read($, sweep)
    const running = speed?.running ?? null
    const line = speedLine(running, speed?.ttftMs, speed?.tps, nowMs)
    const lit = running ? sweepIndex(frames * FRAME_MS) : undefined
    // The context fill is absent until the session's first response, shown as a dash.
    const fill = await read($, context)
    const ctxPercent = fill?.percent === undefined ? null : Math.round(fill.percent)
    const fillBar = ctxPercent === null ? null : { percent: ctxPercent, cells: barCells(ctxPercent, barWidth), tone: toneOf(ctxPercent) }
    // The tokens need 120 columns: the quota row with them is 107 wide, so a narrower band would wrap it.
    const detail = e.props.bodyColumns >= 120 && fill?.tokens !== undefined ? `${compactTokens(fill.tokens)}/${compactTokens(fill.window)}` : undefined
    const withContext = e.props.bodyColumns >= 70
    const modelInUse = await read($, model)
    const spend = await read($, cost)
    const withModel = e.props.bodyColumns >= 90
    const withCost = e.props.bodyColumns >= 100

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text color="claude" bold>
            {roomy ? '  Quota  ' : '  Quota '}
          </Text>
          {rows.length === 0 ? (
            <Text color="inactive">no data yet</Text>
          ) : (
            rows.map((w, i) => {
              const percent = Math.round(w.percentUsed)
              const tone = toneOf(percent)
              const cells = barCells(percent, barWidth)
              const reset = resetLabel(w.resetsAt, now)

              return (
                <Box key={w.kind} flexDirection="row">
                  {i > 0 ? <Text color="inactive">{roomy ? '   ·   ' : ' · '}</Text> : null}
                  <Text color="inactive">{labelOf(w.kind)} </Text>
                  <Text color={tone}>{cells.filled}</Text>
                  <Text color="subtle">{cells.empty}</Text>
                  <Text color={tone}>{` ${percent}%`}</Text>
                  {withReset && reset ? <Text color="inactive">{roomy ? `  ↻ ${reset}` : ` ↻ ${reset}`}</Text> : null}
                </Box>
              )
            })
          )}
          {withContext ? (
            <Box flexDirection="row">
              <Text color="inactive">{roomy ? '   ·   ctx ' : ' · ctx '}</Text>
              {fillBar === null ? (
                <Text color="inactive">{'—'}</Text>
              ) : (
                <Box flexDirection="row">
                  <Text color={fillBar.tone}>{fillBar.cells.filled}</Text>
                  <Text color="subtle">{fillBar.cells.empty}</Text>
                  <Text color={fillBar.tone}>{` ${fillBar.percent}%`}</Text>
                  {detail === undefined ? null : <Text color="inactive">{`  ${detail}`}</Text>}
                </Box>
              )}
            </Box>
          ) : null}
        </Box>
        <Box flexDirection="row">
          <Text color="inactive">{'  '}</Text>
          {withModel && modelInUse !== null ? (
            <Box flexDirection="row">
              <Text color="claude">{modelName(modelInUse.model)}</Text>
              <Text color="inactive">{modelInUse.effort === undefined ? ' · ' : ` (${modelInUse.effort}) · `}</Text>
            </Box>
          ) : null}
          {running ? (
            [...WORKING].map((letter, i) => (
              <Text key={`letter-${i}`} color={i === lit ? 'claude' : 'inactive'} bold={i === lit}>
                {letter}
              </Text>
            ))
          ) : null}
          <Text color="inactive">{running ? line.slice(WORKING.length) : line}</Text>
          {withCost && spend !== null ? <Text color="inactive">{` · ${formatCost(spend)}`}</Text> : null}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const state = await read($, tokens)
    const selected = await read($, range)
    const now = new Date(await $.clock.now())
    const columns = e.viewport?.columns ?? 80

    const scan = state.status === 'ready' ? state.scan : undefined
    const days = scan ? daysInRange(selected, now, scan) : []
    const totals: Record<string, ModelTokens> = scan ? sumModels(scan, days) : {}
    const entries = rankEntries(totals)
    const order = entries.map(([id]) => id)
    const grand = entries.reduce((sum, [, t]) => sum + tokensOf(t), 0)
    const sessions = scan ? sessionsIn(scan, days) : 0
    const anyUsage = scan ? Object.keys(scan.sessionsByDay).length > 0 : false
    const maxColumns = Math.max(4, Math.min(60, Math.floor((columns - 12) / 2)))
    const bars = scan ? columnsWithSegments(scan, days, order, maxColumns) : []
    const max = Math.max(1, ...bars.map(bar => bar.total))
    const grid = chartRows(bars, max)
    const [topLabel, middleLabel, bottomLabel] = axisLabels(max)
    const axis = (row: number): string => {
      if (row === 0) return topLabel
      if (row === Math.floor(CHART_ROWS / 2)) return middleLabel
      if (row === CHART_ROWS - 1) return bottomLabel
      return ''
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {RANGES.map(item => (
            <Button
              key={item.key}
              variant={item.key === selected ? 'primary' : 'secondary'}
              onPress={() => update($, range, () => item.key)}
            >
              {item.label}
            </Button>
          ))}
        </Box>
        {state.status === 'idle' || state.status === 'scanning' ? (
          <Text dimColor>Scanning transcripts…</Text>
        ) : null}
        {state.status === 'failed' ? (
          <Text color="error">{`Could not read the transcripts: ${state.reason}`}</Text>
        ) : null}
        {scan && grand === 0 && anyUsage ? <Text color="inactive">No tokens in this range.</Text> : null}
        {scan && grand === 0 && !anyUsage ? (
          <Text color="inactive">{`No transcripts with usage found in ${scan.root}.`}</Text>
        ) : null}
        {scan && grand > 0 ? (
          <Box flexDirection="column">
            {grid.map((line, row) => (
              <Box key={`row-${row}`} flexDirection="row">
                <Text color="inactive">{`${axis(row).padStart(7)} │ `}</Text>
                {line.map((cell, col) => (
                  <Text key={`col-${col}`} color={cell.color}>{`${cell.char} `}</Text>
                ))}
              </Box>
            ))}
            <Text color="inactive">{`${' '.repeat(7)} └${'─'.repeat(bars.length * 2)}`}</Text>
            <Text color="inactive">
              {`${' '.repeat(10)}${dayLabel(days[0] ?? '')} … ${dayLabel(days[days.length - 1] ?? '')}`}
            </Text>
            <Box flexDirection="row">
              {entries.map(([id]) => (
                <Text key={id} color={colorOf(id)}>{`■ ${modelName(id)}   `}</Text>
              ))}
            </Box>
            {entries.map(([id, t]) => {
              const share = (tokensOf(t) / grand) * 100
              return (
                <Box key={id} flexDirection="column">
                  <Box flexDirection="row">
                    <Text color={colorOf(id)}>{'● '}</Text>
                    <Text bold>{modelName(id)}</Text>
                    <Text color="inactive">{` (${formatShare(share)})`}</Text>
                  </Box>
                  <Text color="inactive">{`   In: ${formatTokens(t.input)} · Out: ${formatTokens(t.output)}`}</Text>
                  <Text color="inactive">{`   Cache: ${formatTokens(t.cacheRead)} read · ${formatTokens(t.cacheWrite)} write`}</Text>
                </Box>
              )
            })}
            <Text color="inactive">
              {`${formatTokens(grand)} tokens across ${sessions} ${sessions === 1 ? 'session' : 'sessions'}. Each API response is counted once; /stats adds every log row.`}
            </Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
