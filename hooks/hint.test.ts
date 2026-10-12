import { expect, mock, test } from 'claude-code/testing'

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

test('the prompt hint line keeps the engine text and adds the quota on the terminal', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 12, 9, 0) })

  const ui = await $.ui.mount({
    plugin: 'account-quota',
    surface: 'terminal',
    component: 'PromptHint',
    props: HINT,
  })

  expect(await ui.find({ type: 'Text', text: /\? for shortcuts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Quota/ })).toBeDefined()
  await ui.unmount()
})
