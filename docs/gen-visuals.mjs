// Draws the illustrations in this folder, as SVG: `node docs/gen-visuals.mjs`. CI runs it
// and fails if the committed SVGs differ. The colors are the reference palette's dark steps
// and status steps; the text is what the mod draws in the terminal (hooks/register.tsx,
// hooks/context.ts, hooks/format.ts, hooks/timing.ts and hooks/tokens.ts). The numbers in the
// tokens pane are example data.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('.', import.meta.url))

const FONT = "ui-monospace, Menlo, Consolas, 'DejaVu Sans Mono', monospace"
const SIZE = 15
const CHAR_W = 9.04 // advance of one monospace cell at 15px (DejaVu Sans Mono, 0.602em)
const X0 = 36
const INNER = 72 // the card's text width in cells

const C = {
  surface: '#1a1a19',
  wash: '#2c2c2a',
  primary: '#f0efec',
  secondary: '#c3c2b7',
  muted: '#898781',
  track: '#383835',
  accent: '#d95926', // categorical slot 2 (orange), the mod's "claude" color
  good: '#0ca30c', // status steps, dark surface
  warning: '#fab219',
  critical: '#d03b3b',
}

// The model colors of hooks/tokens.ts: categorical slots 2, 1 and 3, dark steps.
const MODEL_COLORS = { opus: '#d95926', sonnet: '#3987e5', haiku: '#199e70' }

// The context groups' colors of hooks/context.ts.
const GROUP_COLORS = { system: '#3987e5', tools: '#8e6fd8', memory: '#2aa198', messages: '#d56aa0' }

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// One line of terminal text, as runs of [text, color, bold?]. A monospace face keeps
// the columns aligned across runs.
function line(runs, y, x = X0) {
  const spans = runs
    .map(([text, fill, bold]) => `<tspan fill="${fill}"${bold ? ' font-weight="700"' : ''}>${esc(text)}</tspan>`)
    .join('')
  return `<text x="${x}" y="${y}" xml:space="preserve" style="white-space:pre">${spans}</text>`
}

function card(width, height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="12" fill="${C.surface}"/>
  <g font-family="${FONT}" font-size="${SIZE}">
${body}
  </g>
</svg>
`
}

// Same rule as filledCells in hooks/format.ts: any usage fills at least one cell.
function filled(percent, width = 10) {
  const cells = Math.round((percent / 100) * width)
  return percent > 0 ? Math.max(1, cells) : 0
}

// Same thresholds as toneOf in hooks/format.ts.
function toneOf(percent) {
  if (percent >= 90) return C.critical
  if (percent >= 70) return C.warning
  return C.good
}

// Same as compactTokens in hooks/format.ts.
function compactTokens(count) {
  if (count >= 999_500) return `${(count / 1e6).toFixed(1)}M`
  if (count >= 1e3) return `${Math.round(count / 1e3)}k`
  return String(Math.round(count))
}

// Same as formatTokens in hooks/tokens.ts.
function formatTokens(count) {
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}k`
  return String(Math.round(count))
}

// Same as shareOf in hooks/context.ts.
function shareOf(tokens, window) {
  const percent = window > 0 ? (tokens / window) * 100 : 0
  if (percent > 0 && percent < 1) return '<1%'
  return `${Math.round(percent)}%`
}

// Same as allocateCells in hooks/context.ts: the cells are shared in proportion to the weights.
function allocateCells(cells, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (cells <= 0 || total <= 0) return weights.map(() => 0)
  const exact = weights.map(weight => (weight / total) * cells)
  const parts = exact.map(value => Math.floor(value))
  let left = cells - parts.reduce((sum, part) => sum + part, 0)
  const byRest = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of byRest) {
    if (left <= 0) break
    if (weights[index] > 0) {
      parts[index] += 1
      left -= 1
    }
  }
  return parts
}

// Same as packLegend in hooks/context.ts: an item that would overflow starts the next line.
function packLegend(items, width, textOf) {
  const lines = []
  let used = 0
  for (const item of items) {
    const size = textOf(item).length
    const last = lines[lines.length - 1]
    if (last !== undefined && used + 3 + size <= width) {
      last.push(item)
      used += 3 + size
    } else {
      lines.push([item])
      used = size
    }
  }
  return lines
}

// ---- the window: the groups in use, the buffer and the free space ----------------

const WINDOW = 200_000 // example window, in tokens
// `glyph` draws the bar; `key` marks the item in the legend. Groups are a square, the buffer and the
// free space keep their own glyphs, as hooks/context.ts gives them.
const PARTS = [
  { label: 'System', color: GROUP_COLORS.system, glyph: '█', key: '■', tokens: 5_000 },
  { label: 'Tools', color: GROUP_COLORS.tools, glyph: '█', key: '■', tokens: 15_000 },
  { label: 'Memory', color: GROUP_COLORS.memory, glyph: '█', key: '■', tokens: 4_000 },
  { label: 'Messages', color: GROUP_COLORS.messages, glyph: '█', key: '■', tokens: 38_000 },
  { label: 'Buffer', color: C.muted, glyph: '░', key: '░', tokens: 33_000 },
  { label: 'Free', color: C.track, glyph: '─', key: '─', tokens: 105_000 },
]
const USED = PARTS.slice(0, 4)

// The context card: its heading with the tokens and the fill, one bar of the parts, and the legend under it.
function context(y) {
  const usedTokens = USED.reduce((sum, part) => sum + part.tokens, 0)
  const percent = Math.round((usedTokens / WINDOW) * 100)
  const tone = toneOf(percent)
  const tokensText = `${compactTokens(usedTokens)} of ${compactTokens(WINDOW)}`
  const pad = ' '.repeat(Math.max(1, INNER - '◆ context'.length - tokensText.length - 2 - `${percent}%`.length))
  const cells = allocateCells(INNER, PARTS.map(part => part.tokens))
  const bar = PARTS.flatMap((part, i) => (cells[i] > 0 ? [[part.glyph.repeat(cells[i]), part.color]] : []))
  const legendText = item => `${item.key} ${item.label} ${compactTokens(item.tokens)} ${shareOf(item.tokens, WINDOW)}`
  const legend = packLegend(PARTS, INNER, legendText).map((items, row) =>
    line(
      items.flatMap((item, index) => [
        ...(index > 0 ? [['   ', C.muted]] : []),
        [`${item.key} `, item.color],
        [`${item.label} `, C.muted],
        [compactTokens(item.tokens), C.primary, true],
        [` ${shareOf(item.tokens, WINDOW)}`, C.muted],
      ]),
      y + 62 + row * 22,
    ),
  )
  return [
    line(
      [
        ['◆ ', C.accent],
        ['context', C.primary, true],
        [pad, C.muted],
        [`${tokensText}  `, C.secondary],
        [`${percent}%`, tone, true],
      ],
      y,
    ),
    line(bar, y + 32),
    ...legend,
  ].join('\n')
}

// ---- quota: the card, with the three tones and the context below ------------------

function quota() {
  const rows = [
    { percent: 23, reset: '↻ 6h 20m', note: 'under 70%' },
    { percent: 75, reset: '↻ 1d 21h', note: '70% to 89%' },
    { percent: 91, reset: '↻ 45m', note: '90% and up' },
  ]
  // The card's heading, then one line per window: a bar, the percentage and the time left, as the mod draws them.
  const heading = line([['◆ ', C.accent], ['quota', C.primary, true]], 52)
  const body = rows
    .map((r, i) => {
      const y = 90 + i * 44
      const n = filled(r.percent)
      const tone = toneOf(r.percent)
      return [
        line(
          [
            ['5h ', C.muted],
            ['█'.repeat(n), C.accent],
            ['─'.repeat(10 - n), C.track],
            [` ${r.percent}%`, tone, true],
            [`  ${r.reset}`, C.secondary],
          ],
          y,
        ),
        line([[r.note, C.muted]], y, X0 + 40 * CHAR_W),
      ].join('\n')
    })
    .join('\n')
  const width = Math.round(2 * X0 + INNER * CHAR_W)
  return card(width, 350, [heading, body, context(236)].join('\n'))
}

// ---- speed: the light crossing "working" -----------------------------------------

function speed() {
  const word = 'working'
  const strip = []
  for (let lit = 0; lit < 7; lit++) {
    if (lit > 0) strip.push(['    ', C.muted])
    ;[...word].forEach((ch, j) => strip.push([ch, j === lit ? C.accent : C.muted, j === lit]))
  }
  const body = [
    line(strip, 66),
    line(
      [
        ['  ', C.muted],
        ['Opus 5.5', C.accent],
        [' (high) · ', C.muted],
        ['wo', C.muted],
        ['r', C.accent, true],
        ['king 3s · TTFT 850ms · last TPS 42 tok/s', C.muted],
        [' · $1.24', C.muted],
      ],
      126,
    ),
  ].join('\n')
  return card(720, 150, body)
}

// ---- tokens: the /tokens pane, with example data ---------------------------------

// Values are thousands of tokens.
const MODELS = [
  { name: 'Opus 5.5', color: MODEL_COLORS.opus, values: [340, 510, 420, 90, 12, 610, 900] },
  { name: 'Sonnet 5.5', color: MODEL_COLORS.sonnet, values: [150, 230, 180, 50, 4, 300, 420] },
  { name: 'Haiku 5.5', color: MODEL_COLORS.haiku, values: [30, 40, 35, 8, 1, 55, 70] },
]
const DAYS = ['Oct 8', 'Oct 9', 'Oct 10', 'Oct 11', 'Oct 12', 'Oct 13', 'Oct 14']
const SESSIONS = 12
const LEVELS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const CHART_ROWS = 8
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] // as in hooks/tokens.ts

// Example usage by weekday (Monday first) and local hour: busiest in the working day, quieter at the weekend.
const HOUR_SHAPE = [0, 0, 0, 0, 0, 0, 0, 1, 3, 5, 6, 7, 6, 4, 5, 6, 5, 3, 2, 1, 0, 0, 0, 0]
const DAY_SHAPE = [1, 1, 0.9, 1, 0.8, 0.3, 0.2]
const HOURS = WEEKDAYS.map((_, d) => HOUR_SHAPE.map((v, h) => v * DAY_SHAPE[d] * (1 + ((d * 7 + h) % 5) / 10)))

// Same as heatCell in hooks/tokens.ts: a shade by the share of the largest cell, a dot when it holds nothing.
const SHADES = ['░', '▒', '▓', '█']
function heatCell(value, max) {
  if (value <= 0 || max <= 0) return { char: '·', color: C.track }
  const level = Math.min(4, Math.ceil((value / max) * 4))
  return { char: SHADES[level - 1], color: C.accent }
}

function tokens() {
  const columns = DAYS.map((_, d) => {
    const segments = MODELS.map(m => ({ color: m.color, tokens: m.values[d] * 1000 }))
    const total = segments.reduce((sum, s) => sum + s.tokens, 0)
    return { segments, total }
  })
  const max = Math.max(...columns.map(c => c.total))
  const levels = CHART_ROWS * 8
  // Same as chartRows in hooks/tokens.ts: at least one level for any usage.
  const heights = columns.map(c => (c.total <= 0 ? 0 : Math.max(1, Math.round((c.total / max) * levels))))

  // Same as axisLabels in hooks/tokens.ts: top, middle and bottom rows.
  const axis = row => {
    if (row === 0) return formatTokens(max)
    if (row === Math.floor(CHART_ROWS / 2)) return formatTokens(max / 2)
    if (row === CHART_ROWS - 1) return '0'
    return ''
  }

  const PITCH = 22 // one chart row, tall enough that stacked levels meet
  const TOP = 162 // top of the chart, below the context and the range buttons
  const COL_X = X0 + 10 * CHAR_W // left edge of the first column; the axis takes ten cells
  const AXIS_X = X0 + 8.5 * CHAR_W // the vertical rule
  const bottom = TOP + CHART_ROWS * PITCH
  const parts = []

  // The title, then the context in use with its parts, as the pane shows them above the range buttons.
  parts.push(line([['Tokens per day', C.primary, true]], 34))
  const used = USED.reduce((sum, part) => sum + part.tokens, 0)
  parts.push(line([[`Context now: ${compactTokens(used)} of ${compactTokens(WINDOW)}`, C.primary, true]], 62))
  const legendText = item => `${item.key} ${item.label} ${compactTokens(item.tokens)}`
  packLegend(PARTS, 60, legendText).forEach((items, row) =>
    parts.push(
      line(
        items.flatMap((item, index) => [
          ...(index > 0 ? [['   ', C.muted]] : []),
          [`${item.key} `, item.color],
          [`${item.label} ${compactTokens(item.tokens)}`, C.secondary],
        ]),
        84 + row * 22,
      ),
    ),
  )

  // Range buttons, with the selected range drawn as a filled button.
  parts.push(
    `  <rect x="${X0 + 13 * CHAR_W - 4}" y="112" width="${13 * CHAR_W + 8}" height="26" rx="6" fill="${C.wash}"/>`,
  )
  parts.push(
    line(
      [
        ['  All time   ', C.secondary],
        [' Last 7 days ', C.primary, true],
        ['   Last 30 days', C.secondary],
      ],
      130,
    ),
  )

  // Each level is a block drawn from the bottom of its row, as a terminal draws it.
  for (let row = 0; row < CHART_ROWS; row++) {
    const rowTop = TOP + row * PITCH
    const label = axis(row)
    if (label) {
      parts.push(
        `<text x="${X0 + 7 * CHAR_W}" y="${rowTop + 16}" text-anchor="end" fill="${C.muted}" xml:space="preserve" style="white-space:pre">${esc(label)}</text>`,
      )
    }
    const base = (CHART_ROWS - 1 - row) * 8
    columns.forEach((col, i) => {
      const fill = Math.min(8, Math.max(0, heights[i] - base))
      if (fill === 0) return
      // The cell takes the color of the model at its top, as in chartRows.
      const topLevel = base + fill - 1
      let color = C.muted
      let cumulative = 0
      for (const seg of col.segments) {
        cumulative += seg.tokens
        color = seg.color
        if (topLevel < Math.round((cumulative / col.total) * heights[i])) break
      }
      const h = (fill / 8) * PITCH
      parts.push(
        `<rect x="${COL_X + i * 2 * CHAR_W}" y="${rowTop + PITCH - h}" width="${CHAR_W}" height="${h}" fill="${color}"/>`,
      )
    })
  }

  // Axis rule and baseline, both hairlines.
  parts.push(`<rect x="${AXIS_X - 0.5}" y="${TOP}" width="1" height="${CHART_ROWS * PITCH}" fill="${C.muted}"/>`)
  const lastX = COL_X + columns.length * 2 * CHAR_W
  parts.push(`<rect x="${AXIS_X - 0.5}" y="${bottom}" width="${lastX - AXIS_X + 0.5}" height="1" fill="${C.muted}"/>`)

  parts.push(line([[`${DAYS[0]} … ${DAYS[DAYS.length - 1]}`, C.muted]], bottom + 22, COL_X))

  const legend = MODELS.flatMap((m, i) => [
    ['■ ', m.color],
    [`${m.name}${i < MODELS.length - 1 ? '   ' : ''}`, C.secondary],
  ])
  parts.push(line(legend, bottom + 58))

  const grand = columns.reduce((sum, c) => sum + c.total, 0)
  parts.push(line([[`${formatTokens(grand)} tokens across ${SESSIONS} sessions.`, C.secondary]], bottom + 90))
  parts.push(line([['Each API response is counted once; /stats adds every log row.', C.secondary]], bottom + 112))

  // The heatmap: a shade for each weekday and hour, the hours labelled every third, and the key under it.
  const heatTop = bottom + 146
  parts.push(line([['When tokens are used, by hour (local time)', C.primary, true]], heatTop))
  const hourLabels = Array.from({ length: 24 }, (_, hour) => (hour % 3 === 0 ? String(hour).padEnd(2) : '  ')).join('')
  parts.push(line([[`    ${hourLabels}`, C.muted]], heatTop + 22))
  const heatMax = Math.max(...HOURS.flat())
  WEEKDAYS.forEach((name, row) => {
    const runs = [[`${name} `, C.muted]]
    HOURS[row].forEach(value => {
      const cell = heatCell(value, heatMax)
      runs.push([`${cell.char} `, cell.color])
    })
    parts.push(line(runs, heatTop + 44 + row * 22))
  })
  parts.push(line([['    less ░▒▓█ more', C.muted]], heatTop + 44 + WEEKDAYS.length * 22))

  return card(620, heatTop + 44 + WEEKDAYS.length * 22 + 22, parts.join('\n'))
}

writeFileSync(`${OUT}quota.svg`, quota())
writeFileSync(`${OUT}speed.svg`, speed())
writeFileSync(`${OUT}tokens.svg`, tokens())
console.log(`wrote quota.svg, speed.svg and tokens.svg to ${OUT}`)
