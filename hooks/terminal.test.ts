import { expect, mock, test } from 'claude-code/testing'

import { NOW, TODAY, TERMINAL, BAND, QUOTA, TOKENS_PANE, TOKENS, SCAN, engine, ran, withPython, model, stopStep, OPUS, CONTEXT_IN_USE } from './test-kit'

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

test('the percentage is green below 70%, yellow from 70% and red from 90%', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], { window: 200_000, percent: 69 })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  let ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: ' 69% ' })).toMatchObject({ children: [{ props: { color: 'success' } }] })
  await ui.unmount()

  await $.session.measure({ context: { window: 200_000, percent: 70 }, rateLimits: [], changed: ['context'] })
  ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: ' 70% ' })).toMatchObject({ children: [{ props: { color: 'warning' } }] })
  await ui.unmount()

  await $.session.measure({ context: { window: 200_000, percent: 90 }, rateLimits: [], changed: ['context'] })
  ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: ' 90% ' })).toMatchObject({ children: [{ props: { color: 'error' } }] })
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
  expect(await ui.find({ type: 'Text', text: ' 92% ' })).toMatchObject({ children: [{ props: { color: 'error' } }] })
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
    children: [{ props: { dimColor: true } }, { props: { color: 'success' }, children: [' 46% '] }],
  })
  await ui.unmount()
})

test('before the first response the card works out the fill from the breakdown, so the parts show at once', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], {
    window: 200_000,
    breakdown: {
      categories: [
        { name: 'System prompt', tokens: 4_000, kind: 'used' },
        { name: 'System tools', tokens: 16_000, kind: 'used' },
        { name: 'Autocompact buffer', tokens: 30_000, kind: 'buffer' },
        { name: 'Free space', tokens: 150_000, kind: 'free' },
      ],
    },
  })
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  // 20k of the 200k window is in use, which is 10%. The 4k of system prompt is 3 of the 136 cells of the bar.
  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: /^20k of 200k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ 10% $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^█{3}$/ })).toMatchObject({ props: { color: '#3987e5' } })
  expect(await ui.find({ type: 'Text', text: /Tools 16k 8%/ })).toBeDefined()
  await ui.unmount()
})

test('with no breakdown yet, the card shows the window and says the parts come after the first response', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount(QUOTA)
  expect(await ui.find({ type: 'Text', text: '— of 200k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'the parts appear after the first response' })).toBeDefined()
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

test('the surfaces other than the desktop app draw the band as text, as the terminal does', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [{ kind: 'five_hour', percentUsed: 23 }])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...QUOTA, surface })
    expect(await ui.find({ type: 'Text', text: 'quota' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /23%/ })).toBeDefined()
    await ui.unmount()
  }
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

test('at 97 columns every window keeps its reset, since each one reads as the time left', async ($, on) => {
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
  expect(JSON.stringify(windows[2])).toContain('↻ 2d 2h')
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
  expect(await ui.find({ type: 'Text', text: /^█{63}$/ })).toMatchObject({ props: { color: 'claude' } })
  await ui.unmount()
})
