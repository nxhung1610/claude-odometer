import type { BoxProps, ElementConstructor, TextProps } from 'claude-code'

import type { ModelInUse, QuotaWindow } from '../types'

import { BAR_WIDTH, clip, filledCells, formatCost, labelOf, resetLabel, toneOf } from './format'
import { WORKING } from './timing'
import { modelName } from './tokens'

/** The elements the desktop band is drawn with: the desktop table's Box and Text. */
export type BandElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
}

/** What the desktop band shows, as the render hook reads it from the plugin's state. */
export type BandView = {
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

/** The part of a quota bar that is not used. */
const TRACK = 'subtle'

/** One quota window: its label, a solid bar, its percentage in bold, and its reset time. */
function quotaWindow(w: QuotaWindow, now: Date, { Box, Text }: BandElements) {
  const percent = Math.round(w.percentUsed)
  const tone = toneOf(percent)
  const filled = filledCells(percent, BAR_WIDTH)
  const reset = resetLabel(w.resetsAt, now)
  return (
    <Box key={w.kind} flexDirection="row" alignItems="center" columnGap={1}>
      <Text size="caption" color="inactive">{labelOf(w.kind)}</Text>
      <Box flexDirection="row" width={BAR_WIDTH} height={1}>
        {filled > 0 ? <Box width={filled} height={1} backgroundColor="claude" /> : null}
        {BAR_WIDTH > filled ? <Box width={BAR_WIDTH - filled} height={1} backgroundColor={TRACK} /> : null}
      </Box>
      <Text size="body" weight="semibold" tabular color={tone}>{`${percent}%`}</Text>
      {reset ? <Text size="caption" color="inactive" tabular>{`↻ ${reset}`}</Text> : null}
    </Box>
  )
}

/** The quota: one item per window, in a row. */
function quotaRow(view: BandView, els: BandElements) {
  const { Box, Text } = els
  if (view.windows.length === 0) return <Text size="caption" color="inactive">no data yet</Text>
  return (
    <Box flexDirection="row" alignItems="center" columnGap={3}>
      {view.windows.map(w => quotaWindow(w, view.now, els))}
    </Box>
  )
}

/** The speed items: the model in use, the light while a step runs, the speeds, and the session's cost. */
function speedItems(view: BandView, { Box, Text }: BandElements) {
  return (
    <Box flexDirection="row" alignItems="flex-end" columnGap={2}>
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
 * The band on the desktop app: one row, with the speed on the left and the quota on the right, and no card around
 * them. When the band is too narrow for both, the quota moves to a row of its own. The terminal draws the band as
 * text, in register.tsx.
 */
export function desktopBand(view: BandView, els: BandElements) {
  const { Box } = els
  return (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={3} rowGap={1} marginTop={1} paddingX={2}>
      {speedItems(view, els)}
      <Box flexGrow={1} />
      {quotaRow(view, els)}
    </Box>
  )
}
