// Writes docs/desktop-band.json and docs/desktop-pane.json from the element trees the mod draws for the desktop app:
// `node docs/collect-desktop.mjs`, then `node docs/render-desktop.mjs` draws the images. The trees come from a test that
// prints them on every run, so the files cannot drift from the code without this script noticing. CI runs both scripts
// and fails if the committed trees or images differ from what the mod draws now.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('.', import.meta.url))
const TREES = ['desktop-band', 'desktop-pane']

const run = spawnSync('claude', ['plugin', 'test'], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  shell: process.platform === 'win32',
})
if (run.error) {
  console.error(`Could not run claude: ${run.error.message}`)
  process.exit(1)
}
if (run.status !== 0) {
  process.stdout.write(run.stdout)
  process.stderr.write(run.stderr)
  process.exit(run.status ?? 1)
}

// The test's own output goes to stderr, with the pass and fail lines, so both streams are searched.
const output = `${run.stdout}\n${run.stderr}`.split('\n')
for (const name of TREES) {
  const marker = `ODOMETER-DUMP ${name} `
  const line = output.find(text => text.includes(marker))
  if (line === undefined) {
    console.error(`The test printed no ${name} tree.`)
    process.exit(1)
  }
  const json = line.slice(line.indexOf(marker) + marker.length).trim()
  // A line that the output cut short would not read as JSON, so check it before writing anything.
  JSON.parse(json)
  writeFileSync(`${OUT}${name}.json`, `${json}\n`)
  console.log(`wrote docs/${name}.json`)
}
