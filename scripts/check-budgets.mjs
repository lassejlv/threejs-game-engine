// Checks build output sizes against budgets.json: the two game players and what
// the editor downloads before it can show anything. Run after `npm run build`.
import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const budgets = JSON.parse(readFileSync(new URL('../budgets.json', import.meta.url), 'utf8'))
const failures = []
const check = (label, actual, budget, unit = 'bytes') => {
  const ok = actual <= budget
  console.log(`${ok ? 'ok  ' : 'OVER'} ${label}: ${actual.toLocaleString()} ${unit} (budget ${budget.toLocaleString()})`)
  if (!ok) failures.push(label)
}

check('WebGL player (public/player/player.js)', statSync('public/player/player.js').size, budgets.playerBytes)
check('WebGPU player (public/player/player-webgpu.js)', statSync('public/player/player-webgpu.js').size, budgets.playerWebgpuBytes)

// Everything index.html loads up front (scripts, module preloads, styles), gzipped.
const html = readFileSync('dist/index.html', 'utf8')
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
const gzip = initial.reduce((sum, file) => sum + gzipSync(readFileSync(`dist/${file}`)).length, 0)
check(`editor first load (${initial.length} files, gzipped)`, gzip, budgets.editorInitialGzipBytes)

if (failures.length) {
  console.error(`\nOver budget: ${failures.join(', ')}. See budgets.json.`)
  process.exit(1)
}
