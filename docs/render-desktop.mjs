// Draws the desktop images from the element trees in this folder: `node docs/render-desktop.mjs`.
// Each tree is what the plugin gives the desktop surface (ui.drawn() in its tests), with example
// data. A cell is CELL_W px across and a row is ROW_H px tall, which is an estimate; text is a
// system sans, so its widths are estimated per character. The colours are the dark theme's tokens.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const CELL_W = 8
const ROW_H = 18
const PAD = 16
const SURFACE = '#1f1f1e'
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif"
const THEME = {
  claude: '#d77757',
  inactive: '#999999',
  subtle: '#505050',
  success: '#4eba65',
  warning: '#ffc107',
  error: '#ff6b80',
  text: '#ffffff',
  inverseText: '#000000',
}
const SIZES = { caption: [12, 16], footnote: [13.5, 18], heading: [20, 26] }
const DEFAULT_SIZE = [14, 20]

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Approximate advance of one character, in em, for a system sans.
function advance(ch) {
  if (ch === ' ') return 0.28
  if ('il|!'.includes(ch)) return 0.25
  if ('.,:;\''.includes(ch)) return 0.28
  if ('frtj'.includes(ch)) return 0.34
  if ('mwMW'.includes(ch)) return 0.85
  if (/[0-9]/.test(ch)) return 0.56
  if (/[A-Z]/.test(ch)) return 0.66
  if ('%·…—–'.includes(ch)) return 0.8
  if ('↻◆■░▓█'.includes(ch)) return 0.7
  return 0.54
}

function measureText(text, fontPx, weight) {
  const boldness = weight === 'semibold' || weight === 'bold' ? 1.05 : 1
  return [...text].reduce((sum, ch) => sum + advance(ch), 0) * fontPx * boldness
}

function paint(name, fallback) {
  if (name === undefined) return { fill: fallback }
  if (THEME[name]) return { fill: THEME[name] }
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(name)
  if (m) return m[2] ? { fill: `#${m[1]}`, opacity: parseInt(m[2], 16) / 255 } : { fill: name }
  return { fill: fallback }
}

function sizeOf(props = {}) {
  return SIZES[props.size] ?? DEFAULT_SIZE
}

// The text a node holds, for measuring and for drawing.
function plainText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (node.type === 'Button') return String(node.props?.label ?? '')
  return (node.children ?? []).map(plainText).join('')
}

function kidsOf(node) {
  return (node.children ?? []).filter(c => c !== null && c !== undefined && c !== false)
}

// A card has even padding on both sides; other boxes use their cells and rows.
function padOf(props) {
  if (props.borderStyle !== undefined) return [14, 14]
  return [(props.paddingX ?? 0) * CELL_W, (props.paddingY ?? 0) * ROW_H]
}

function gapX(props) {
  const gap = props.gap ?? 0
  return props.columnGap !== undefined ? props.columnGap * CELL_W : gap * ROW_H
}

function gapY(props) {
  const gap = props.gap ?? 0
  return (props.rowGap ?? gap) * ROW_H
}

// Splits children into lines that fit the width, for a wrapping row.
function wrapLines(sizes, gap, width) {
  const lines = []
  let line = []
  let used = 0
  sizes.forEach((s, i) => {
    const next = line.length === 0 ? s.w : used + gap + s.w
    if (line.length > 0 && next > width) {
      lines.push(line)
      line = [i]
      used = s.w
    } else {
      line.push(i)
      used = next
    }
  })
  if (line.length > 0) lines.push(line)
  return lines
}

// Intrinsic size of a node, in pixels.
function measure(node) {
  if (typeof node === 'string' || typeof node === 'number') {
    return { w: measureText(String(node), DEFAULT_SIZE[0]), h: DEFAULT_SIZE[1] }
  }
  const props = node.props ?? {}
  if (node.type === 'Text') {
    const [fontPx, lineH] = sizeOf(props)
    const weight = props.weight ?? (props.bold ? 'bold' : undefined)
    return { w: measureText(plainText(node), fontPx, weight), h: lineH }
  }
  if (node.type === 'Button') {
    return { w: measureText(plainText(node), DEFAULT_SIZE[0], 'semibold') + 32, h: DEFAULT_SIZE[1] + 10 }
  }
  const [padX, padY] = padOf(props)
  const row = props.flexDirection === 'row'
  const columnGap = gapX(props)
  const rowGap = gapY(props)
  const kids = kidsOf(node)
  const sizes = kids.map(measure)
  let w
  let h
  if (row && props.flexWrap === 'wrap') {
    const limit = props.width !== undefined ? props.width * CELL_W - padX * 2 : Infinity
    const lines = wrapLines(sizes, columnGap, limit)
    w = Math.max(0, ...lines.map(line => line.reduce((s, i) => s + sizes[i].w, 0) + columnGap * Math.max(0, line.length - 1)))
    h = lines.reduce((s, line) => s + Math.max(0, ...line.map(i => sizes[i].h)), 0) + rowGap * Math.max(0, lines.length - 1)
  } else if (row) {
    w = sizes.reduce((sum, s) => sum + s.w, 0) + columnGap * Math.max(0, kids.length - 1)
    h = Math.max(0, ...sizes.map(s => s.h))
  } else {
    w = Math.max(0, ...sizes.map(s => s.w))
    h = sizes.reduce((sum, s) => sum + s.h, 0) + rowGap * Math.max(0, kids.length - 1)
  }
  if (props.width !== undefined) w = props.width * CELL_W
  if (props.height !== undefined) h = props.height * ROW_H
  return { w: w + padX * 2, h: h + padY * 2 }
}

// Lays a node out inside a rectangle, setting its box (x, y, w, h).
function layout(node, x, y, w, h) {
  node.box = { x, y, w, h }
  if (node.type !== 'Box' || !node.children) return
  const props = node.props ?? {}
  const [padX, padY] = padOf(props)
  const ix = x + padX
  const iy = y + padY
  const iw = w - padX * 2
  const ih = h - padY * 2
  const row = props.flexDirection === 'row'
  const columnGap = gapX(props)
  const rowGap = gapY(props)
  const kids = kidsOf(node)
  const sizes = kids.map(c => measure(c))
  const grow = kids.map(c => c.props?.flexGrow ?? 0)
  const fixedW = kids.map((c, i) => (c.props?.width !== undefined ? c.props.width * CELL_W : sizes[i].w))
  const fixedH = kids.map((c, i) => (c.props?.height !== undefined ? c.props.height * ROW_H : sizes[i].h))

  if (row && props.flexWrap === 'wrap') {
    let cy = iy
    for (const line of wrapLines(sizes, columnGap, iw)) {
      const lineH = Math.max(0, ...line.map(i => fixedH[i]))
      let cx = ix
      for (const i of line) {
        layout(kids[i], cx, cy, fixedW[i], lineH)
        cx += fixedW[i] + columnGap
      }
      cy += lineH + rowGap
    }
    return
  }

  if (row) {
    const gaps = columnGap * Math.max(0, kids.length - 1)
    const used = fixedW.reduce((s, v, i) => (grow[i] > 0 ? s : s + v), 0)
    const totalGrow = grow.reduce((s, v) => s + v, 0)
    const spare = Math.max(0, iw - gaps - used)
    const between = props.justifyContent === 'space-between' && totalGrow === 0 && kids.length > 1
      ? (iw - used) / (kids.length - 1)
      : null
    let cx = ix
    kids.forEach((c, i) => {
      const cw = grow[i] > 0 && totalGrow > 0 ? (spare * grow[i]) / totalGrow : fixedW[i]
      const ch = c.props?.height !== undefined ? c.props.height * ROW_H : c.type === 'Box' ? ih : fixedH[i]
      let cy = iy
      if (props.alignItems === 'flex-end') cy = iy + ih - ch
      else if (props.alignItems === 'center') cy = iy + (ih - ch) / 2
      layout(c, cx, cy, cw, ch)
      cx += cw + (between ?? columnGap)
    })
    return
  }

  // A column.
  const gaps = rowGap * Math.max(0, kids.length - 1)
  const used = fixedH.reduce((s, v, i) => (grow[i] > 0 ? s : s + v), 0)
  const totalGrow = grow.reduce((s, v) => s + v, 0)
  const spare = Math.max(0, ih - gaps - used)
  const between = props.justifyContent === 'space-between' && totalGrow === 0 && kids.length > 1
    ? (ih - used) / (kids.length - 1)
    : null
  let cy = iy
  kids.forEach((c, i) => {
    const ch = grow[i] > 0 && totalGrow > 0 ? (spare * grow[i]) / totalGrow : fixedH[i]
    const cw = c.props?.width !== undefined ? c.props.width * CELL_W : c.type === 'Box' ? iw : sizes[i].w
    let cx = ix
    if (props.alignItems === 'center') cx = ix + (iw - cw) / 2
    else if (props.alignItems === 'flex-end') cx = ix + iw - cw
    layout(c, cx, cy, cw, ch)
    cy += ch + (between ?? rowGap)
  })
}

function textRuns(node, inherited, out) {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push({ text: String(node), ...inherited })
    return
  }
  const props = node.props ?? {}
  const colored = props.color === undefined ? undefined : paint(props.color, inherited.fill)
  const own = {
    fill: colored ? colored.fill : inherited.fill,
    opacity: colored ? colored.opacity : inherited.opacity,
    weight: props.weight ?? (props.bold ? 'bold' : inherited.weight),
  }
  for (const child of node.children ?? []) textRuns(child, own, out)
}

function render(node, out) {
  if (node === null || node === undefined || node === false || typeof node === 'string') return
  const { x, y, w, h } = node.box
  const props = node.props ?? {}
  if (node.type === 'Box') {
    if (props.backgroundColor !== undefined && w > 0 && h > 0) {
      const p = paint(props.backgroundColor, SURFACE)
      // A one-row bar or cell is drawn a little shorter and rounded, so neighbours read apart.
      const inset = Math.abs(h - ROW_H) < 0.5 ? 3 : 0
      const radius = inset > 0 ? 3 : 0
      out.push(`<rect x="${x}" y="${y + inset}" width="${w}" height="${h - inset * 2}" rx="${radius}" fill="${p.fill}"${p.opacity === undefined ? '' : ` fill-opacity="${p.opacity}"`}/>`)
    }
    if (props.borderStyle !== undefined && w > 1 && h > 1) {
      // A card: a slightly lighter panel with a faint edge, instead of a hard outline.
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#262625"/>`)
      out.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="11.5" fill="none" stroke="#ffffff" stroke-opacity="0.1"/>`)
    }
    for (const child of node.children ?? []) render(child, out)
    return
  }
  if (node.type === 'Button') {
    const primary = props.variant === 'primary'
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${primary ? THEME.claude : '#2c2c2c'}"/>`)
    const [fontPx] = DEFAULT_SIZE
    out.push(`<text x="${x + w / 2}" y="${y + h / 2 + fontPx * 0.36}" text-anchor="middle" font-size="${fontPx}" font-weight="600" fill="${primary ? THEME.inverseText : THEME.text}">${esc(plainText(node))}</text>`)
    return
  }
  if (node.type === 'Text') {
    const [fontPx, lineH] = sizeOf(props)
    const runs = []
    textRuns(node, { fill: THEME.text, weight: undefined }, runs)
    const spans = runs
      .map(r => {
        const weight = r.weight === 'semibold' ? 600 : r.weight === 'bold' ? 700 : 400
        const fillOpacity = r.opacity === undefined ? '' : ` fill-opacity="${r.opacity}"`
        return `<tspan fill="${r.fill ?? THEME.text}"${fillOpacity}${weight === 400 ? '' : ` font-weight="${weight}"`}>${esc(r.text)}</tspan>`
      })
      .join('')
    out.push(`<text x="${x}" y="${y + lineH * 0.76}" font-size="${fontPx}" xml:space="preserve">${spans}</text>`)
  }
}

// Draws one tree into one SVG, `cells` wide.
function draw(treePath, svgPath, cells) {
  const tree = JSON.parse(readFileSync(treePath, 'utf8'))
  const width = cells * CELL_W + PAD * 2
  layout(tree, PAD, PAD, width - PAD * 2, measure(tree).h)
  const height = Math.ceil(tree.box.y + tree.box.h + PAD)
  const shapes = []
  render(tree, shapes)
  writeFileSync(svgPath, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">
<rect width="${width}" height="${height}" rx="12" fill="${SURFACE}"/>
${shapes.join('\n')}
</svg>
`)
}

draw(`${HERE}desktop-band.json`, `${HERE}desktop-band.svg`, 100)
draw(`${HERE}desktop-pane.json`, `${HERE}desktop-pane.svg`, 60)
console.log(`wrote desktop-band.svg and desktop-pane.svg to ${HERE}`)
