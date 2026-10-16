import { expect, mock, test } from 'claude-code/testing'
import type { TokenScan } from '../types'

import type { ContextReading } from './test-kit'
import { NOW, TODAY, TERMINAL, BAND, QUOTA, TOKENS_PANE, TOKENS, SCAN, engine, ran, withPython, scans, model, stopStep, OPUS, CONTEXT_IN_USE, drawnWhere, barRuns } from './test-kit'

test('on the desktop app the quota windows sit on the speed row, each with its label, bar, percentage and reset', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [
    { kind: 'five_hour', percentUsed: 23, resetsAt: new Date(2026, 9, 14, 14, 20).toISOString() },
    { kind: 'seven_day', percentUsed: 75, resetsAt: new Date(2026, 9, 16, 14, 0).toISOString() },
  ])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const ui = await $.ui.mount({ ...QUOTA, surface: 'desktop' })
  const root: any = await ui.drawn()
  expect(await ui.find({ type: 'Text', text: /^23%$/ })).toMatchObject({ props: { size: 'body', color: 'success' } })
  expect(await ui.find({ type: 'Text', text: /^75%$/ })).toMatchObject({ props: { size: 'body', color: 'warning' } })
  expect(await ui.find({ type: 'Text', text: /^↻ 14:20$/ })).toBeDefined()
  // Each bar is 10 cells, filled by its share: 23% fills 2 of them, and 75% fills 8.
  expect(barRuns(root)).toEqual([
    { color: 'claude', cells: 2 },
    { color: 'subtle', cells: 8 },
    { color: 'claude', cells: 8 },
    { color: 'subtle', cells: 2 },
  ])
  // The speed and the quota share one row, with no card around them.
  expect(root.props.flexDirection).toBe('row')
  expect(drawnWhere(root, el => el.props?.borderStyle !== undefined)).toEqual([])
  await ui.unmount()
})

/** The context the desktop images show: 62k of a 200k window in use, in five groups, with a buffer and the free space. */
const DOCS_CONTEXT: ContextReading = {
  window: 200_000,
  percent: 31,
  tokens: 62_000,
  breakdown: {
    categories: [
      { name: 'System prompt', tokens: 5_000, kind: 'used' },
      { name: 'Tools', tokens: 15_000, kind: 'used' },
      { name: 'Memory files', tokens: 4_000, kind: 'used' },
      { name: 'Messages', tokens: 38_000, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' },
      { name: 'Free space', tokens: 105_000, kind: 'free' },
    ],
  },
}

/** The example week the desktop pane's image shows: three models over seven days, from twelve sessions. */
const DOCS_SCAN: TokenScan = (() => {
  const days = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']
  const shares = [0.12, 0.17, 0.15, 0.02, 0.005, 0.22, 0.315]
  const models = {
    'claude-opus-5-5': { input: 288_200, output: 144_100, cacheRead: 2_300_000, cacheWrite: 144_100 },
    'claude-sonnet-5-5': { input: 133_400, output: 66_700, cacheRead: 1_100_000, cacheWrite: 66_700 },
    'claude-haiku-5-5': { input: 23_900, output: 11_900, cacheRead: 191_200, cacheWrite: 11_900 },
  }
  const hourWeights = [1, 1, 1, 1, 1, 1, 2, 3, 5, 6, 7, 6, 5, 6, 7, 6, 5, 4, 3, 2, 2, 1, 1, 1]
  const weights = hourWeights.reduce((sum, weight) => sum + weight, 0)
  const scan: TokenScan = { root: '/Users/me/.claude/projects', sessions: { week: 12, month: 12, all: 12 }, days: {}, hours: {} }
  days.forEach((day, index) => {
    const share = shares[index] ?? 0
    const byModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {}
    for (const [model, tokens] of Object.entries(models)) {
      byModel[model] = {
        input: Math.round(tokens.input * share),
        output: Math.round(tokens.output * share),
        cacheRead: Math.round(tokens.cacheRead * share),
        cacheWrite: Math.round(tokens.cacheWrite * share),
      }
    }
    scan.days[day] = byModel
    const total = Object.values(byModel).reduce((sum, t) => sum + t.input + t.output + t.cacheRead + t.cacheWrite, 0)
    scan.hours[day] = hourWeights.map(weight => Math.round((total * weight) / weights))
  })
  return scan
})()

// The test kit's output: the trees below are printed through it, and the type checker does not know the global.
declare const console: { log(message: string): void }

/** A drawn tree as JSON, without the `press` handles the test kit gives buttons: they change from run to run and draw nothing. */
function treeOf(root: unknown): string {
  return JSON.stringify(root, (key, value) => (key === 'press' ? undefined : value))
}

// The element trees the desktop app gets are printed on every run, one line each, so `node docs/collect-desktop.mjs` can
// write them to docs/desktop-band.json and docs/desktop-pane.json, which the desktop images are drawn from. CI runs that
// script and fails when the committed files differ from what the mod draws.
test('on the desktop app the tokens pane scans again on Refresh, and says when it last scanned', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [], [], CONTEXT_IN_USE)
  const runs: string[][] = []
  withPython(on, () => ran(0, JSON.stringify(SCAN)), runs)
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })
  await $.command.run(TOKENS)
  expect(scans(runs)).toHaveLength(1)

  const ui = await $.ui.mount({ ...TOKENS_PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Scanned 12:00/ })).toBeDefined()
  await ui.press({ key: 'refresh' })
  expect(scans(runs)).toHaveLength(2)
  await ui.unmount()
})

test('the desktop images are drawn from the trees the desktop app gets', async ($, on) => {
  const clock = mock.clock(on, { now: NOW.getTime() })
  engine(
    on,
    [
      { kind: 'five_hour', percentUsed: 23, resetsAt: new Date(2026, 9, 14, 15, 20).toISOString() },
      { kind: 'seven_day', percentUsed: 91, resetsAt: new Date(2026, 9, 16, 9, 45).toISOString() },
    ],
    [],
    DOCS_CONTEXT,
    1.24,
  )
  withPython(on, () => ran(0, JSON.stringify(DOCS_SCAN)))
  model(on, clock, () => ({ firstAfter: 850, stopAfter: 5000, outputTokens: 210 }))
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  const step = $.turn.step(OPUS)
  const first = step.next()
  await clock.settle()
  await clock.advance(850)
  await first
  const last = step.next()
  await clock.settle()
  await clock.advance(5000)
  await last
  await stopStep(step)

  const band = await $.ui.mount({ ...QUOTA, surface: 'desktop', props: { ...BAND, bodyColumns: 104 } })
  console.log(`ODOMETER-DUMP desktop-band ${treeOf(await band.drawn())}`)
  await band.unmount()

  await $.command.run(TOKENS)
  const pane = await $.ui.mount({ ...TOKENS_PANE, surface: 'desktop', viewport: { columns: 60, rows: 40 } })
  console.log(`ODOMETER-DUMP desktop-pane ${treeOf(await pane.drawn())}`)
  await pane.unmount()
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

test('on the desktop app a narrow band wraps the quota onto a row of its own, below the speed', async ($, on) => {
  mock.clock(on, { now: NOW.getTime() })
  engine(on, [
    { kind: 'five_hour', percentUsed: 23 },
    { kind: 'seven_day', percentUsed: 75 },
  ])
  await $.session.start({ cwd: '/tmp', surface: TERMINAL, isInteractive: true })

  // At 60 columns the speed and the quota cannot share a row, so the band wraps and the quota takes a row of its own.
  const ui = await $.ui.mount({ ...QUOTA, surface: 'desktop', props: { ...BAND, bodyColumns: 60 } })
  const root: any = await ui.drawn()
  expect(root.props.flexWrap).toBe('wrap')
  expect(root.children.some((child: any) => drawnWhere(child, el => el.props?.key === 'five_hour').length > 0)).toBe(true)
  expect(barRuns(root)).toEqual([
    { color: 'claude', cells: 2 },
    { color: 'subtle', cells: 8 },
    { color: 'claude', cells: 8 },
    { color: 'subtle', cells: 2 },
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
  // The one window's bar is 10 cells: 23% fills 2 of them, and the rest is track.
  expect(barRuns(root)).toEqual([
    { color: 'claude', cells: 2 },
    { color: 'subtle', cells: 8 },
  ])
  await ui.unmount()
})
