import type { BoxProps, ButtonProps, ElementConstructor, TextProps } from 'claude-code'

import type { ContextFill, ContextRow, ModelTokens, TokenRange, TokenScanState } from '../types'

import type { LegendItem } from './context'
import { contextLegend, shareOf } from './context'
import { compactTokens, toneOf } from './format'
import type { Column } from './tokens'
import { CHART_ROWS, WEEKDAYS, axisLabels, colorOf, dayLabel, formatShare, formatTokens, modelName, tokensOf } from './tokens'

/** The elements the desktop pane is drawn with: the desktop table's Box, Button and Text. */
export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Button: ElementConstructor<ButtonProps>
  Text: ElementConstructor<TextProps>
}

/** What the desktop pane shows, as the render hook has read and computed it. */
export type PaneView = {
  /** The pane's width in cells. */
  columns: number
  state: TokenScanState
  selected: TokenRange
  ranges: ReadonlyArray<{ key: TokenRange; label: string }>
  onSelect: (range: TokenRange) => Promise<void>
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

/** The chart is as many rows tall as the terminal's chart. */
const CHART_HEIGHT = CHART_ROWS
/** A day with usage is at least this share of the largest day, so a light day does not draw as a gap. */
const MIN_DAY = 1 / (CHART_ROWS * 8)
/** The unfilled part of a bar. */
const TRACK = 'subtle'
/** The heatmap's colours: four steps of the Claude colour, from the faintest to the full colour. */
const HEAT = ['#d7775740', '#d7775780', '#d77757bf', '#d77757'] as const
/** A heatmap cell that holds no tokens. */
const HEAT_NONE = 'subtle'
/** The flex weights of a bar's parts sum to this: the engine takes no weight above 10000. */
const WHOLE = 1000

/** The colour of a heatmap cell: a step by its share of the largest cell. */
function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return HEAT_NONE
  const level = Math.min(4, Math.ceil((value / max) * 4))
  return HEAT[level - 1] ?? HEAT_NONE
}

/** The legend's items in a row, wrapping when the pane is narrow. */
function legendRow(items: LegendItem[], window: number, { Box, Text }: PaneElements) {
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      {items.map(item => (
        <Text key={item.label} size="caption">
          <Text color={item.color}>{'■ '}</Text>
          <Text color="inactive">{`${item.label} `}</Text>
          <Text tabular>{compactTokens(item.tokens)}</Text>
          <Text color="inactive">{` ${shareOf(item.tokens, window)}`}</Text>
        </Text>
      ))}
    </Box>
  )
}

/** The context in use now: its tokens against the window, one bar of its parts, and the legend under it. */
function contextNow(context: ContextFill | null, breakdown: ContextRow[], els: PaneElements) {
  const { Box, Text } = els
  if (context === null || context.tokens === undefined) return null
  const legend = contextLegend(breakdown)
  const percent = context.percent === undefined ? null : Math.round(context.percent)
  const withParts = legend.some(item => item.tokens > 0)
  // Each part's share of the bar is its tokens, so the bar needs no count of cells.
  const total = legend.reduce((sum, item) => sum + item.tokens, 0)
  const filled = percent === null ? 0 : Math.min(100, Math.max(0, percent))
  const segments = withParts
    ? legend.map(item => ({ color: item.color, weight: (item.tokens / total) * WHOLE }))
    : percent === null
      ? []
      : [
          { color: toneOf(percent), weight: (filled / 100) * WHOLE },
          { color: TRACK, weight: ((100 - filled) / 100) * WHOLE },
        ]
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
        <Text size="footnote" weight="semibold">
          <Text color="claude">{'◆ '}</Text>
          {'Context now'}
        </Text>
        <Text size="caption" color="inactive" tabular>
          {`${compactTokens(context.tokens)} of ${compactTokens(context.window)}`}
        </Text>
      </Box>
      <Box flexDirection="row">
        {segments
          .filter(segment => segment.weight > 0)
          .map((segment, index) => (
            <Box key={`part-${index}`} flexGrow={segment.weight} height={1} backgroundColor={segment.color} />
          ))}
      </Box>
      {withParts ? legendRow(legend, context.window, els) : null}
    </Box>
  )
}

/** The range's total, in large type, with the sessions it spans. */
function totals(view: PaneView, { Box, Text }: PaneElements) {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" alignItems="flex-end" columnGap={2}>
        <Text size="heading" weight="semibold" tabular>{formatTokens(view.grand)}</Text>
        <Text size="caption" color="inactive">
          {`tokens across ${view.sessions} ${view.sessions === 1 ? 'session' : 'sessions'}`}
        </Text>
      </Box>
      <Text size="caption" color="inactive">Each API response is counted once; /stats adds every log row.</Text>
    </Box>
  )
}

/**
 * One day's column of the chart: its models stacked from the bottom, each as tall as its tokens. The column is
 * as tall as the largest day, so the empty part above it is the rest of that height.
 */
function dayColumn(bar: Column, max: number, index: number, { Box }: PaneElements) {
  const shown = bar.total > 0 ? Math.max(bar.total, max * MIN_DAY) : 0
  const scale = bar.total > 0 ? shown / bar.total : 0
  return (
    <Box key={`day-${index}`} flexDirection="column" flexGrow={1}>
      <Box flexGrow={((max - shown) / max) * WHOLE} />
      {[...bar.segments].reverse().map(segment => (
        <Box
          key={segment.model}
          flexGrow={((segment.tokens * scale) / max) * WHOLE}
          backgroundColor={colorOf(segment.model)}
        />
      ))}
    </Box>
  )
}

/** The tokens per day, as solid columns with the axis labels beside them and the first and last days under them. */
function chart(view: PaneView, els: PaneElements) {
  const { Box, Text } = els
  const [top, middle, bottom] = axisLabels(view.max)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" columnGap={2} height={CHART_HEIGHT}>
        <Box flexDirection="column" justifyContent="space-between">
          <Text size="caption" color="inactive" tabular>{top}</Text>
          <Text size="caption" color="inactive" tabular>{middle}</Text>
          <Text size="caption" color="inactive" tabular>{bottom}</Text>
        </Box>
        <Box flexDirection="row" flexGrow={1} columnGap={1}>
          {view.bars.map((bar, index) => dayColumn(bar, view.max, index, els))}
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between">
        <Text size="caption" color="inactive">{dayLabel(view.days[0] ?? '')}</Text>
        <Text size="caption" color="inactive">{dayLabel(view.days[view.days.length - 1] ?? '')}</Text>
      </Box>
    </Box>
  )
}

/** Each model: its colour, its name and share, a bar of that share, and its input, output and cache tokens. */
function modelRows(view: PaneView, { Box, Text }: PaneElements) {
  return (
    <Box flexDirection="column" gap={2}>
      {view.entries.map(([id, tokens]) => {
        const share = (tokensOf(tokens) / view.grand) * 100
        return (
          <Box key={id} flexDirection="column" gap={1}>
            <Box flexDirection="row" alignItems="center" columnGap={2}>
              <Box width={1} height={1} backgroundColor={colorOf(id)} />
              <Text weight="semibold">{modelName(id)}</Text>
              <Box flexGrow={1} />
              <Text size="caption" color="inactive" tabular>{`${formatShare(share)} · ${formatTokens(tokensOf(tokens))}`}</Text>
            </Box>
            <Box flexDirection="row" height={1}>
              <Box flexGrow={share} height={1} backgroundColor={colorOf(id)} />
              <Box flexGrow={100 - share} height={1} backgroundColor={TRACK} />
            </Box>
            <Text size="caption" color="inactive" tabular>
              {`In ${formatTokens(tokens.input)} · Out ${formatTokens(tokens.output)} · Cache ${formatTokens(tokens.cacheRead)} read, ${formatTokens(tokens.cacheWrite)} write`}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** The heatmap: a solid cell for each weekday and hour, the hours labelled every third, and a key under it. */
function heatmap(view: PaneView, { Box, Text }: PaneElements) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text size="footnote" weight="semibold">When tokens are used, by hour (local time)</Text>
      <Box flexDirection="row" columnGap={1}>
        <Box width={4} />
        {Array.from({ length: 24 }, (_, hour) => (
          <Box key={`hour-${hour}`} flexGrow={1} overflow="visible">
            {hour % 3 === 0 ? <Text size="caption" color="inactive">{String(hour)}</Text> : null}
          </Box>
        ))}
      </Box>
      {WEEKDAYS.map((name, row) => (
        <Box key={name} flexDirection="row" alignItems="center" columnGap={1}>
          <Box width={4}>
            <Text size="caption" color="inactive">{name}</Text>
          </Box>
          {(view.hours[row] ?? []).map((value, hour) => (
            <Box key={`hour-${hour}`} flexGrow={1} height={1} backgroundColor={heatColor(value, view.hourMax)} />
          ))}
        </Box>
      ))}
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text size="caption" color="inactive">less</Text>
        {[HEAT_NONE, ...HEAT].map((color, index) => (
          <Box key={`key-${index}`} width={2} height={1} backgroundColor={color} />
        ))}
        <Text size="caption" color="inactive">more</Text>
      </Box>
    </Box>
  )
}

/**
 * The /tokens pane on the desktop app: the context in use, the range buttons, the range's total, solid columns per day,
 * a bar per model, and the heatmap of hours. The terminal draws the same pane as text, in register.tsx.
 */
export function desktopPane(view: PaneView, els: PaneElements) {
  const { Box, Button, Text } = els
  const { state } = view
  return (
    <Box flexDirection="column" gap={2}>
      {contextNow(view.context, view.breakdown, els)}
      <Box flexDirection="row" columnGap={1}>
        {view.ranges.map(item => (
          <Button
            key={item.key}
            variant={item.key === view.selected ? 'primary' : 'secondary'}
            onPress={() => view.onSelect(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </Box>
      {state.status === 'idle' || state.status === 'scanning' ? <Text dimColor>Scanning transcripts…</Text> : null}
      {state.status === 'failed' ? <Text color="error">{`Could not read the transcripts: ${state.reason}`}</Text> : null}
      {state.status === 'ready' && view.grand === 0 && view.anyUsage ? <Text color="inactive">No tokens in this range.</Text> : null}
      {state.status === 'ready' && view.grand === 0 && !view.anyUsage ? (
        <Text color="inactive">{`No transcripts with usage found in ${state.scan.root}.`}</Text>
      ) : null}
      {state.status === 'ready' && view.grand > 0 ? (
        <Box flexDirection="column" gap={2}>
          {totals(view, els)}
          {chart(view, els)}
          {modelRows(view, els)}
          {heatmap(view, els)}
        </Box>
      ) : null}
    </Box>
  )
}
