import { expect, test } from 'claude-code/testing'

import { formatTps, formatTtft, tpsOf } from './timing'

test('time to first text reads in milliseconds, then seconds', () => {
  expect(formatTtft(850)).toBe('850ms')
  expect(formatTtft(1200)).toBe('1.2s')
})

test('output speed reads in whole tokens per second', () => {
  expect(formatTps(41.6)).toBe('42 tok/s')
})

test('output speed divides the output by the time after the first text', () => {
  // 300 tokens over the 2 seconds after the first text.
  expect(tpsOf(300, 1000, 3000)).toBe(150)
  expect(tpsOf(0, 1000, 3000)).toBeUndefined()
  expect(tpsOf(300, 3000, 3000)).toBeUndefined()
})
