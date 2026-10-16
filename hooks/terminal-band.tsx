import type { ContextFill, ContextRow, ModelInUse, QuotaWindow } from '../types'

import type { BandElements } from './band'
import { BAR_WIDTH, barCells, clip, compactTokens, filledCells, formatCost, labelOf, resetIn, resetsThatFit, toneOf } from './format'
import { LEGEND_SPLIT, contextBar, contextLegend, packLegend, shareOf } from './context'
import type { BarRun } from './context'
import { WORKING } from './timing'
import { modelName } from './tokens'

/** The context card is not drawn narrower than this, once its border and padding are taken off the band. */
const CARD_MIN_INNER = 20

/** What the terminal band shows, as the render hook reads it from the plugin's state. */
export type TerminalBandView = {
  /** The band's body width in cells. */
  columns: number
  now: Date
  windows: QuotaWindow[]
  /** The live context window, or null before the session reports one. */
  fill: ContextFill | null
  /** The rows of the live context breakdown. */
  breakdown: ContextRow[]
  model: ModelInUse | null
  cost: number | null
  /** The speed row's text, starting with the word `working` while a step runs. */
  speed: string
  running: boolean
  /** The letter of `working` the light is on, if it is on the word. */
  lit: number | undefined
}

/**
 * The band in the terminal, as text: the speed row, then the quota on one line, and below them a card with the
 * context, nearest the prompt. It sizes to the band's body columns.
 */
export function terminalBand(view: TerminalBandView, { Box, Text }: BandElements) {
  const { columns, now, fill, breakdown, speed: line, running, lit } = view
  const rows = view.windows
  const modelInUse = view.model
  const spend = view.cost
  const roomy = columns >= 105
  const withReset = columns >= 97
  const barWidth = columns >= 90 ? BAR_WIDTH : 6
  // The card is the band's width less its border and padding. The fill is absent until the session's
  // first response, and again after a compaction: then the card shows a dash and an empty bar.
  const inner = columns - 4
  const withCard = inner >= CARD_MIN_INNER
  // Before the first response the engine reports no fill, but the breakdown the session starts with already counts the
  // tokens in use. The fill is worked out from it then, so the card shows its parts at once.
  const usedTokens = breakdown.reduce((sum, row) => (row.kind === 'used' ? sum + row.tokens : sum), 0)
  const estimated = fill !== null && fill.window > 0 && usedTokens > 0 ? Math.round((usedTokens / fill.window) * 100) : null
  const ctxPercent = fill?.percent === undefined ? estimated : Math.round(fill.percent)
  const ctxTone = ctxPercent === null ? null : toneOf(ctxPercent)
  // The fill alone, when there is no part of the window to draw: a dash before the first response, else filled cells.
  const fillBar: BarRun[] = ctxPercent === null || ctxTone === null
    ? [{ color: 'subtle', glyph: '─', cells: inner }]
    : [
        { color: 'claude', glyph: '█', cells: Math.min(inner, filledCells(ctxPercent, inner)) },
        { color: 'subtle', glyph: '─', cells: Math.max(0, inner - filledCells(ctxPercent, inner)) },
      ]
  // The parts of the window, once the breakdown has tokens to show: an all-zero breakdown would leave the bar empty.
  const rowBar: BarRun[] = ctxPercent === null ? [] : contextBar(breakdown, inner)
  const bar: BarRun[] = rowBar.length > 0 ? rowBar : fillBar
  // The legend sits under the bar, which the terminal draws as text.
  const legendLines = rowBar.length > 0 ? packLegend(contextLegend(breakdown), fill?.window ?? 0, inner) : []
  // The tokens against the window: the last response's, or the breakdown's until a response reports them.
  const shownTokens = fill?.tokens ?? (estimated === null ? undefined : usedTokens)
  const tokensText = fill === null || shownTokens === undefined ? undefined : `${compactTokens(shownTokens)} of ${compactTokens(fill.window)}`
  const withModel = columns >= 90
  const withCost = columns >= 100

  // The quota is drawn as the context is below it: a diamond heading, then one line with each window's bar,
  // badge and reset time.
  // A window keeps its reset time while the quota line fits the card; the last resets go first.
  const windowParts = rows.map(w => ({
    label: labelOf(w.kind),
    badge: ` ${Math.round(w.percentUsed)}% `,
    reset: withReset ? resetIn(w.resetsAt, now) : '',
  }))
  const resetShown = resetsThatFit(windowParts, inner, barWidth, roomy)
  const quotaHeader = (
    <Box flexDirection="row">
      <Text color="claude">{'◆ '}</Text>
      <Text bold>quota</Text>
    </Box>
  )
  const quotaWindows = (
    <Box flexDirection="row">
      {rows.length === 0 ? (
        <Text color="inactive">no data yet</Text>
      ) : (
        rows.map((w, i) => {
          const percent = Math.round(w.percentUsed)
          const tone = toneOf(percent)
          const cells = barCells(percent, barWidth)
          const reset = resetIn(w.resetsAt, now)

          return (
            <Box key={w.kind} flexDirection="row">
              {i === 0 ? null : <Text color="inactive">{roomy ? '   ·   ' : ' · '}</Text>}
              <Text color="inactive">{`${labelOf(w.kind)} `}</Text>
              <Text color="claude">{cells.filled}</Text>
              <Text color="subtle">{cells.empty}</Text>
              <Text bold color={tone}>{` ${percent}% `}</Text>
              {resetShown[i] && reset ? <Text color="inactive">{roomy ? `  ↻ ${reset}` : ` ↻ ${reset}`}</Text> : null}
            </Box>
          )
        })
      )}
    </Box>
  )
  const quotaRow = (
    <Box flexDirection="column">
      {quotaHeader}
      {quotaWindows}
    </Box>
  )

  // The speed row sits above the card: the model in use, the light while a step runs, its speeds and the cost.
  const speedRow = (
    <Box flexDirection="row">
      <Text color="inactive">{'  '}</Text>
      {withModel && modelInUse !== null ? (
        <Box flexDirection="row">
          <Text color="claude">{clip(modelName(modelInUse.model), 18)}</Text>
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
  )

  return (
    <Box flexDirection="column" marginTop={1}>
      {speedRow}
      {withCard ? (
        <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
          {quotaRow}
          <Box flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text color="claude">{'◆ '}</Text>
              <Text bold>context</Text>
            </Text>
            {ctxPercent === null || ctxTone === null ? (
              <Text dimColor>{fill === null ? '—' : `— of ${compactTokens(fill.window)}`}</Text>
            ) : (
              <Text wrap="truncate-start">
                {tokensText === undefined ? null : <Text dimColor>{`${tokensText} `}</Text>}
                <Text bold color={ctxTone}>{` ${ctxPercent}% `}</Text>
              </Text>
            )}
          </Box>
          {ctxPercent === null ? (
            <Text dimColor wrap="truncate-end">{'the parts appear after the first response'}</Text>
          ) : (
            <Text>
              {bar.map((run, index) => (
                <Text key={`bar-${index}`} color={run.color}>{run.glyph.repeat(run.cells)}</Text>
              ))}
            </Text>
          )}
          {legendLines.map((items, row) => (
            <Text key={`legend-${row}`} wrap="truncate-end">
              {items.map((item, index) => (
                <Text key={item.label}>
                  {index > 0 ? LEGEND_SPLIT : null}
                  <Text color={item.color}>{`${item.glyph} `}</Text>
                  <Text dimColor>{`${item.label} `}</Text>
                  <Text bold>{compactTokens(item.tokens)}</Text>
                  <Text dimColor>{` ${shareOf(item.tokens, fill?.window ?? 0)}`}</Text>
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      ) : (
        quotaRow
      )}
    </Box>
  )
}
