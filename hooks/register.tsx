import type { Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { QuotaWindow } from '../types'

import { barCells, labelOf, resetLabel, toneOf } from './format'

const windows = atom(
  { plugin: 'account-quota', key: 'windows' } as const,
  [] as QuotaWindow[],
)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const reading = await $.session.usage()
    await update($, windows, () => reading.rateLimits)

    return next(e)
  })

  // Pushed by the engine when a window moves a whole point, so the line
  // refreshes without polling.
  on('session.measure', async ($, e, next) => {
    await update($, windows, () => e.rateLimits)

    return next(e)
  })

  // Draws the engine's hint line as it stands, with the quota after it, so the
  // figures sit right under the input and keep their theme colors.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const rows = await read($, windows)
    const now = new Date(await $.clock.now())
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text dimColor>{e.props.hint}</Text>
        <Text color="claude" bold>
          {'   Quota  '}
        </Text>
        {rows.length === 0 ? (
          <Text color="inactive">no data yet</Text>
        ) : (
          rows.map((w, i) => {
            const percent = Math.round(w.percentUsed)
            const tone = toneOf(percent)
            const cells = barCells(percent)
            const reset = resetLabel(w.resetsAt, now)

            return (
              <Box key={w.kind} flexDirection="row">
                {i > 0 ? <Text color="inactive">{'   ·   '}</Text> : null}
                <Text color="inactive">{labelOf(w.kind)} </Text>
                <Text color={tone}>{cells.filled}</Text>
                <Text color="subtle">{cells.empty}</Text>
                <Text color={tone}>{` ${percent}%`}</Text>
                {reset ? <Text color="inactive">{`  resets ${reset}`}</Text> : null}
              </Box>
            )
          })
        )}
      </Box>
    )
  })
}
