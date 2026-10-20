import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sampleProject } from './sample'
import { SCRIPT_TYPES } from './scriptTypes'
import { TEMPLATES } from './templates'

/**
 * The script API exists twice: the runtime types in scripting.ts (what ctx
 * really has) and the declarations in scriptTypes.ts (what Monaco shows and
 * type-checks). These tests fail when the two drift apart, and type-check every
 * script the editor ships against the declarations.
 */

/** Member names of `interface <name>` in some TypeScript source (top level of the body only). */
function members(source: string, name: string): string[] {
  const start = source.search(new RegExp(`interface ${name}\\b[^{]*\\{`))
  if (start < 0) throw new Error(`interface ${name} not found`)
  let i = source.indexOf('{', start) + 1
  let depth = 1
  let body = ''
  for (; depth > 0; i++) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    if (depth === 1 && c !== '}') body += c
    else if (depth > 1 || c === '}') body += depth === 1 && c === '}' ? '' : ' '
  }
  return [...body.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_]\w*)\??\s*[:(<]/gm)].map((m) => m[1])
}

const runtime = readFileSync(new URL('./scripting.ts', import.meta.url), 'utf8')

describe('script API typings', () => {
  it.each([
    ['ScriptContext', 'Context'],
    ['Handle', 'Handle'],
  ])('ctx members match: %s (runtime) and %s (Monaco)', (runtimeName, typingsName) => {
    const real = new Set(members(runtime, runtimeName))
    const typed = new Set(members(SCRIPT_TYPES, typingsName))
    expect(real.size, 'the member extractor found the runtime interface').toBeGreaterThan(3)
    // Handle's members are part of the context through `extends Handle` on both sides.
    expect([...real].filter((m) => !typed.has(m)), `missing from scriptTypes.ts ${typingsName}`).toEqual([])
    expect([...typed].filter((m) => !real.has(m)), `declared in scriptTypes.ts but not on the runtime ${runtimeName}`).toEqual([])
  })

  it('type-checks every script the editor ships', () => {
    const scripts = [sampleProject(), ...TEMPLATES.map((t) => t.create())].flatMap((doc) =>
      doc.scripts.map((script) => ({ file: `${doc.name}-${script.name}.js`.replace(/[^\w.-]+/g, '_'), source: script.source })),
    )
    expect(scripts.length).toBeGreaterThan(5)
    expect(typeCheck(scripts)).toBe('')
  }, 60_000)

  it('the check is live: a script using something ctx lacks fails it', () => {
    const output = typeCheck([{ file: 'bad.js', source: "/** @type {import('engine').Script} */\nexport default { update(ctx) { ctx.teleportTo(1) } }\n" }])
    expect(output).toContain("Property 'teleportTo' does not exist")
  }, 60_000)
})

/** Runs tsc on scripts with the Monaco declarations; returns its output ('' when clean). */
function typeCheck(scripts: { file: string; source: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ge-script-types-'))
  try {
    writeFileSync(join(dir, 'engine.d.ts'), SCRIPT_TYPES)
    for (const { file, source } of scripts) writeFileSync(join(dir, file), source)
    const compilerOptions = { allowJs: true, checkJs: true, noEmit: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', lib: ['es2023', 'dom'], types: [] }
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['engine.d.ts', ...scripts.map((s) => s.file)] }))
    const tsc = spawnSync(process.execPath, [join(process.cwd(), 'node_modules/typescript/bin/tsc'), '-p', dir], { encoding: 'utf8' })
    return (tsc.stdout + tsc.stderr).trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
