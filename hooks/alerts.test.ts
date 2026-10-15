import { expect, test } from 'claude-code/testing'

import { contextAlert, limitAlert, minutesToFull, passed, spanText } from './alerts'

test('a reading passes the alert line once, from below', () => {
  expect(passed(undefined, 95)).toBe(false)
  expect(passed(85, 89)).toBe(false)
  expect(passed(85, 90)).toBe(true)
  expect(passed(90, 95)).toBe(false)
})

test('the time to 100% follows the pace between two readings', () => {
  expect(minutesToFull({ percent: 85, at: 0 }, { percent: 91, at: 60_000 })).toBe(1.5)
  expect(minutesToFull({ percent: 91, at: 0 }, { percent: 91, at: 60_000 })).toBeUndefined()
  expect(minutesToFull({ percent: 91, at: 60_000 }, { percent: 90, at: 120_000 })).toBeUndefined()
})

test('a span of time reads in minutes, then in hours and minutes', () => {
  expect(spanText(1.5)).toBe('about 2 min')
  expect(spanText(90)).toBe('about 1h 30m')
})

test('the limit toast gives its share and, when there is a pace, the time left', () => {
  const window = { kind: 'five_hour', percentUsed: 91 }
  expect(limitAlert(window, 1.5, new Date())).toBe('5h at 91%, about 2 min to 100% at this pace')
  expect(limitAlert(window, undefined, new Date())).toBe('5h at 91%')
})

test('the context toast suggests a compaction', () => {
  expect(contextAlert(91.4)).toBe('Context at 91%: consider /compact soon')
})
