import { expect, test } from 'claude-code/testing'

import { barCells, compactTokens, filledCells, formatCost, labelOf, resetLabel, toneOf } from './format'

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

test('a token count reads in k, or in M from a million', () => {
  expect(compactTokens(92_000)).toBe('92k')
  expect(compactTokens(200_000)).toBe('200k')
  expect(compactTokens(1_200_000)).toBe('1.2M')
})

test('a cost reads in dollars, and under a cent as less than one cent', () => {
  expect(formatCost(1.236)).toBe('$1.24')
  expect(formatCost(0)).toBe('$0.00')
  expect(formatCost(0.004)).toBe('<$0.01')
})
