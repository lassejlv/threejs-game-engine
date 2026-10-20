import { type EntityDoc, type ProjectDoc } from './types'

/**
 * Where an asset is used, as readable descriptions ("Coin Rush › Ground: Mesh texture").
 * Covers component fields, scene skies, and scripts that name it (sound.play('jump')).
 */
export function assetReferences(doc: ProjectDoc, id: string, fileName: string): string[] {
  const names = new Set([fileName, fileName.replace(/\.\w+$/, '')])
  const out: string[] = []
  const check = (where: string, e: EntityDoc) => {
    const uses: string[] = []
    const m = e.mesh
    if (m) {
      const slots: [string | null, string][] = [
        [m.map, 'Mesh texture'],
        [m.normalMap, 'Normal map'],
        [m.roughnessMap, 'Roughness map'],
        [m.metalnessMap, 'Metalness map'],
        [m.emissiveMap, 'Emissive map'],
      ]
      for (const [value, label] of slots) if (value === id) uses.push(label)
    }
    if (e.model?.asset === id) uses.push('Model')
    if (e.model?.lods.some((l) => l.asset === id)) uses.push('Model LOD')
    if (e.audio?.asset === id) uses.push('Audio Source')
    if (e.particles?.texture === id) uses.push('Particle texture')
    if (e.terrain?.texture === id) uses.push('Terrain texture')
    if (e.sprite?.texture === id) uses.push('Sprite')
    for (const ref of e.scripts) {
      if (Object.values(ref.params).some((v) => typeof v === 'string' && names.has(v))) uses.push('script parameter')
    }
    if (uses.length) out.push(`${where} › ${e.name}: ${uses.join(', ')}`)
  }
  for (const scene of doc.scenes) {
    if (scene.settings.skyTexture === id) out.push(`${scene.name}: sky`)
    if (scene.settings.music === id) out.push(`${scene.name}: music`)
    for (const el of scene.ui) if (el.image === id) out.push(`${scene.name} › UI ${el.name}: image`)
    for (const e of scene.entities) check(scene.name, e)
  }
  for (const prefab of doc.prefabs) for (const e of prefab.entities) check(`Prefab ${prefab.name}`, e)
  for (const script of doc.scripts) {
    if ([...names].some((n) => script.source.includes(`'${n}'`) || script.source.includes(`"${n}"`))) out.push(`Script ${script.name}`)
  }
  return out
}
