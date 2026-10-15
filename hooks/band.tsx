import type { BoxProps, ElementConstructor, TextProps } from 'claude-code'

import type { ModelInUse, QuotaWindow } from '../types'

import { clip, filledCells, formatCost, labelOf, resetLabel, toneOf } from './format'
import { WORKING } from './timing'
import { modelName } from './tokens'

/** The elements the desktop band is drawn with: the desktop table's Box and Text. */
export type BandElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
}

/** What the desktop band shows, as the render hook reads it from the plugin's state. */
export type BandView = {
  /** The band's width in cells. */
  columns: number
  now: Date
  windows: QuotaWindow[]
  model: ModelInUse | null
  cost: number | null
  /** The speed row's text, starting with the word `working` while a step runs. */
  speed: string
  running: boolean
  /** The letter of `working` the light is on, if it is on the word. */
  lit: number | undefined
}

/** The card's border and padding, in cells across. */
const CHROME = 4
/** The card is left out below this many cells inside, as the terminal's is. */
const CARD_MIN_INNER = 20
/** The cells between two quota windows side by side. */
const WINDOW_GAP = 4
/** The narrowest a quota window may be before the windows stack one above the other. */
const WINDOW_MIN = 30
/** The part of a quota bar that is not used. */
const TRACK = 'subtle'

/** One quota window: its label and percentage, its bar across the column, and its reset time under the bar. */
function quotaWindow(w: QuotaWindow, width: number, now: Date, { Box, Text }: BandElements) {
  const percent = Math.round(w.percentUsed)
  const tone = toneOf(percent)
  const filled = filledCells(percent, width)
  const reset = resetLabel(w.resetsAt, now)
  return (
    <Box key={w.kind} flexDirection="column" width={width}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
        <Text size="caption" color="inactive">{labelOf(w.kind)}</Text>
        <Text size="heading" weight="semibold" tabular color={tone}>{`${percent}%`}</Text>
      </Box>
      <Box flexDirection="row" width={width} height={1}>
        {filled > 0 ? <Box width={filled} height={1} backgroundColor={tone} /> : null}
        {width > filled ? <Box width={width - filled} height={1} backgroundColor={TRACK} /> : null}
      </Box>
      <Box height={1}>
        {reset ? <Text size="caption" color="inactive" tabular>{`↻ ${reset}`}</Text> : null}
      </Box>
    </Box>
  )
}

/** The quota: a heading, then one column per window, side by side when the card has room for them. */
function quotaSection(view: BandView, inner: number, els: BandElements) {
  const { Box, Text } = els
  const count = view.windows.length
  const sideBySide = count > 1 && inner >= count * WINDOW_MIN + (count - 1) * WINDOW_GAP
  const width = sideBySide ? Math.floor((inner - (count - 1) * WINDOW_GAP) / count) : inner
  return (
    <Box flexDirection="column" gap={1}>
      <Text size="footnote" weight="semibold">
        <Text color="claude">{'◆ '}</Text>
        {'quota'}
      </Text>
      {count === 0 ? (
        <Text size="caption" color="inactive">no data yet</Text>
      ) : (
        <Box flexDirection={sideBySide ? 'row' : 'column'} columnGap={WINDOW_GAP} rowGap={1}>
          {view.windows.map(w => quotaWindow(w, width, view.now, els))}
        </Box>
      )}
    </Box>
  )
}

/** The speed row above the card: the model in use, the light while a step runs, the speeds, and the session's cost. */
function speedRow(view: BandView, { Box, Text }: BandElements) {
  return (
    <Box flexDirection="row" alignItems="flex-end" columnGap={2} paddingX={2}>
      {view.model === null ? null : (
        <Box flexDirection="row" alignItems="flex-end" columnGap={1}>
          <Text size="caption" weight="semibold" color="claude">{clip(modelName(view.model.model), 18)}</Text>
          {view.model.effort === undefined ? null : <Text size="caption" color="inactive">{`(${view.model.effort})`}</Text>}
        </Box>
      )}
      {view.running ? (
        <Box flexDirection="row">
          {[...WORKING].map((letter, index) => (
            <Text
              key={`letter-${index}`}
              size="caption"
              color={index === view.lit ? 'claude' : 'inactive'}
              weight={index === view.lit ? 'semibold' : 'regular'}
            >
              {letter}
            </Text>
          ))}
        </Box>
      ) : null}
      <Text size="caption" color="inactive" tabular>
        {view.running ? view.speed.slice(WORKING.length).trimStart() : view.speed}
      </Text>
      {view.cost === null ? null : <Text size="caption" color="inactive" tabular>{formatCost(view.cost)}</Text>}
    </Box>
  )
}

/**
 * The band on the desktop app: the speed row above a card with the quota, its windows as solid bars. The context is
 * left out, since the desktop app has its own panel for it. The terminal draws the band as text, in register.tsx.
 */
export function desktopBand(view: BandView, els: BandElements) {
  const { Box } = els
  const inner = view.columns - CHROME
  const quota = quotaSection(view, inner, els)
  return (
    <Box flexDirection="column" marginTop={1} rowGap={1}>
      {speedRow(view, els)}
      {inner >= CARD_MIN_INNER ? (
        <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} paddingY={1}>
          {quota}
        </Box>
      ) : quota}
    </Box>
  )
}
