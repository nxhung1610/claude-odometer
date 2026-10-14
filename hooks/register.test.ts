import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = new Date(2026, 9, 14, 12, 0)
const TODAY = '2026-10-14'
const TERMINAL = 'terminal' as const
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const WIDE = { columns: 140, rows: 40 }
const PANE = {
  title: 'Tokens per day',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const QUOTA = { plugin: 'account-quota', surface: TERMINAL, component: 'PromptHint' as const, props: HINT, viewport: WIDE }
const TOKENS_PANE = { plugin: 'account-quota', surface: TERMINAL, component: 'Pane' as const, requestId: 'tokens', props: PANE, viewport: WIDE }
const TOKENS = {
  command: 'tokens',
  args: '',
  origin: { kind: 'sdk' as const },
  presentation: { isFullscreen: true, columns: 140 },
}
const SCAN = {
  sessions: 2,
  days: { [TODAY]: { 'claude-opus-5-5': { input: 100, output: 50, cacheRead: 200, cacheWrite: 10 } } },
}

type RateWindow = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * What the engine answers beneath the mod, which a test gives itself: a session
 * with these rate-limit windows, and the commands and panes the mod registers
 * and opens.
 */
function engine(on: On, rateLimits: RateWindow[] = []) {
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.usage', () => ({ value: { startedAt: NOW.getTime(), context: { window: 200_000 }, rateLimits } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

/** What `$.process.run` answers once the child has exited. */
function ran(exitCode: number, stdout = '', stderr = '') {
  return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
}

test('session start reads the rate-limit windows into the quota line', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [
    { kind: 'five_hour', percentUsed: 23.4, resetsAt: new Date(2026, 9, 14, 14, 20).toISOString() },
    { kind: 'seven_day', percentUsed: 91, resetsAt: new Date(2026, 9, 16, 14, 0).toISOString() },
  ])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: '5h' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 23%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 91%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↻ 14:20' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↻ \w{3} 14:00/ })).toBeDefined()
  await ui.unmount()
})

test('a rate-limit change moves the quota line to the new reading', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [{ kind: 'five_hour', percentUsed: 23 }])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 45 }],
    changed: ['rateLimits'],
  })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: ' 45%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 23%' })).toBeUndefined()
  await ui.unmount()
})

test('/tokens runs the scanner, and the pane shows what it found', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  const runs: string[][] = []
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: ran(0, JSON.stringify(SCAN)) }
  })

  const reply = await $.command.run(TOKENS)
  expect(reply.text).toBe('Tokens pane updated.')
  expect(runs).toHaveLength(1)
  expect(runs[0]?.slice(0, 2)).toEqual(['python3', '-I'])
  expect(runs[0]?.[2]?.endsWith('hooks/scan_usage.py')).toBe(true)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: '360 tokens across 2 sessions' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'In: 100 · Out: 50' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Cache: 200 read · 10 write' })).toBeDefined()
  await ui.unmount()
})

test('the chart axis runs from the first day of the range to the last', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  const old = { 'claude-opus-5-5': { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } }
  on('process.run', () => ({ value: ran(0, JSON.stringify({ sessions: 1, days: { '2026-03-01': old } })) }))
  await $.command.run(TOKENS)

  // Narrow enough that the 228 days of "all time" are grouped into columns.
  const ui = await $.ui.mount({ ...TOKENS_PANE, viewport: { columns: 80, rows: 40 } })
  await ui.press({ key: 'all' })
  expect(await ui.find({ type: 'Text', text: 'Mar 1 … Oct 14' })).toBeDefined()
  await ui.unmount()
})

test('a scan that fails says why, with the first line of its error', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  on('process.run', () => ({ value: ran(1, '', 'python3: command not found\nsecond line\n') }))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: 'Could not read the transcripts: python3: command not found' })).toBeDefined()
  await ui.unmount()
})
