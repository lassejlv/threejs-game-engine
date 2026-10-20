import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generate } from '../../scripts/gen-docs.mjs'

describe('docs', () => {
  it('docs/script-api.md matches the script typings (run `node scripts/gen-docs.mjs` after changing them)', () => {
    const source = readFileSync(new URL('./scriptTypes.ts', import.meta.url), 'utf8')
    const committed = readFileSync(new URL('../../docs/script-api.md', import.meta.url), 'utf8')
    expect(committed).toBe(generate(source))
  })
})
