import type { CommandSpec } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { NOW, TERMINAL, QUOTA, TOKENS_PANE, TOKENS, SCAN, engine, ran, withPython, scans, MAIN, SUB, model, stopStep, OPUS, CONTEXT_IN_USE, collectToasts } from './test-kit'

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
  expect(await ui.find({ type: 'Text', text: '↻ 2h 20m' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↻ 2d 2h' })).toBeDefined()
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

test('a scan that fails says why, with the first line of its error', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  withPython(on, () => ran(1, '', 'python3: command not found\nsecond line\n'))
  await $.command.run(TOKENS)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: 'Could not read the transcripts: python3: command not found' })).toBeDefined()
  await ui.unmount()
})

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

test("the speed row follows /model: the session's model shows at once, and a change shows within a second, with the old model's effort gone", async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  let current = 'claude-opus-5-5'
  engine(on)
  on('session.model', () => ({ value: current }))
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 5000, outputTokens: 100 }))
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  // Before any step, the row names the session's model, with no effort yet.
  let ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(high\)/ })).toBeUndefined()
  await ui.unmount()

  // A step gives the row its effort.
  const step = $.turn.step(OPUS)
  const first = step.next()
  await clock.settle()
  await clock.advance(500)
  await first
  await stopStep(step)
  ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /\(high\)/ })).toBeDefined()
  await ui.unmount()

  // /model changes the session's model: within a second the row names it, and the old model's effort goes with it.
  current = 'claude-haiku-5-5'
  await clock.advance(1000)
  await clock.settle()
  ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /Haiku 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus|\(high\)/ })).toBeUndefined()
  await ui.unmount()

  // The desktop band reads the same model.
  const desktop = await $.ui.mount({ ...QUOTA, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /^Haiku 5\.5$/ })).toBeDefined()
  await desktop.unmount()
})

test('the speed row shows the effort of the latest step, so a change of effort shows at the next step', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  engine(on)
  model(on, clock, () => ({ firstAfter: 500, stopAfter: 5000, outputTokens: 100 }))
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  // Two steps of the same model: the first asks for high effort, and the second, after /effort, for max.
  for (const effort of ['high', 'max'] as const) {
    const step = $.turn.step({ ...OPUS, effort })
    const first = step.next()
    await clock.settle()
    await clock.advance(500)
    await first
    await stopStep(step)
  }

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /\(max\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\(high\)/ })).toBeUndefined()
  await ui.unmount()
})

test('a session that ends stops following its model', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  let current = 'claude-opus-5-5'
  engine(on)
  on('session.model', () => ({ value: current }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })
  await $.session.end({ reason: 'other', sessionId: 'session-1', resume: { id: 'session-1' } })

  current = 'claude-haiku-5-5'
  await clock.advance(3000)
  await clock.settle()
  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Haiku/ })).toBeUndefined()
  await ui.unmount()
})

test('the tokens pane scans again on Refresh, and says when it last scanned', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], CONTEXT_IN_USE)
  const runs: string[][] = []
  withPython(on, () => ran(0, JSON.stringify(SCAN)), runs)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })
  await $.command.run(TOKENS)
  expect(scans(runs)).toHaveLength(1)

  const ui = await $.ui.mount(TOKENS_PANE)
  expect(await ui.find({ type: 'Text', text: /Scanned 12:00/ })).toBeDefined()
  await ui.press({ key: 'refresh' })
  expect(scans(runs)).toHaveLength(2)
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
