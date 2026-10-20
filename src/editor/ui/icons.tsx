import type { EntityDoc } from '../document'

const paths = {
  cube: 'M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8zM2.5 4.8 8 7.8l5.5-3M8 7.8v6.4',
  light: 'M8 2.5a3.5 3.5 0 0 0-2 6.4V11h4V8.9a3.5 3.5 0 0 0-2-6.4zM6.5 13h3',
  camera: 'M2 5h8v6H2zM10 7l4-2v6l-4-2',
  empty: 'M8 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7z',
  model: 'M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8zM8 7.8v6.4M2.5 4.8 8 7.8l5.5-3M5.2 3.3l5.5 3',
  script: 'M5.5 3.5 2.5 8l3 4.5M10.5 3.5l3 4.5-3 4.5',
  texture: 'M2.5 2.5h11v11h-11zM2.5 10.5l3.5-3.5 3 3 2-2 2.5 2.5',
  folder: 'M2 4.5h4l1.5 1.5H14v6.5H2z',
  play: 'M5 3.5v9l7-4.5z',
  pause: 'M5 3.5h2v9H5zM9 3.5h2v9H9z',
  stop: 'M4 4h8v8H4z',
  step: 'M4 3.5v9l6-4.5zM11 3.5h1.5v9H11z',
  move: 'M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2',
  rotate: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3',
  scale: 'M2.5 9.5v4h4M2.5 13.5 13.5 2.5M9.5 2.5h4v4',
  magnet: 'M4 2.5v5a4 4 0 0 0 8 0v-5M4 5h2.5M9.5 5H12M6.5 2.5v5a1.5 1.5 0 0 0 3 0v-5',
  undo: 'M5.5 4 2.5 7l3 3M2.5 7h7a4 4 0 0 1 0 8H8',
  redo: 'M10.5 4l3 3-3 3M13.5 7h-7a4 4 0 0 0 0 8H8',
  plus: 'M8 3v10M3 8h10',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  body: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11zM8 5.5v5M5.5 8h5',
  collider: 'M3 3h10v10H3z',
  prefab: 'M8 1.8 13.5 4.8v6.4L8 14.2 2.5 11.2V4.8zM8 5v6M5.4 6.5 8 8l2.6-1.5',
  scene: 'M2 3.5h12v9H2zM2 10l3.5-3 3 2.5L11 7l3 3',
  audio: 'M3 6h2.5L9 3v10L5.5 10H3zM11.5 5.5a3.5 3.5 0 0 1 0 5M13 4a5.5 5.5 0 0 1 0 8',
  particles: 'M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.5 1.5M10.5 10.5 12 12M4 12l1.5-1.5M10.5 5.5 12 4',
  build: 'M8 2v8M4.5 6.5 8 10l3.5-3.5M3 12.5h10',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4a2 2 0 0 0 0-4z',
  settings: 'M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function entityIcon(entity: EntityDoc): IconName {
  if (entity.camera) return 'camera'
  if (entity.light) return 'light'
  if (entity.model) return 'model'
  if (entity.mesh) return 'cube'
  if (entity.particles) return 'particles'
  return 'empty'
}
