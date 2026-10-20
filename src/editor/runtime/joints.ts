import { Vector3 } from 'three'
import { type Entity, joint } from '../../engine'
import type { JointDoc } from '../document'

/** Engine joint data from a joint doc: degrees become radians, local units get the entity's scale. */
export function jointData(j: JointDoc, target: Entity | null, worldScale: Vector3) {
  const angular = j.type === 'hinge'
  const unit = (v: number) => (angular ? (v * Math.PI) / 180 : v)
  return joint(j.type, target, {
    anchor: new Vector3(...j.anchor).multiply(worldScale),
    axis: new Vector3(...j.axis),
    limits: j.limits ? [unit(j.min), unit(j.max)] : null,
    restLength: j.restLength,
    stiffness: j.stiffness,
    damping: j.damping,
    motorSpeed: unit(j.motorSpeed),
    motorStrength: j.motorStrength,
  })
}
