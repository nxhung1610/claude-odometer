import { expect, test } from 'claude-code/testing'

import { CONTEXT_GROUPS, shareOf } from './context'
import { compactTokens, filledCells, resetIn, toneOf } from './format'
import { speedLine } from './timing'
import { colorOf, formatTokens } from './tokens'

// docs/gen-visuals.mjs draws the terminal illustrations with its own copies of these rules, thresholds, colours and
// formats. When one of them changes here, this test fails, and the copy in docs/gen-visuals.mjs has to change to match.

test('the illustrations use the thresholds, the bar rule and the colours of the mod', () => {
  expect([69, 70, 89, 90].map(percent => toneOf(percent))).toEqual(['success', 'warning', 'warning', 'error'])
  expect([1, 23, 75, 100].map(percent => filledCells(percent, 10))).toEqual([1, 2, 8, 10])
  expect(CONTEXT_GROUPS.filter(group => group.key !== 'other').map(group => group.color)).toEqual([
    '#3987e5',
    '#8e6fd8',
    '#2aa198',
    '#d56aa0',
  ])
  expect(colorOf('claude-opus-5-5')).toBe('#d95926')
  expect(colorOf('claude-sonnet-5-5')).toBe('#3987e5')
  expect(colorOf('claude-haiku-5-5')).toBe('#199e70')
})

test('the illustrations count tokens, shares and reset times the way the mod does', () => {
  expect(compactTokens(92_000)).toBe('92k')
  expect(compactTokens(999_499)).toBe('999k')
  expect(compactTokens(999_500)).toBe('1.0M')
  expect(formatTokens(2_900_000)).toBe('2.9M')
  expect(formatTokens(230_500)).toBe('230.5k')
  expect(shareOf(0.5, 100)).toBe('<1%')
  expect(shareOf(31, 100)).toBe('31%')

  const now = new Date(2026, 9, 14, 12, 0)
  expect(resetIn(new Date(2026, 9, 14, 18, 20).toISOString(), now)).toBe('6h 20m')
  expect(resetIn(new Date(2026, 9, 15, 9, 0).toISOString(), now)).toBe('21h 0m')
  expect(resetIn(new Date(2026, 9, 16, 9, 0).toISOString(), now)).toBe('1d 21h')
  expect(speedLine(null, 850, 42, 0)).toBe('TTFT 850ms · TPS 42 tok/s')
})
