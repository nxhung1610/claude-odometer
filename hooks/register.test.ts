import type { CommandSpec, On, TurnStepInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

const NOW = new Date(2026, 9, 14, 12, 0)
const TODAY = '2026-10-14'
const TERMINAL = 'terminal' as const
const WIDE = { columns: 140, rows: 40 }
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
}
const PANE = {
  title: 'Tokens per day',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}
const QUOTA = { plugin: 'odometer', surface: TERMINAL, component: 'AbovePrompt' as const, props: BAND }
const TOKENS_PANE = { plugin: 'odometer', surface: TERMINAL, component: 'Pane' as const, requestId: 'tokens', props: PANE, viewport: WIDE }
const TOKENS = {
  command: 'tokens',
  args: '',
  origin: { kind: 'sdk' as const },
  presentation: { isFullscreen: true, columns: 140 },
}
const SCAN = {
  root: '/home/me/.claude/projects',
  sessions: { week: 2, month: 2, all: 2 },
  days: { [TODAY]: { 'claude-opus-5-5': { input: 100, output: 50, cacheRead: 200, cacheWrite: 10 } } },
}

type RateWindow = { kind: string; percentUsed: number; resetsAt?: string }

type ContextReading = {
  window: number
  percent?: number
  tokens?: number
  breakdown?: { categories: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[] }
}

/**
 * What the engine answers beneath the mod, which a test gives itself: a session
 * with these rate-limit windows, and the commands and panes the mod registers
 * and opens. Each command the mod registers is pushed onto `commands`.
 */
function engine(on: On, rateLimits: RateWindow[] = [], commands: CommandSpec[] = [], context: ContextReading = { window: 200_000 }, spend?: number) {
  on('session.start', () => ({ cwd: '/tmp' }))
  on('session.usage', () => ({ value: { startedAt: NOW.getTime(), context: context as never, rateLimits, cost: spend === undefined ? undefined : { usd: spend } } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('command.register', (_, e) => {
    commands.push(e)
    return { value: { command: e.name } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

/** What `$.process.run` answers once the child has exited. */
function ran(exitCode: number, stdout = '', stderr = '') {
  return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
}

/**
 * A machine with Python 3 as `python3`: its version probe passes, and the
 * scanner's run answers what `scan` returns. `runs` keeps each call's argv.
 */
function withPython(on: On, scan: () => ReturnType<typeof ran>, runs: string[][] = []) {
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: e.argv.includes('--version') ? ran(0, 'Python 3.13.0') : scan() }
  })
}

/** The scanner's own runs out of `runs`, the version probes left out. */
function scans(runs: string[][]) {
  return runs.filter(argv => argv.includes('-I'))
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

test('/tokens is registered to run at once when typed mid-turn', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  const commands: CommandSpec[] = []
  engine(on, [], commands)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  expect(commands.find(command => command.name === 'tokens')?.immediate).toBe(true)
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
  withPython(on, () => ran(0, JSON.stringify(SCAN)), runs)

  const reply = await $.command.run(TOKENS)
  expect(reply.text).toBe('Tokens pane updated.')
  expect(scans(runs)).toHaveLength(1)
  expect(scans(runs)[0]?.slice(0, 2)).toEqual(['python3', '-I'])
  expect(scans(runs)[0]?.[2]?.endsWith('hooks/scan_usage.py')).toBe(true)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: '360 tokens across 2 sessions' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'In: 100 · Out: 50' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Cache: 200 read · 10 write' })).toBeDefined()
  await ui.unmount()
})

test('python is the command where python3 is missing, as on Windows', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  const runs: string[][] = []
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    if (e.argv[0] === 'python3') return { deny: 'spawn python3 ENOENT' }
    return { value: e.argv.includes('--version') ? ran(0, 'Python 3.13.0') : ran(0, JSON.stringify(SCAN)) }
  })
  await $.command.run(TOKENS)

  expect(scans(runs).map(argv => argv[0])).toEqual(['python'])
  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: '360 tokens across 2 sessions' })).toBeDefined()
  await ui.unmount()
})

test('a machine with no Python 3 says so in the pane', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  on('process.run', () => ({ deny: 'spawn ENOENT' }))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: 'Could not read the transcripts: Python 3 was not found' })).toBeDefined()
  await ui.unmount()
})

test('a scan whose reply is cut short says so, rather than failing to read it', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  withPython(on, () => ({ ...ran(0, JSON.stringify(SCAN)), isStdoutTruncated: true }))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: 'Could not read the transcripts: The scan printed more than 4 MiB, too much to read' })).toBeDefined()
  await ui.unmount()
})

test('the chart axis runs from the first day of the range to the last', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  const old = { 'claude-opus-5-5': { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } }
  withPython(on, () => ran(0, JSON.stringify({ sessions: { week: 0, month: 0, all: 1 }, days: { '2026-03-01': old } })))
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
  withPython(on, () => ran(1, '', 'python3: command not found\nsecond line\n'))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: 'Could not read the transcripts: python3: command not found' })).toBeDefined()
  await ui.unmount()
})

test('the footer counts the sessions in the range shown, and all time counts every session', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  withPython(on, () => ran(0, JSON.stringify({
    sessions: { week: 2, month: 2, all: 3 },
    days: {
      [TODAY]: { 'claude-opus-5-5': { input: 100, output: 50, cacheRead: 200, cacheWrite: 10 } },
      '2026-03-01': { 'claude-opus-5-5': { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
    },
  })))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: '360 tokens across 2 sessions' })).toBeDefined()
  await ui.press({ key: 'all' })
  expect(await ui.find({ type: 'Text', text: '361 tokens across 3 sessions' })).toBeDefined()
  await ui.unmount()
})

test('the footer says session in the singular for one session', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  withPython(on, () => ran(0, JSON.stringify({
    root: '/home/me/.claude/projects',
    sessions: { week: 1, month: 1, all: 1 },
    days: { [TODAY]: { 'claude-opus-5-5': { input: 100, output: 50, cacheRead: 200, cacheWrite: 10 } } },
  })))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: '360 tokens across 1 session.' })).toBeDefined()
  await ui.unmount()
})

test('a range with no tokens says so when other days have usage', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  withPython(on, () => ran(0, JSON.stringify({
    root: '/home/me/.claude/projects',
    sessions: { week: 0, month: 0, all: 1 },
    days: { '2026-03-01': { 'claude-opus-5-5': { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } } },
  })))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: 'No tokens in this range.' })).toBeDefined()
  await ui.unmount()
})

test('a folder with no transcripts that have usage says where it looked', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  withPython(on, () => ran(0, JSON.stringify({ root: '/custom/projects', sessions: { week: 0, month: 0, all: 0 }, days: {} })))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: 'No transcripts with usage found in /custom/projects.' })).toBeDefined()
  await ui.unmount()
})

test('a narrow band draws the quota with a 6-cell bar', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [{ kind: 'five_hour', percentUsed: 23 }])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount({ ...QUOTA, props: { ...BAND, bodyColumns: 60 } })
  // 23% of 6 cells is one filled cell, so five stay empty.
  expect(await ui.find({ type: 'Text', text: /^─{5}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^─{8}$/ })).toBeUndefined()
  await ui.unmount()
})

test('a wide band draws the quota with a 10-cell bar', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [{ kind: 'five_hour', percentUsed: 23 }])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount({ ...QUOTA, props: { ...BAND, bodyColumns: 100 } })
  // 23% of 10 cells is two filled cells, so eight stay empty.
  expect(await ui.find({ type: 'Text', text: /^─{8}$/ })).toBeDefined()
  await ui.unmount()
})

test('session start shows the context card, with a dash before the first response', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: 'context' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '—' })).toBeDefined()
  await ui.unmount()
})

test('the context badge is green below 70%, yellow from 70% and red from 90%', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], { window: 200_000, percent: 69 })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  let ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: ' 69% ' })).toMatchObject({ children: [{ props: { backgroundColor: 'green' } }] })
  await ui.unmount()

  await $.session.measure({ context: { window: 200_000, percent: 70 }, rateLimits: [], changed: ['context'] })
  ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: ' 70% ' })).toMatchObject({ children: [{ props: { backgroundColor: 'yellow' } }] })
  await ui.unmount()

  await $.session.measure({ context: { window: 200_000, percent: 90 }, rateLimits: [], changed: ['context'] })
  ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: ' 90% ' })).toMatchObject({ children: [{ props: { backgroundColor: 'red' } }] })
  await ui.unmount()
})

test('a context change moves the card to the new fill', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], { window: 200_000, percent: 30 })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  await $.session.measure({
    context: { window: 200_000, percent: 92 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: ' 92% ' })).toMatchObject({ children: [{ props: { backgroundColor: 'red' } }] })
  expect(await ui.find({ type: 'Text', text: ' 30% ' })).toBeUndefined()
  await ui.unmount()
})

test('the context card shows from 24 columns, and stays off below', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], { window: 200_000, percent: 30 })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  let ui = await $.ui.mount({ ...QUOTA, props: { ...BAND, bodyColumns: 23 } })
  expect(await ui.find({ type: 'Text', text: 'context' })).toBeUndefined()
  await ui.unmount()

  ui = await $.ui.mount({ ...QUOTA, props: { ...BAND, bodyColumns: 24 } })
  expect(await ui.find({ type: 'Text', text: 'context' })).toBeDefined()
  await ui.unmount()
})

test('the card shows the tokens against the window, on a narrow band too', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], { window: 200_000, percent: 46, tokens: 92_000 })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount({ ...QUOTA, props: { ...BAND, bodyColumns: 60 } })
  expect(await ui.find({ type: 'Text', text: /92k of 200k/ })).toMatchObject({
    children: [{ props: { dimColor: true } }, { props: { backgroundColor: 'green' }, children: [' 46% '] }],
  })
  await ui.unmount()
})

test('after a compaction the context fill is a dash again, until the next response', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], { window: 200_000, percent: 45 })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'] })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: '—' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 45% ' })).toBeUndefined()
  await ui.unmount()
})

const MAIN: TurnStepInput = { turnId: 'turn-1', index: 0, model: 'claude-haiku-5-5', messageCount: 1 }
const SUB: TurnStepInput = { ...MAIN, agentId: 'sub-1' }

/** One model step's timing in ms: its first text comes `firstAfter` after the step is asked for, its stop `stopAfter` after the next ask. */
type StepTiming = { firstAfter: number; stopAfter: number; outputTokens: number }

/**
 * The model beneath the mod for `turn.step`. Each step waits as `timing` says for its agent (none on the main
 * conversation), writes one text chunk, then stops with the output tokens it was given.
 */
function model(on: On, clock: MockClock, timing: (agentId: string | undefined) => StepTiming) {
  on('turn.step', async function* (_, e) {
    const { firstAfter, stopAfter, outputTokens } = timing(e.agentId)
    await clock.sleep(firstAfter)
    yield { kind: 'text', index: 0, text: 'hi' }
    await clock.sleep(stopAfter)
    yield {
      kind: 'stop',
      stopReason: 'end_turn',
      usage: {
        model: MAIN.model,
        input_tokens: 10,
        output_tokens: outputTokens,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    }
  })
}

/** Stops a step's stream before it ends, as a consumer that stops reading does, so the mod's cleanup runs. */
function stopStep(step: AsyncGenerator<unknown, unknown>) {
  return step.return(undefined)
}

test('a step the consumer cuts short clears the running step, and keeps its time to first output', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 5000, outputTokens: 100 }))

  const step = $.turn.step(MAIN)
  const first = step.next()
  await clock.settle()
  await clock.advance(500)
  await first
  await stopStep(step)

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /TTFT 500ms/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /working/ })).toBeUndefined()
  await ui.unmount()
})

test('a finished step shows its time to first output and its output speed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 2000, outputTokens: 100 }))

  const step = $.turn.step(MAIN)
  const first = step.next()
  await clock.settle()
  await clock.advance(500)
  await first
  const last = step.next()
  await clock.settle()
  await clock.advance(2000)
  await last
  await stopStep(step)

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /TTFT 500ms · TPS 50 tok\/s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /working/ })).toBeUndefined()
  await ui.unmount()
})

test('a step that fails mid-stream still clears the running step', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  on('turn.step', async function* () {
    await clock.sleep(500)
    yield { kind: 'text', index: 0, text: 'hi' }
    await clock.sleep(1000)
    throw new Error('the stream broke')
  })

  const step = $.turn.step(MAIN)
  const first = step.next()
  await clock.settle()
  await clock.advance(500)
  await first
  const failing = step.next().then(() => 'finished', () => 'failed')
  await clock.settle()
  await clock.advance(1000)
  expect(await failing).toBe('failed')

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /working/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /TTFT 500ms/ })).toBeDefined()
  await ui.unmount()
})

test('while a step runs, the row counts its seconds beside its time to first output', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 10_000, outputTokens: 100 }))

  const step = $.turn.step(MAIN)
  const first = step.next()
  await clock.settle()
  await clock.advance(500)
  await first
  await clock.advance(1500) // 2.0 s into the step

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: / 2s · TTFT 500ms · last TPS —/ })).toBeDefined()
  await ui.unmount()
  await stopStep(step)
})

test("a sub-agent's step that overlaps the main step leaves the main step's reading alone", async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  model(on, clock, agentId =>
    agentId === undefined
      ? { firstAfter: 1000, stopAfter: 1500, outputTokens: 100 }
      : { firstAfter: 700, stopAfter: 300, outputTokens: 40 },
  )

  const main = $.turn.step(MAIN)
  const mainFirst = main.next()
  await clock.settle()
  await clock.advance(500) // 0.5 s: a sub-agent's step starts while the main step runs
  const sub = $.turn.step(SUB)
  const subFirst = sub.next()
  await clock.settle()
  await clock.advance(700) // 1.2 s: the main step's text came at 1.0 s, the sub-agent's at 1.2 s
  await mainFirst
  await subFirst
  const subStop = sub.next()
  await clock.settle()
  await clock.advance(300) // 1.5 s: the sub-agent stops, and the main step is still running
  await subStop

  let ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: / 1s · TTFT 1.0s · last TPS —/ })).toBeDefined()
  await ui.unmount()

  const mainStop = main.next()
  await clock.settle()
  await clock.advance(1500) // 3.0 s: the main step stops, 2.0 s after its first text
  await mainStop

  ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /TTFT 1.0s · TPS 50 tok\/s/ })).toBeDefined()
  await ui.unmount()
  await stopStep(sub)
  await stopStep(main)
})

test("a sub-agent's step alone leaves the speed row at its dashes", async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 1000, outputTokens: 40 }))

  const sub = $.turn.step(SUB)
  const first = sub.next()
  await clock.settle()
  await clock.advance(500)
  await first

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /TTFT —/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /working/ })).toBeUndefined()
  await ui.unmount()
  await stopStep(sub)
})

const OPUS: TurnStepInput = { ...MAIN, model: 'claude-opus-5-5', effort: 'high' }

test('the speed row names the model that last answered, with its effort', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 5000, outputTokens: 100 }))

  const step = $.turn.step(OPUS)
  const first = step.next()
  await clock.settle()
  await clock.advance(500)
  await first
  await stopStep(step)

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(high\)/ })).toBeDefined()
  await ui.unmount()
})

test('the model and the cost leave the speed row on a narrow band', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], { window: 200_000 }, 1.236)
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 5000, outputTokens: 100 }))
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const step = $.turn.step(OPUS)
  const first = step.next()
  await clock.settle()
  await clock.advance(500)
  await first
  await stopStep(step)

  let ui = await $.ui.mount({ ...QUOTA, props: { ...BAND, bodyColumns: 89 } })
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.24/ })).toBeUndefined()
  await ui.unmount()

  ui = await $.ui.mount({ ...QUOTA, props: { ...BAND, bodyColumns: 100 } })
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.24/ })).toBeDefined()
  await ui.unmount()
})

const CONTEXT_IN_USE: ContextReading = {
  window: 200_000,
  percent: 40,
  tokens: 80_000,
  breakdown: {
    categories: [
      { name: 'System prompt', tokens: 10_000, kind: 'used' },
      { name: 'Messages', tokens: 70_000, kind: 'used' },
      { name: 'Free space', tokens: 120_000, kind: 'free' },
    ],
  },
}

/** Every element of a drawing that `match` accepts, in document order. */
function drawnWhere(node: any, match: (element: any) => boolean, found: any[] = []): any[] {
  if (!node || typeof node !== 'object') return found
  if (match(node)) found.push(node)
  for (const child of node.children ?? []) drawnWhere(child, match, found)
  return found
}

/** The solid bars of a drawing, in order: each Box one row high with a colour, as its colour and width in cells. */
function barRuns(root: any): { color: string; cells: number }[] {
  return drawnWhere(root, el => el.type === 'Box' && el.props?.height === 1 && el.props?.backgroundColor !== undefined).map(el => ({
    color: el.props.backgroundColor,
    cells: el.props.width,
  }))
}

test("the terminal's context bar takes one colour per group in use, and the free space a thin line", async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], CONTEXT_IN_USE)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  // At 140 columns the bar is 136 cells: 7 for the system prompt, 48 for messages, and 81 of free space.
  const terminal = await $.ui.mount(QUOTA)
  expect(await terminal.find({ type: 'Text', text: /^█{7}$/ })).toMatchObject({ props: { color: '#3987e5' } })
  expect(await terminal.find({ type: 'Text', text: /^█{48}$/ })).toMatchObject({ props: { color: '#d56aa0' } })
  expect(await terminal.find({ type: 'Text', text: /^─{81}$/ })).toMatchObject({ props: { color: 'subtle' } })
  await terminal.unmount()
})

test('on the desktop app the quota windows sit side by side, each with its bar, its percentage and its reset', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [
    { kind: 'five_hour', percentUsed: 23, resetsAt: new Date(2026, 9, 14, 14, 20).toISOString() },
    { kind: 'seven_day', percentUsed: 75, resetsAt: new Date(2026, 9, 16, 14, 0).toISOString() },
  ])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  // At 140 columns the card is 136 cells inside: two windows of 66 cells, with 4 cells between them.
  const ui = await $.ui.mount({ ...QUOTA, surface: 'desktop' })
  const root: any = await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^23%$/ })).toMatchObject({ props: { size: 'heading', color: 'success' } })
  expect(await ui.find({ type: 'Text', text: /^75%$/ })).toMatchObject({ props: { size: 'heading', color: 'warning' } })
  expect(await ui.find({ type: 'Text', text: /^↻ 14:20$/ })).toBeDefined()
  // Each bar fills its share of its 66 cells: 23% is 15 cells, and 75% is 50.
  expect(barRuns(root)).toEqual([
    { color: 'success', cells: 15 },
    { color: 'subtle', cells: 51 },
    { color: 'warning', cells: 50 },
    { color: 'subtle', cells: 16 },
  ])
  await ui.unmount()
})

test('the tokens pane says how much context is in use, and what it holds', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], CONTEXT_IN_USE)
  withPython(on, () => ran(0, JSON.stringify(SCAN)))
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: 'Context now: 80k of 200k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Messages 70k/ })).toBeDefined()
  await ui.unmount()
})

test('a new session starts the speed row afresh, without the last model', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  engine(on)
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 5000, outputTokens: 100 }))

  const step = $.turn.step(OPUS)
  const first = step.next()
  await clock.settle()
  await clock.advance(500)
  await first
  await stopStep(step)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /TTFT —/ })).toBeDefined()
  await ui.unmount()
})

test('on the desktop app the tokens pane shows the total in large type, and each model as a bar of its share', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  withPython(on, () => ran(0, JSON.stringify(SCAN)))
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })
  await $.command.run(TOKENS)

  const ui = await $.ui.mount({ ...TOKENS_PANE, surface: 'desktop' })
  const root: any = await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^360$/ })).toMatchObject({ props: { size: 'heading' } })
  expect(await ui.find({ type: 'Text', text: /^tokens across 2 sessions$/ })).toBeDefined()
  // The one model has every token of the range, so its bar fills the whole of its track.
  expect(drawnWhere(root, el => el.type === 'Box' && el.props?.backgroundColor === '#d95926' && el.props?.flexGrow === 100)).toHaveLength(1)
  expect(drawnWhere(root, el => el.type === 'Button' && el.props?.label === 'Last 7 days')[0].props.variant).toBe('primary')
  await ui.unmount()
})

test('on the desktop app the chart stacks each day as solid columns, and the heatmap shades each hour by its share of the busiest', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  const hours = Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1000 : hour === 15 ? 500 : hour === 20 ? 100 : 0))
  withPython(on, () => ran(0, JSON.stringify({ ...SCAN, hours: { [TODAY]: hours } })))
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })
  await $.command.run(TOKENS)

  const ui = await $.ui.mount({ ...TOKENS_PANE, surface: 'desktop' })
  const root: any = await ui.drawn()
  // Today is the largest day, so its model fills the whole height of the chart.
  expect(drawnWhere(root, el => el.type === 'Box' && el.props?.backgroundColor === '#d95926' && el.props?.flexGrow === 1000)).toHaveLength(1)
  // Wednesday is today: the busiest hour takes the full colour, half of it the second step, a tenth the first.
  const wednesday = drawnWhere(root, el => el.props?.key === 'Wed')[0]
  const cells = wednesday.children.slice(1).map((cell: any) => cell.props.backgroundColor)
  expect(cells[9]).toBe('#d77757')
  expect(cells[15]).toBe('#d7775780')
  expect(cells[20]).toBe('#d7775740')
  expect(cells[0]).toBe('subtle')
  await ui.unmount()
})

test('on the desktop app the context now is one bar, each part as wide as its share of the window', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], CONTEXT_IN_USE)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount({ ...TOKENS_PANE, surface: 'desktop' })
  const root: any = await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^80k of 200k$/ })).toBeDefined()
  // Of the 200k window, the 10k of system prompt is 50 parts in 1,000, the 70k of messages 350, and the 120k free 600.
  expect(drawnWhere(root, el => String(el.props?.key ?? '').startsWith('part-')).map(el => [el.props.backgroundColor, el.props.flexGrow])).toEqual([
    ['#3987e5', 50],
    ['#d56aa0', 350],
    ['subtle', 600],
  ])
  await ui.unmount()
})

test('the tokens pane shows when tokens are used, by weekday and hour', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  const hours = Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1_000 : 0))
  withPython(on, () => ran(0, JSON.stringify({ ...SCAN, hours: { [TODAY]: hours } })))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: /Wed / })).toBeDefined() // TODAY, 2026-10-14, is a Wednesday
  expect(await ui.find({ type: 'Text', text: /less/ })).toBeDefined()
  await ui.unmount()
})

/** Collects the lines the mod raises with $.ui.toast. */
function collectToasts(on: On): string[] {
  const lines: string[] = []
  on('ui.toast', (_, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  return lines
}

test('a limit passing 90% raises a toast with the time left at its pace', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  const lines = collectToasts(on)
  engine(on, [{ kind: 'five_hour', percentUsed: 85 }])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })
  await clock.advance(60_000)

  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 91 }],
    changed: ['rateLimits'],
  })
  expect(lines).toEqual(['5h at 91%, about 2 min to 100% at this pace'])
})

test('a limit that stays above 90% raises no toast', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  const lines = collectToasts(on)
  engine(on, [{ kind: 'five_hour', percentUsed: 91 }])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 92 }],
    changed: ['rateLimits'],
  })
  expect(lines).toEqual([])
})

test('the context passing 90% raises a toast suggesting /compact', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  const lines = collectToasts(on)
  engine(on, [], [], { window: 200_000, percent: 85 })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  await $.session.measure({ context: { window: 200_000, percent: 91 }, rateLimits: [], changed: ['context'] })
  expect(lines).toEqual(['Context at 91%: consider /compact soon'])
})

test('the quota is the first row of the context card, and the speed row sits above the card', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [{ kind: 'five_hour', percentUsed: 23 }], [], { window: 200_000, percent: 46, tokens: 92_000 })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount(QUOTA)
  const root: any = await ui.drawn()
  expect(JSON.stringify(root.children[0])).toContain('TTFT')
  const card = root.children[1]
  expect(card.props.borderStyle).toBe('round')
  expect(JSON.stringify(card.children[0])).toContain('quota')
  expect(JSON.stringify(card.children[1])).toContain('context')
  await ui.unmount()
})

test('on the desktop app a narrow band stacks the quota windows, each as wide as the card', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [
    { kind: 'five_hour', percentUsed: 23 },
    { kind: 'seven_day', percentUsed: 75 },
  ])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  // At 60 columns the card is 56 cells inside, too narrow for two windows side by side.
  const ui = await $.ui.mount({ ...QUOTA, surface: 'desktop', props: { ...BAND, bodyColumns: 60 } })
  const root: any = await ui.drawn()
  expect(drawnWhere(root, el => el.props?.key === 'five_hour')[0].props.width).toBe(56)
  expect(drawnWhere(root, el => el.props?.key === 'seven_day')[0].props.width).toBe(56)
  expect(barRuns(root)).toEqual([
    { color: 'success', cells: 13 },
    { color: 'subtle', cells: 43 },
    { color: 'warning', cells: 42 },
    { color: 'subtle', cells: 14 },
  ])
  await ui.unmount()
})

test('on the desktop app the band leaves the context out, since the desktop app has its own panel for it', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [{ kind: 'five_hour', percentUsed: 23 }], [], CONTEXT_IN_USE)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount({ ...QUOTA, surface: 'desktop' })
  const root: any = await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^23%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /context/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /System 10k/ })).toBeUndefined()
  // The one window is as wide as the card inside, 136 cells: 23% of it is 31 cells, and the rest is track.
  expect(barRuns(root)).toEqual([
    { color: 'success', cells: 31 },
    { color: 'subtle', cells: 105 },
  ])
  await ui.unmount()
})

test('on a surface without hover, the card shows the legend under the bar and no tooltips', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], CONTEXT_IN_USE)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: 'System ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '10k' })).toBeDefined()
  const root: any = await ui.drawn()
  expect(JSON.stringify(root.children[1])).not.toContain('absolute')
  await ui.unmount()
})

test('a third window drops its reset when the quota line would not fit the card', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [
    { kind: 'five_hour', percentUsed: 23, resetsAt: new Date(2026, 9, 14, 14, 20).toISOString() },
    { kind: 'seven_day', percentUsed: 75, resetsAt: new Date(2026, 9, 16, 14, 0).toISOString() },
    { kind: 'spend_limit', percentUsed: 40, resetsAt: new Date(2026, 9, 16, 14, 0).toISOString() },
  ])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount({ ...QUOTA, props: { ...BAND, bodyColumns: 97 } })
  const root: any = await ui.drawn()
  const windows = root.children[1].children[0].children[1].children
  expect(windows).toHaveLength(3)
  expect(JSON.stringify(windows[1])).toContain('↻')
  expect(JSON.stringify(windows[2])).toContain('spend')
  expect(JSON.stringify(windows[2])).not.toContain('↻')
  await ui.unmount()
})

test('a breakdown with no tokens leaves the bar as the fill, not empty', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], {
    window: 200_000,
    percent: 46,
    tokens: 92_000,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 0, kind: 'used' },
        { name: 'Free space', tokens: 0, kind: 'free' },
      ],
    },
  })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /^█{63}$/ })).toMatchObject({ props: { color: 'success' } })
  await ui.unmount()
})

test('a cost change moves the figure on the speed row', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], { window: 200_000 }, 1.236)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], cost: { usd: 2.5 }, changed: ['cost'] })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /\$2\.50/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.24/ })).toBeUndefined()
  await ui.unmount()
})
