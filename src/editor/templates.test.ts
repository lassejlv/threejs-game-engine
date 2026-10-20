import { describe, expect, it } from 'vitest'
import { type EntityDoc, expandEntities, type ProjectDoc } from './document'
import { parseProject } from './projectFormat'
import { resolveBehavior } from './scripting'
import { TEMPLATES } from './templates'

function allEntities(doc: ProjectDoc): EntityDoc[] {
  return [...doc.scenes.flatMap((s) => expandEntities(s.entities, doc.prefabs)), ...doc.prefabs.flatMap((p) => p.entities)]
}

describe.each(TEMPLATES)('template $name', (template) => {
  it('survives a save and reload unchanged', () => {
    const doc = template.create()
    expect(parseProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
  })

  it('only references scripts, params and prefabs that exist', () => {
    const doc = template.create()
    const prefabIds = new Set(doc.prefabs.map((p) => p.id))
    for (const entity of allEntities(doc)) {
      if (entity.prefab) expect(prefabIds.has(entity.prefab), `${entity.name} → prefab`).toBe(true)
      for (const ref of entity.scripts) {
        const behavior = resolveBehavior(ref.script, doc)
        if (behavior instanceof Error) throw new Error(`${entity.name}: ${ref.script}: ${behavior.message}`)
        for (const key of Object.keys(ref.params)) expect(behavior.params, `${entity.name}: ${behavior.name}.${key}`).toHaveProperty(key)
      }
    }
  })

  it('has a main camera in the start scene', () => {
    const doc = template.create()
    const start = doc.scenes[0]
    const cameras = expandEntities(start.entities, doc.prefabs).filter((e) => e.camera?.main)
    expect(cameras).toHaveLength(1)
    if (template.view2D) expect(cameras[0].camera?.projection).toBe('orthographic')
  })

  it('creates fresh ids each time', () => {
    expect(template.create().scenes[0].id).not.toBe(template.create().scenes[0].id)
  })
})
