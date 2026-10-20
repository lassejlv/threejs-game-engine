// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { componentDefaults, createEntity } from '../document'
import { addEntity, createPrefab, editorStore, endTransaction, newProject, select, undo } from '../editor'
import { Inspector } from './Inspector'

const s = () => editorStore.get()
const entities = () => s().doc.scenes[0].entities
const byName = (name: string) => entities().find((e) => e.name === name)!

/** The inputs of the inspector field with this label (Vec3 fields have three). */
function inputs(label: string): HTMLInputElement[] {
  const labels = screen.getAllByText(label, { selector: '.field-label' })
  return [...labels[0].closest('.field')!.querySelectorAll('input')] as HTMLInputElement[]
}

/** Types a value into a number/text input and commits it, like a user pressing Enter. */
function type(input: HTMLInputElement, value: string) {
  act(() => {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
  })
}

beforeEach(() => {
  newProject(true) // Main Camera, Directional Light, Ground (a mesh cube); empty history
  endTransaction()
})

afterEach(() => cleanup())

describe('Inspector', () => {
  it('edits the selected entity and records one named undo step', () => {
    act(() => select(byName('Ground').id))
    render(<Inspector />)
    const [, y] = inputs('Position')
    type(y, '2.5')
    expect(byName('Ground').transform.position[1]).toBe(2.5)
    expect(s().history.at(-1)).toMatch(/Ground/)
    act(() => undo())
    expect(byName('Ground').transform.position[1]).toBe(-0.5)
  })

  it('edits every selected entity that has the field, in a single step', () => {
    const crate = createEntity('Crate', { mesh: componentDefaults.mesh() })
    act(() => addEntity(crate))
    act(() => {
      select(byName('Ground').id)
      select(crate.id, true)
    })
    render(<Inspector />)
    const before = s().history.length
    type(inputs('Roughness')[0], '0.25')
    expect(byName('Ground').mesh!.roughness).toBe(0.25)
    expect(byName('Crate').mesh!.roughness).toBe(0.25)
    expect(s().history.length).toBe(before + 1)
    act(() => undo())
    expect(byName('Crate').mesh!.roughness).not.toBe(0.25)
    expect(byName('Ground').mesh!.roughness).not.toBe(0.25)
  })

  it('overrides a prefab part on one instance without touching the prefab, and reverts it', () => {
    act(() => createPrefab(byName('Ground').id))
    const instance = byName('Ground')
    expect(instance.prefab).toBeTruthy()
    const prefab = s().doc.prefabs[0]
    const partId = prefab.entities[0].id
    act(() => select(instance.id))
    render(<Inspector />)
    expect(screen.getByText('Prefab: Ground')).toBeTruthy()

    type(inputs('Roughness')[0], '0.1')
    expect(byName('Ground').overrides?.[partId]?.mesh).toMatchObject({ roughness: 0.1 })
    expect(s().doc.prefabs[0].entities[0].mesh!.roughness).toBe(prefab.entities[0].mesh!.roughness) // prefab unchanged
    expect(screen.getByText(/Overridden here: mesh/)).toBeTruthy()

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Revert this part' })))
    expect(byName('Ground').overrides).toBeUndefined()
  })

  it('shows scene settings when nothing is selected, and edits them', () => {
    act(() => select(null))
    render(<Inspector />)
    expect(screen.getByText(/These settings apply to the whole scene/)).toBeTruthy()
    type(inputs('Exposure')[0], '1.5')
    expect(s().doc.scenes[0].settings.exposure).toBe(1.5)
    expect(s().history.at(-1)).toBeTruthy()
  })
})
