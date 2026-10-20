import type { InstancedMesh, Light, Material, Mesh, Object3D, Texture } from 'three'

export interface DisposeOptions {
  /** Also dispose textures referenced by materials. Default false (they are usually shared/cached). */
  textures?: boolean
}

/** Frees GPU resources (geometry, materials, optionally textures) under `root`. */
export function disposeObject(root: Object3D, { textures = false }: DisposeOptions = {}): void {
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>
    mesh.geometry?.dispose()
    const material = mesh.material
    if (Array.isArray(material)) for (const m of material) disposeMaterial(m, textures)
    else if (material) disposeMaterial(material, textures)
    if ((object as InstancedMesh).isInstancedMesh) (object as InstancedMesh).dispose()
    // Frees shadow map render targets.
    if ((object as Light).isLight) (object as Light).dispose()
  })
}

function disposeMaterial(material: Material, textures: boolean): void {
  if (textures) {
    for (const value of Object.values(material)) {
      if (value && typeof value === 'object' && (value as Texture).isTexture) (value as Texture).dispose()
    }
  }
  material.dispose()
}
