export type Entity = number

/** Typed handle for a component kind. Data lives in the World, not here. */
export interface ComponentType<T> {
  readonly id: number
  readonly name: string
  /** Phantom field that carries the value type. Never set at runtime. */
  readonly __type?: T
}

// `any` is needed so differently-typed components fit in one list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyComponent = ComponentType<any>

export type ComponentValue<C> = C extends ComponentType<infer T> ? T : never

let nextComponentId = 0

export function defineComponent<T>(name: string): ComponentType<T> {
  return { id: nextComponentId++, name }
}

/** A data-less marker component. Add it with `world.add(e, Tag)`. */
export function defineTag(name: string): ComponentType<true> {
  return defineComponent<true>(name)
}
