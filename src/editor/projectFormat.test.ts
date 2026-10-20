import { describe, expect, it } from 'vitest'
import v1 from './fixtures/v1.json'
import v2 from './fixtures/v2.json'
import v3 from './fixtures/v3.json'
import { FORMAT_VERSION } from './document'
import { checkReferences, ENGINE_VERSION, MIGRATIONS, parseProject, ProjectFormatError, serializableProject } from './projectFormat'

const fixtures = { v1, v2, v3 }

describe('project format', () => {
  it('has a migration for every older version', () => {
    expect(MIGRATIONS.map((m) => m.from)).toEqual(Array.from({ length: FORMAT_VERSION - 1 }, (_, i) => i + 1))
  })

  describe.each(Object.entries(fixtures))('%s fixture', (name, fixture) => {
    it('opens to the same document as before (golden snapshot)', async () => {
      await expect(JSON.stringify(parseProject(fixture), null, 2)).toMatchFileSnapshot(`./fixtures/__snapshots__/${name}.parsed.json`)
    })

    it('opens identically after saving it again', () => {
      const once = parseProject(fixture)
      expect(parseProject(JSON.parse(JSON.stringify(serializableProject(once))))).toEqual({ ...once, engine: ENGINE_VERSION })
    })
  })

  it('carries old data through the migrations', () => {
    const doc = parseProject(v1)
    expect(doc.scenes).toHaveLength(1)
    expect(doc.scenes[0].settings).toMatchObject({ background: '#223344', gravity: 20 })
    const crate = doc.scenes[0].entities.find((e) => e.id === 'box')!
    expect(crate.rigidBody).toMatchObject({ type: 'kinematic', mass: 2 })
    expect(doc.scenes[0].entities.find((e) => e.id === 'lid')!.parent).toBe('box')
    expect(doc.engine).toBe('pre-1.0')

    const second = parseProject(v2)
    expect(second.settings.renderer).toBe('webgl') // added after format 2
    expect(second.scenes[0].entities.find((e) => e.id === 'e1')!.overrides).toEqual({ 'enemy-root': { mesh: { color: '#ff0000' } } })
    expect(second.prefabs[0].entities[0].mesh).toMatchObject({ shape: 'capsule', color: '#cc3333', opacity: 1 })
  })

  it('reads a current file exactly as written', () => {
    expect(parseProject(v3)).toEqual(v3)
  })

  it('refuses files from a newer editor', () => {
    expect(() => parseProject({ ...v3, version: FORMAT_VERSION + 1 })).toThrow(/newer editor/)
  })

  it('explains what is broken, and where', () => {
    const broken = structuredClone(v3) as Record<string, any>
    broken.scenes[0].entities[1].transform.position = [0, 'up', 0]
    broken.scenes[0].entities[2].id = broken.scenes[0].entities[0].id
    broken.prefabs = [{ id: 'p', name: 'Empty Prefab', entities: [] }]
    broken.scripts = [{ id: 's', name: 'Bad', source: 42 }]
    let error: unknown
    try {
      parseProject(broken)
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(ProjectFormatError)
    expect((error as ProjectFormatError).problems).toEqual([
      'Scene 1 "Main" › entity 2 "Directional Light": transform.position must be 3 numbers',
      'Scene 1 "Main" › entity 3 "Ground": id "cam" is used twice',
      'Prefab 1 "Empty Prefab": has no entities',
      'Script 1 "Bad": source must be text',
    ])
    expect((error as Error).message).toContain('This project file can\'t be opened:\n• Scene 1 "Main"')
    expect(() => parseProject([1, 2])).toThrow(/not a project/)
    expect(() => parseProject({ hello: 1 })).toThrow(/no format version/)
  })

  it('lists links to things that no longer exist', () => {
    const doc = parseProject(v2)
    doc.scenes[0].entities.push({ ...doc.scenes[0].entities[0], id: 'orphan', name: 'Orphan', parent: 'gone', prefab: 'nope', scripts: [{ script: 'deleted', params: {} }] })
    expect(checkReferences(doc)).toEqual([
      'Scene "Level" › "Orphan": its parent no longer exists',
      'Scene "Level" › "Orphan": its prefab no longer exists',
      'Scene "Level" › "Orphan": uses a script that no longer exists',
    ])
  })
})
