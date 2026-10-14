import { expect, mock, test } from 'claude-code/testing'

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const NOW = Date.UTC(2026, 9, 12, 9, 0)

test('the quota line stays under the prompt hint, with no data yet before a reading', async ($, on) => {
  mock.clock(on, { now: NOW })

  const ui = await $.ui.mount({
    plugin: 'account-quota',
    surface: 'terminal',
    component: 'PromptHint',
    props: HINT,
  })

  expect(await ui.find({ type: 'Text', text: /\? for shortcuts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Quota/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no data yet/ })).toBeDefined()
  await ui.unmount()
})
