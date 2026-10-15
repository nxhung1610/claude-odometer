import { expect, test } from 'claude-code/testing'

import { barCells, clip, compactTokens, filledCells, formatCost, labelOf, resetIn, resetLabel, resetsThatFit, toneOf } from './format'

test('the bar fills in proportion to the percentage', () => {
  expect(filledCells(0)).toBe(0)
  expect(filledCells(1)).toBe(1)
  expect(filledCells(23)).toBe(2)
  expect(filledCells(91)).toBe(9)
  expect(filledCells(150)).toBe(10)
  expect(barCells(23).filled.length + barCells(23).empty.length).toBe(10)
})

test('the tone follows the thresholds', () => {
  expect(toneOf(69)).toBe('success')
  expect(toneOf(70)).toBe('warning')
  expect(toneOf(89)).toBe('warning')
  expect(toneOf(90)).toBe('error')
})

test('known window kinds get short labels', () => {
  expect(labelOf('five_hour')).toBe('5h')
  expect(labelOf('seven_day')).toBe('7d')
  expect(labelOf('other')).toBe('other')
})

test('a reset today shows the time, another day shows the weekday', () => {
  const now = new Date(2026, 9, 12, 9, 0)
  const today = new Date(2026, 9, 12, 14, 20).toISOString()
  const later = new Date(2026, 9, 14, 14, 0).toISOString()

  expect(resetLabel(today, now)).toBe('14:20')
  expect(resetLabel(later, now)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) 14:00$/)
  expect(resetLabel(undefined, now)).toBe('')
  expect(resetLabel('not a date', now)).toBe('')
})

test('the time left reads in hours and minutes, or in days and hours from a day away', () => {
  const now = new Date(2026, 9, 14, 12, 0)

  expect(resetIn(new Date(2026, 9, 14, 14, 20).toISOString(), now)).toBe('2h 20m')
  expect(resetIn(new Date(2026, 9, 14, 12, 45).toISOString(), now)).toBe('45m')
  expect(resetIn(new Date(2026, 9, 16, 14, 0).toISOString(), now)).toBe('2d 2h')
  expect(resetIn(new Date(2026, 9, 14, 11, 0).toISOString(), now)).toBe('0m')
  expect(resetIn(undefined, now)).toBe('')
  expect(resetIn('not a date', now)).toBe('')
})

test('a token count reads in k, or in M from a million', () => {
  expect(compactTokens(92_000)).toBe('92k')
  expect(compactTokens(200_000)).toBe('200k')
  expect(compactTokens(1_200_000)).toBe('1.2M')
  expect(compactTokens(364)).toBe('364')
})

test('text longer than its limit is cut with an ellipsis', () => {
  expect(clip('Opus 5.5', 18)).toBe('Opus 5.5')
  expect(clip('anthropic.claude-3-5-sonnet-20240620-v1:0', 18)).toBe('anthropic.claude-…')
})

test('a cost reads in dollars, and under a cent as less than one cent', () => {
  expect(formatCost(1.236)).toBe('$1.24')
  expect(formatCost(0)).toBe('$0.00')
  expect(formatCost(0.004)).toBe('<$0.01')
})

test('a count from 999.5k reads in millions, so it never shows as 1000k', () => {
  expect(compactTokens(999_499)).toBe('999k')
  expect(compactTokens(999_500)).toBe('1.0M')
})

test('a window kind the table does not name is cut to eight characters', () => {
  expect(labelOf('seven_day_opus_extra')).toBe('seven_d…')
})

test('the last resets go first when the quota line is too wide for them', () => {
  const windows = [
    { label: '5h', badge: ' 23% ', reset: '14:20' },
    { label: '7d', badge: ' 75% ', reset: 'Tue 09:00' },
    { label: 'spend', badge: ' 40% ', reset: 'Tue 09:00' },
  ]
  expect(resetsThatFit(windows, 93, 10, false)).toEqual([true, true, false])
  expect(resetsThatFit(windows, 101, 10, true)).toEqual([true, true, false])
  expect(resetsThatFit(windows, 200, 10, false)).toEqual([true, true, true])
  expect(resetsThatFit([{ label: '5h', badge: ' 23% ', reset: '' }], 93, 10, false)).toEqual([false])
})

