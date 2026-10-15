import { expect, test } from 'claude-code/testing'

import { allocateCells, contextLegend, contextSegments, groupOf } from './context'

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

test('the bar takes its used cells by group, and the legend lists the groups in use and the free space', () => {
  const rows = [
    { name: 'System prompt', tokens: 10_000, kind: 'used' as const },
    { name: 'Messages', tokens: 70_000, kind: 'used' as const },
    { name: 'Free space', tokens: 120_000, kind: 'free' as const },
    { name: 'Deferred tools', tokens: 5_000, kind: 'deferred' as const },
  ]
  expect(contextSegments(rows, 4)).toEqual([
    { color: '#3987e5', cells: 1 },
    { color: '#d56aa0', cells: 3 },
  ])
  expect(contextLegend(rows)).toEqual([
    { label: 'System', color: '#3987e5', tokens: 10_000 },
    { label: 'Messages', color: '#d56aa0', tokens: 70_000 },
    { label: 'Free', color: 'inactive', tokens: 120_000 },
  ])
})
