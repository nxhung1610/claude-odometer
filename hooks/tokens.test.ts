import { expect, test } from 'claude-code/testing'

import type { TokenScan } from '../types'

import {
  axisLabels,
  chartRows,
  colorOf,
  columnsOf,
  columnsWithSegments,
  daysInRange,
  dayLabel,
  formatShare,
  formatTokens,
  modelName,
  rankEntries,
  sumModels,
} from './tokens'

const SCAN: TokenScan = {
  sessions: 2,
  days: {
    '2026-10-12': { 'claude-haiku-5-5': { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
    '2026-10-13': {
      'claude-haiku-5-5': { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
      'claude-sonnet-5-5': { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  },
}

const OPUS = '#d95926'
const SONNET = '#3987e5'
const HAIKU = '#199e70'

test('model ids read as their names', () => {
  expect(modelName('claude-haiku-5-5')).toBe('Haiku 5.5')
  expect(modelName('claude-opus-4-8')).toBe('Opus 4.8')
  expect(modelName('mystery-model')).toBe('mystery-model')
})

test('dated snapshot ids and the older id order read as their names too', () => {
  expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelName('claude-opus-4-1-20250805')).toBe('Opus 4.1')
  expect(modelName('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(modelName('claude-3-opus-20240229')).toBe('Opus 3')
  expect(modelName('claude-sonnet-4-5-2025')).toBe('claude-sonnet-4-5-2025')
})

test('token counts read in k, M and B, and shares to one decimal', () => {
  expect(formatTokens(1.8e9)).toBe('1.8B')
  expect(formatTokens(230.5e6)).toBe('230.5M')
  expect(formatTokens(3500)).toBe('3.5k')
  expect(formatTokens(364)).toBe('364')
  expect(formatShare(99.34)).toBe('99.3%')
})

test('a range lists its days, oldest first, ending today', () => {
  const today = new Date(2026, 9, 13, 12, 0)

  const week = daysInRange('week', today, SCAN)
  expect(week.length).toBe(7)
  expect(week[0]).toBe('2026-10-07')
  expect(week[6]).toBe('2026-10-13')

  const month = daysInRange('month', today, SCAN)
  expect(month.length).toBe(30)
  expect(month[0]).toBe('2026-09-14')

  const all = daysInRange('all', today, SCAN)
  expect(all[0]).toBe('2026-10-12')
  expect(all.length).toBe(2)
})

test('long ranges group days into at most the columns asked for', () => {
  const days = Array.from({ length: 61 }, (_, i) => `day-${i}`)
  const groups = columnsOf(days, 30)
  expect(groups.length).toBe(21)
  expect(groups.every(group => group.length <= 3)).toBe(true)
  expect(columnsOf(days.slice(0, 7), 30).length).toBe(7)
})

test('a day label reads as month and day', () => {
  expect(dayLabel('2026-10-08')).toBe('Oct 8')
})

test('sums per model, ranked by total', () => {
  const totals = sumModels(SCAN, ['2026-10-12', '2026-10-13'])
  expect(totals['claude-haiku-5-5']?.input).toBe(11)
  expect(totals['claude-haiku-5-5']?.cacheWrite).toBe(44)
  expect(rankEntries(totals).map(([id]) => id)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5'])
})

test('each column carries its models in the order given', () => {
  const columns = columnsWithSegments(
    SCAN,
    ['2026-10-12', '2026-10-13'],
    ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    30,
  )
  expect(columns.map(column => column.label)).toEqual(['2026-10-12', '2026-10-13'])
  expect(columns[1]?.segments[1]?.tokens).toBe(100)
  expect(columns[1]?.total).toBe(200)
})

test('a column stacks its models from the bottom, eight levels to a row', () => {
  const columns = [
    { label: 'a', total: 100, segments: [{ model: 'claude-haiku-5-5', tokens: 100 }] },
    { label: 'b', total: 50, segments: [{ model: 'claude-opus-5-5', tokens: 50 }] },
    { label: 'c', total: 10, segments: [{ model: 'claude-sonnet-5-5', tokens: 10 }] },
    {
      label: 'd',
      total: 100,
      segments: [
        { model: 'claude-haiku-5-5', tokens: 50 },
        { model: 'claude-opus-5-5', tokens: 50 },
      ],
    },
  ]
  const grid = chartRows(columns, 100)

  expect(grid.length).toBe(8)
  // grid[0] is the top row, grid[7] the bottom one.
  expect(grid[0]?.[0]?.char).toBe('█')
  expect(grid[0]?.[1]?.char).toBe(' ')
  expect(grid[4]?.[1]?.char).toBe('█')
  expect(grid[4]?.[1]?.color).toBe(OPUS)
  expect(grid[7]?.[2]?.char).toBe('▆')
  expect(grid[7]?.[2]?.color).toBe(SONNET)
  expect(grid[7]?.[3]?.color).toBe(HAIKU)
  expect(grid[3]?.[3]?.color).toBe(OPUS)
})

test('a day with any usage draws at least one level, even beside a much busier day', () => {
  const columns = [
    { label: 'busy', total: 2_000_000, segments: [{ model: 'claude-opus-5-5', tokens: 2_000_000 }] },
    { label: 'light', total: 50, segments: [{ model: 'claude-opus-5-5', tokens: 50 }] },
  ]
  const grid = chartRows(columns, 2_000_000)

  expect(grid[7]?.[1]?.char).toBe('▁')
  expect(grid[7]?.[1]?.color).toBe(OPUS)
  expect(grid[6]?.[1]?.char).toBe(' ')
})

test('the axis reads top, middle and bottom', () => {
  expect(axisLabels(1.8e9)).toEqual(['1.8B', '900.0M', '0'])
})

test('each model has its own color, none of them a status color', () => {
  const colors = [colorOf('claude-opus-5-5'), colorOf('claude-sonnet-5-5'), colorOf('claude-haiku-5-5')]
  expect(colors).toEqual([OPUS, SONNET, HAIKU])
  expect(new Set(colors).size).toBe(3)
  expect(colorOf('mystery-model')).toBe('inactive')
})
