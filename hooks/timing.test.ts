import { expect, test } from 'claude-code/testing'

import { FRAME_MS, applyStep, formatElapsed, formatTps, formatTtft, speedLine, sweepIndex, tpsOf } from './timing'

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

test('the light crosses working once per period, from left to right', () => {
  const lit: number[] = []
  for (let t = 0; t < 1500; t += FRAME_MS) {
    const index = sweepIndex(t)
    if (index !== undefined) lit.push(index)
  }
  // Every letter is lit in turn, and the light never moves back.
  expect([...new Set(lit)]).toEqual([0, 1, 2, 3, 4, 5, 6])
  expect(lit).toEqual([...lit].sort((a, b) => a - b))
})

test('the light repeats each period', () => {
  expect(sweepIndex(4_200)).toBe(sweepIndex(5_700))
})

test('a step sets its time to first output once, and its speed when it stops', () => {
  let speed = applyStep(null, { kind: 'start', at: 1000 })
  speed = applyStep(speed, { kind: 'output', at: 1850 })
  speed = applyStep(speed, { kind: 'output', at: 2400 })
  expect(speed.ttftMs).toBe(850)
  expect(speed.running).toEqual({ startedAt: 1000, firstOutputAt: 1850 })

  // 300 tokens over the 2 seconds from the first output to the stop.
  speed = applyStep(speed, { kind: 'stop', at: 3850, outputTokens: 300 })
  expect(speed).toEqual({ running: null, ttftMs: 850, tps: 150 })
})

test('a step with no output keeps the speed the step before it measured', () => {
  let speed = applyStep(null, { kind: 'start', at: 0 })
  speed = applyStep(speed, { kind: 'output', at: 500 })
  speed = applyStep(speed, { kind: 'stop', at: 2500, outputTokens: 200 })

  speed = applyStep(speed, { kind: 'start', at: 3000 })
  expect(speed.ttftMs).toBe(500)
  speed = applyStep(speed, { kind: 'stop', at: 3100, outputTokens: 0 })
  expect(speed).toEqual({ running: null, ttftMs: 500, tps: 100 })
})

test('a stream that ends without a stop still clears the running step', () => {
  let speed = applyStep(null, { kind: 'start', at: 0 })
  speed = applyStep(speed, { kind: 'end' })
  expect(speed).toEqual({ running: null })
})

test('an output with no step running changes nothing', () => {
  expect(applyStep(null, { kind: 'output', at: 10 })).toEqual({ running: null })
})
