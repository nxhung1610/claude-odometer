import { expect, test } from 'claude-code/testing'

import { formatElapsed, formatTps, formatTtft, speedLine, tpsOf } from './timing'

test('time to first output reads in milliseconds, then seconds', () => {
  expect(formatTtft(850)).toBe('850ms')
  expect(formatTtft(1200)).toBe('1.2s')
})

test('output speed reads in whole tokens per second', () => {
  expect(formatTps(41.6)).toBe('42 tok/s')
})

test('elapsed time reads in whole seconds', () => {
  expect(formatElapsed(12_400)).toBe('12s')
  expect(formatElapsed(-5)).toBe('0s')
})

test('output speed divides a step\'s output by the time from its first output to its stop', () => {
  // 300 tokens over the 2 seconds after the first output.
  expect(tpsOf(300, 1000, 3000)).toBe(150)
  expect(tpsOf(0, 1000, 3000)).toBeUndefined()
  expect(tpsOf(300, 3000, 3000)).toBeUndefined()
})

test('a step shorter than half a second gives no speed', () => {
  expect(tpsOf(300, 1000, 1200)).toBeUndefined()
})

test('the speed row shows dashes before any step, then the latest figures', () => {
  expect(speedLine(null, undefined, undefined, 0)).toBe('TTFT — · TPS —')
  expect(speedLine(null, 1200, 245, 0)).toBe('TTFT 1.2s · TPS 245 tok/s')
})

test('while a step runs, the row counts its time and waits for its first output', () => {
  expect(speedLine({ startedAt: 1000, firstOutputAt: 0 }, 900, 245, 4400)).toBe(
    'working 3s · TTFT … · last TPS 245 tok/s',
  )
  expect(speedLine({ startedAt: 1000, firstOutputAt: 1400 }, 400, undefined, 4400)).toBe(
    'working 3s · TTFT 400ms · last TPS —',
  )
})
