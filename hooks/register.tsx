import type { Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { ModelTokens, QuotaWindow, TokenRange, TokenScan, TokenScanState } from '../types'

import { BAR_WIDTH, barCells, labelOf, resetLabel, toneOf } from './format'
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
  sumModels,
  tokensOf,
} from './tokens'

const windows = atom(
  { plugin: 'account-quota', key: 'windows' } as const,
  [] as QuotaWindow[],
)

const tokens = atom(
  { plugin: 'account-quota', key: 'tokens' } as const,
  { status: 'idle' } as TokenScanState,
)

const range = atom(
  { plugin: 'account-quota', key: 'range' } as const,
  'week' as TokenRange,
)

const PANE = 'tokens'

const RANGES: ReadonlyArray<{ key: TokenRange; label: string }> = [
  { key: 'all', label: 'All time' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' },
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const reading = await $.session.usage()
    await update($, windows, () => reading.rateLimits)
    await $.command.register({
      name: 'tokens',
      description: 'Show tokens per day, by model, in a pane',
    })

    return next(e)
  })

  // Pushed by the engine when a window moves a whole point, so the line
  // refreshes without polling.
  on('session.measure', async ($, e, next) => {
    await update($, windows, () => e.rateLimits)

    return next(e)
  })

  // Opens the pane first, then runs the scanner the mod ships. Only per-day
  // token counts come back; no message text is read.
  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tokens per day' })
    await update($, tokens, () => ({ status: 'scanning' as const }))
    try {
      const ran = await $.process.run(
        ['python3', '-I', `${$.plugin.root}/hooks/scan_usage.py`],
        { timeoutMs: 120_000 },
      )
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

  // Draws the engine's hint line as it stands, with the quota after it, so the
  // figures sit right under the input and keep their theme colors. On a narrow
  // terminal the quota drops under the hint, lined up with it, as one block.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const rows = await read($, windows)
    const now = new Date(await $.clock.now())
    const { Box, Text } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80
    const roomy = columns >= 140
    const barWidth = columns >= 90 ? BAR_WIDTH : 6

    const quota = (
      <Box flexDirection="row" flexShrink={0}>
        <Text color="claude" bold>
          {roomy ? '   Quota  ' : 'Quota '}
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
                {reset ? <Text color="inactive">{roomy ? `  ↻ ${reset}` : ` ↻ ${reset}`}</Text> : null}
              </Box>
            )
          })
        )}
      </Box>
    )

    return roomy ? (
      <Box flexDirection="row">
        <Text dimColor>{e.props.hint}</Text>
        {quota}
      </Box>
    ) : (
      <Box flexDirection="column">
        <Text dimColor>{e.props.hint}</Text>
        {quota}
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
        {scan && grand === 0 ? <Text color="inactive">No tokens in this range.</Text> : null}
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
              {`${' '.repeat(10)}${dayLabel(bars[0]?.label ?? '')} … ${dayLabel(bars[bars.length - 1]?.label ?? '')}`}
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
              {`${formatTokens(grand)} tokens across ${scan.sessions} sessions. Each API response is counted once; /stats adds every log row.`}
            </Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
