import type { ContextFill, ContextRow, ModelTokens, TokenRange, TokenScanState } from '../types'

import type { PaneElements } from './pane'
import { contextLegend } from './context'
import { compactTokens, timeOfDay } from './format'
import type { Column } from './tokens'
import { CHART_ROWS, WEEKDAYS, axisLabels, chartRows, colorOf, dayLabel, formatShare, formatTokens, heatCell, modelName, tokensOf } from './tokens'

/** What the terminal's `/tokens` pane shows, as the render hook has read and computed it. */
export type TerminalPaneView = {
  state: TokenScanState
  selected: TokenRange
  ranges: ReadonlyArray<{ key: TokenRange; label: string }>
  onSelect: (range: TokenRange) => Promise<void>
  onRefresh: () => Promise<void>
  /** The context in use now, and the rows of its breakdown. */
  context: ContextFill | null
  breakdown: ContextRow[]
  /** The days the chart and the heatmap cover, oldest first. */
  days: string[]
  /** The models with their tokens over the range, most used first. */
  entries: Array<[string, ModelTokens]>
  grand: number
  sessions: number
  anyUsage: boolean
  /** Tokens per weekday (Monday first) and local hour, and the largest of them. */
  hours: number[][]
  hourMax: number
  /** One column per group of days, and the largest column's total. */
  bars: Column[]
  max: number
}

/**
 * The `/tokens` pane in the terminal, as text: the context in use, the range buttons and a refresh, the range's total,
 * the chart, each model's tokens, and the heatmap of hours.
 */
export function terminalPane(view: TerminalPaneView, { Box, Button, Text }: PaneElements) {
  const { state, selected, days, entries, grand, sessions, anyUsage, hours, hourMax, bars, context: ctxNow, breakdown: ctxRowsNow } = view
  const scan = state.status === 'ready' ? state.scan : undefined
  const grid = chartRows(bars, view.max)
  const [topLabel, middleLabel, bottomLabel] = axisLabels(view.max)
  const axis = (row: number): string => {
    if (row === 0) return topLabel
    if (row === Math.floor(CHART_ROWS / 2)) return middleLabel
    if (row === CHART_ROWS - 1) return bottomLabel
    return ''
  }

  return (
    <Box flexDirection="column">
      {ctxNow === null || ctxNow.tokens === undefined ? null : (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{`Context now: ${compactTokens(ctxNow.tokens)} of ${compactTokens(ctxNow.window)}`}</Text>
          <Box flexDirection="row">
            {contextLegend(ctxRowsNow).map(item => (
              <Text key={item.label} color={item.color}>{`${item.glyph} ${item.label} ${compactTokens(item.tokens)}   `}</Text>
            ))}
          </Box>
        </Box>
      )}
      <Box flexDirection="row">
        {view.ranges.map(item => (
          <Button
            key={item.key}
            variant={item.key === selected ? 'primary' : 'secondary'}
            onPress={() => view.onSelect(item.key)}
          >
            {item.label}
          </Button>
        ))}
        <Button key="refresh" variant="secondary" onPress={() => view.onRefresh()}>
          Refresh
        </Button>
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
          {state.status === 'ready' ? <Text color="inactive">{`Scanned ${timeOfDay(state.at)}`}</Text> : null}
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{'When tokens are used, by hour (local time)'}</Text>
            <Text color="inactive">
              {`    ${Array.from({ length: 24 }, (_, hour) => (hour % 3 === 0 ? String(hour).padEnd(2) : '  ')).join('')}`}
            </Text>
            {WEEKDAYS.map((name, row) => (
              <Box key={name} flexDirection="row">
                <Text color="inactive">{`${name} `}</Text>
                {(hours[row] ?? []).map((value, hour) => {
                  const cell = heatCell(value, hourMax)
                  return (
                    <Text key={`hour-${hour}`} color={cell.color}>
                      {`${cell.char} `}
                    </Text>
                  )
                })}
              </Box>
            ))}
            <Text color="inactive">{'    less ░▒▓█ more'}</Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
