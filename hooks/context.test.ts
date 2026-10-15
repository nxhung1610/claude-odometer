import { expect, test } from 'claude-code/testing'

import { allocateCells, contextBar, contextLegend, groupOf, legendText, packLegend, shareOf } from './context'

test('a context row is grouped by what it holds', () => {
  expect(groupOf('System prompt')).toBe('system')
  expect(groupOf('System tools')).toBe('tools')
  expect(groupOf('MCP tools')).toBe('tools')
  expect(groupOf('Memory files')).toBe('memory')
  expect(groupOf('Skills')).toBe('memory')
  expect(groupOf('Messages')).toBe('messages')
  expect(groupOf('Custom agents')).toBe('other')
})

test('cells are shared out in proportion, and always add up', () => {
  expect(allocateCells(4, [1_000, 3_000])).toEqual([1, 3])
  expect(allocateCells(3, [0, 5])).toEqual([0, 3])
  expect(allocateCells(0, [1, 1])).toEqual([0, 0])
  const shared = allocateCells(10, [1, 1, 1])
  expect(shared.reduce((sum, cells) => sum + cells, 0)).toBe(10)
  expect(Math.max(...shared) - Math.min(...shared)).toBeLessThanOrEqual(1)
})

test('the bar draws each group in use, then the buffer, then the free space, across its width', () => {
  const rows = [
    { name: 'System prompt', tokens: 10_000, kind: 'used' as const },
    { name: 'Messages', tokens: 70_000, kind: 'used' as const },
    { name: 'Autocompact buffer', tokens: 20_000, kind: 'buffer' as const },
    { name: 'Free space', tokens: 100_000, kind: 'free' as const },
  ]
  expect(contextBar(rows, 20)).toEqual([
    { label: 'System', color: '#3987e5', glyph: '█', cells: 1, tokens: 10_000 },
    { label: 'Messages', color: '#d56aa0', glyph: '█', cells: 7, tokens: 70_000 },
    { label: 'Buffer', color: 'inactive', glyph: '░', cells: 2, tokens: 20_000 },
    { label: 'Free', color: 'subtle', glyph: '─', cells: 10, tokens: 100_000 },
  ])
})

test('a group in use gets a cell even when rounding would leave it none', () => {
  const rows = [
    { name: 'System prompt', tokens: 1_000, kind: 'used' as const },
    { name: 'Messages', tokens: 199_000, kind: 'used' as const },
  ]
  const bar = contextBar(rows, 20)
  expect(bar[0]).toEqual({ label: 'System', color: '#3987e5', glyph: '█', cells: 1, tokens: 1_000 })
  expect(bar.reduce((sum, run) => sum + run.cells, 0)).toBe(20)
})

test('a bar with no rows is empty', () => {
  expect(contextBar([], 20)).toEqual([])
})

test('the legend lists the groups in use, the buffer when it holds tokens, then the free space', () => {
  const rows = [
    { name: 'System prompt', tokens: 10_000, kind: 'used' as const },
    { name: 'Messages', tokens: 70_000, kind: 'used' as const },
    { name: 'Autocompact buffer', tokens: 20_000, kind: 'buffer' as const },
    { name: 'Free space', tokens: 100_000, kind: 'free' as const },
    { name: 'Deferred tools', tokens: 5_000, kind: 'deferred' as const },
  ]
  expect(contextLegend(rows)).toEqual([
    { label: 'System', glyph: '■', color: '#3987e5', tokens: 10_000 },
    { label: 'Messages', glyph: '■', color: '#d56aa0', tokens: 70_000 },
    { label: 'Buffer', glyph: '░', color: 'inactive', tokens: 20_000 },
    { label: 'Free', glyph: '─', color: 'subtle', tokens: 100_000 },
  ])
})

test('the legend leaves the buffer out when it holds no tokens', () => {
  const rows = [
    { name: 'System prompt', tokens: 10_000, kind: 'used' as const },
    { name: 'Free space', tokens: 190_000, kind: 'free' as const },
  ]
  expect(contextLegend(rows).map(item => item.label)).toEqual(['System', 'Free'])
})

test('a share reads as a whole percent, or below 1% for a sliver', () => {
  expect(shareOf(10_000, 200_000)).toBe('5%')
  expect(shareOf(2_000, 200_000)).toBe('1%')
  expect(shareOf(500, 200_000)).toBe('<1%')
  expect(shareOf(0, 200_000)).toBe('0%')
})

test('the legend packs into lines no wider than the width', () => {
  const items = [
    { label: 'System', glyph: '■', color: 'a', tokens: 10_000 },
    { label: 'Messages', glyph: '■', color: 'b', tokens: 70_000 },
    { label: 'Free', glyph: '─', color: 'c', tokens: 120_000 },
  ]
  expect(packLegend(items, 200_000, 40).map(line => line.map(item => item.label))).toEqual([['System', 'Messages'], ['Free']])
  expect(packLegend(items, 200_000, 15).map(line => line.map(item => item.label))).toEqual([['System'], ['Messages'], ['Free']])
})

test('a part of the bar reads as its glyph, name, tokens and share', () => {
  expect(legendText({ label: 'System', glyph: '■', color: 'a', tokens: 10_000 }, 200_000)).toBe('■ System 10k 5%')
})
