import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.UTC(2026, 9, 12, 9, 0)
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
}

test('the quota row sits in the band above the prompt, with no data yet before a reading', async ($, on) => {
  mock.clock(on, { now: NOW })

  const ui = await $.ui.mount({
    plugin: 'odometer',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND,
  })

  expect(await ui.find({ type: 'Text', text: /Quota/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no data yet/ })).toBeDefined()
  await ui.unmount()
})

test('the band shows the speed on its own row, with dashes before a turn', async ($, on) => {
  mock.clock(on, { now: NOW })

  const ui = await $.ui.mount({
    plugin: 'odometer',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND,
  })

  expect(await ui.find({ type: 'Text', text: /TPS —/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /TTFT —/ })).toBeDefined()
  await ui.unmount()
})
