import { useEffect, useReducer } from 'react'
import { MathUtils, Vector3 } from 'three'
import { teleport } from '../../engine'
import type { ParamValue, Vec3 } from '../document'
import type { Animator } from '../runtime/animator'
import { activeSessions } from '../runtime/playSession'
import { CheckField, ColorField, NumberField, Row, Section, TextField, Vec3Field } from './fields'
import { Icon } from './icons'

const REFRESH_MS = 150
const round = (v: number) => Math.round(v * 1000) / 1000
const vec = (v: { x: number; y: number; z: number }): Vec3 => [round(v.x), round(v.y), round(v.z)]

/**
 * The selected entity as it is right now in the running game. Edits change the
 * running game only; stopping play throws them away, like every play-mode change.
 */
export function LiveInspector({ docId }: { docId: string }) {
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const session = [...activeSessions][0]
  const live = session?.inspect(docId)
  if (!session) return null
  if (!live) {
    return (
      <Section title="Live (playing)" icon={<Icon name="play" />}>
        <p className="hint">Not in the running game (destroyed, inactive, or in another scene).</p>
      </Section>
    )
  }
  const { handle, scripts } = live
  const o = handle.object
  const body = handle.body
  const animator = o.userData.animator as Animator | undefined

  const setPosition = (p: Vec3) => {
    const v = new Vector3(...p)
    if (body) {
      teleport(body, v)
      body.velocity.set(0, 0, 0)
    } else o.position.copy(v)
  }

  return (
    <Section title="Live (playing)" icon={<Icon name="play" />}>
      <p className="hint">Updates as the game runs. Edits affect this play session only.</p>
      <Vec3Field label="Position" value={vec(body ? body.position : o.position)} onChange={setPosition} />
      <Vec3Field
        label="Rotation"
        value={[o.rotation.x, o.rotation.y, o.rotation.z].map((r) => round(MathUtils.radToDeg(r))) as Vec3}
        step={1}
        onChange={([x, y, z]) => o.rotation.set(MathUtils.degToRad(x), MathUtils.degToRad(y), MathUtils.degToRad(z))}
      />
      <Vec3Field label="Scale" value={vec(o.scale)} step={0.05} onChange={(s) => o.scale.set(...s)} />
      <CheckField label="Visible" value={o.visible} onChange={(v) => (o.visible = v)} />
      {body && (
        <>
          <Vec3Field label="Velocity" value={vec(body.velocity)} onChange={(v) => body.velocity.set(...v)} />
          <Row label="Grounded">
            <span className={`live-flag ${body.grounded ? 'on' : ''}`}>{body.grounded ? 'yes' : 'no'}</span>
          </Row>
        </>
      )}
      {animator && (
        <Row label="Animation">
          <span className="live-value">{animator.current ?? 'none'}</span>
        </Row>
      )}
      {scripts.map((script, i) => (
        <div key={i} className="live-script">
          <div className="subhead">
            {script.name}
            {script.failed && <span className="badge error">disabled after an error</span>}
          </div>
          {Object.entries(script.params).map(([key, value]) => (
            <LiveParam key={key} name={key} value={value} onChange={(v) => ((script.params as Record<string, ParamValue>)[key] = v)} />
          ))}
          {Object.entries(script.state).map(([key, value]) => (
            <Row key={key} label={key} title="ctx.state (read only)">
              <span className="live-value">{describe(value)}</span>
            </Row>
          ))}
        </div>
      ))}
    </Section>
  )
}

function LiveParam({ name, value, onChange }: { name: string; value: ParamValue; onChange: (v: ParamValue) => void }) {
  if (typeof value === 'number') return <NumberField label={name} value={round(value)} step={Math.abs(value) >= 10 ? 1 : 0.05} onChange={onChange} />
  if (typeof value === 'boolean') return <CheckField label={name} value={value} onChange={onChange} />
  if (/^#[0-9a-f]{6}$/i.test(value)) return <ColorField label={name} value={value} onChange={onChange} />
  return <TextField label={name} value={value} onChange={onChange} />
}

/** Short readable form of a script state value. */
function describe(value: unknown): string {
  if (typeof value === 'number') return String(round(value))
  if (typeof value === 'string' || typeof value === 'boolean' || value == null) return String(value)
  if (value instanceof Vector3) return `(${vec(value).join(', ')})`
  if (Array.isArray(value)) return `[${value.length} items]`
  if (typeof value === 'function') return 'function'
  try {
    const text = JSON.stringify(value)
    return text.length > 60 ? `${text.slice(0, 57)}…` : text
  } catch {
    return 'object'
  }
}
