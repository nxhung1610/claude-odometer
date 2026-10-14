#!/usr/bin/env node
// Installs the odometer plugin by running the same command the README lists,
// through the Claude Code CLI. It writes nothing itself.
'use strict'

const { spawnSync } = require('node:child_process')

const ARGS = ['plugin', 'install', 'odometer', '--marketplace', 'nxhung1610/claude-odometer', '--scope', 'user']
const WINDOWS = process.platform === 'win32'
const flags = new Set(process.argv.slice(2))

if (flags.has('--help')) {
  console.log('Usage: npx claude-odometer [--print]')
  console.log('Installs the odometer plugin for your user, through the Claude Code CLI.')
  console.log('  --print  show the command that would run, and run nothing')
  process.exit(0)
}

if (flags.has('--print')) {
  console.log(['claude', ...ARGS].join(' '))
  process.exit(0)
}

// On Windows the CLI is a .cmd shim, which only a shell can start.
const probe = spawnSync('claude', ['--version'], { stdio: 'ignore', shell: WINDOWS })
if (probe.error || probe.status !== 0) {
  console.error('Claude Code CLI not found on PATH. Install Claude Code, then run this again.')
  process.exit(1)
}

const install = spawnSync('claude', ARGS, { stdio: 'inherit', shell: WINDOWS })
if (install.error) {
  console.error(`Could not run claude: ${install.error.message}`)
  process.exit(1)
}
if (install.status === 0) {
  console.log('Done. Start a new Claude Code session to see the quota line and /tokens.')
}
process.exit(install.status ?? 1)
