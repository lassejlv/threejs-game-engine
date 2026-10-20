import { useStore } from '../../../react'
import { CheckField, NumberField, Row, SelectField, TextField } from '../fields'
import type { AnimStateDef, AnimTransitionDef } from '../../runtime/animator'
import { modelClips } from '../../runtime/nodes'

export function AnimStatesEditor({
  asset,
  states,
  transitions,
  onChange,
}: {
  asset: string | null
  states: AnimStateDef[]
  transitions: AnimTransitionDef[]
  onChange: (patch: { animStates?: AnimStateDef[]; animTransitions?: AnimTransitionDef[] }, field: string) => void
}) {
  const clips = useStore(modelClips, (s) => (asset ? s[asset] : undefined)) ?? []
  const clipOptions = (value: string) => [['', 'None'] as const, ...clips.map((c) => [c, c] as const), ...(value && !clips.includes(value) ? [[value, value] as const] : [])]
  const setState = (i: number, patch: Partial<AnimStateDef>, key: string) => {
    const old = states[i]
    const next = states.map((st, k) => (k === i ? { ...st, ...patch } : st))
    // Renaming a state keeps its transitions pointing at it.
    const renamed = patch.name !== undefined && patch.name !== old.name
    onChange(
      renamed
        ? {
            animStates: next,
            animTransitions: transitions.map((t) => ({ ...t, from: t.from === old.name ? patch.name! : t.from, to: t.to === old.name ? patch.name! : t.to })),
          }
        : { animStates: next },
      `state${i}.${key}`,
    )
  }
  const setTransition = (i: number, patch: Partial<AnimTransitionDef>, key: string) =>
    onChange({ animTransitions: transitions.map((t, k) => (k === i ? { ...t, ...patch } : t)) }, `transition${i}.${key}`)
  const stateOptions = states.map((st) => [st.name, st.name] as const)

  if (states.length === 0) {
    return (
      <Row label="">
        <button
          type="button"
          onClick={() => onChange({ animStates: [{ name: 'Idle', clip: clips[0] ?? '', blendParam: '', blend: [], speed: 1, loop: true }] }, 'states.add')}
        >
          Use a state machine
        </button>
      </Row>
    )
  }
  return (
    <div className="anim-machine">
      <div className="subhead">Animation states (first one starts)</div>
      {states.map((st, i) => (
        <div key={i} className="anim-state">
          <TextField label="State" value={st.name} onChange={(name) => name && setState(i, { name }, 'name')} />
          <CheckField label="Blend by parameter" value={st.blendParam !== ''} onChange={(on) => setState(i, { blendParam: on ? 'speed' : '', blend: on && !st.blend.length ? [{ clip: st.clip, at: 0 }] : st.blend }, 'blendOn')} />
          {st.blendParam === '' ? (
            <SelectField label="Clip" value={st.clip} options={clipOptions(st.clip)} onChange={(clip) => setState(i, { clip }, 'clip')} />
          ) : (
            <>
              <TextField label="Parameter" value={st.blendParam} onChange={(blendParam) => blendParam && setState(i, { blendParam }, 'param')} />
              {st.blend.map((b, k) => (
                <div key={k} className="blend-point">
                  <SelectField label={`Clip ${k + 1}`} value={b.clip} options={clipOptions(b.clip)} onChange={(clip) => setState(i, { blend: st.blend.map((x, j) => (j === k ? { ...x, clip } : x)) }, `blend${k}.clip`)} />
                  <NumberField label="At value" value={b.at} step={0.1} onChange={(at) => setState(i, { blend: st.blend.map((x, j) => (j === k ? { ...x, at } : x)) }, `blend${k}.at`)} />
                </div>
              ))}
              <Row label="">
                <button type="button" onClick={() => setState(i, { blend: [...st.blend, { clip: '', at: (st.blend.at(-1)?.at ?? 0) + 1 }] }, 'blend.add')}>
                  Add blend clip
                </button>
              </Row>
            </>
          )}
          <NumberField label="Speed" value={st.speed} step={0.05} min={0} onChange={(speed) => setState(i, { speed }, 'speed')} />
          <CheckField label="Loop" value={st.loop} onChange={(loop) => setState(i, { loop }, 'loop')} />
          <Row label="">
            <button
              type="button"
              onClick={() =>
                onChange(
                  { animStates: states.filter((_, k) => k !== i), animTransitions: transitions.filter((t) => t.from !== st.name && t.to !== st.name) },
                  'state.remove',
                )
              }
            >
              Remove state
            </button>
          </Row>
        </div>
      ))}
      <Row label="">
        <button type="button" onClick={() => onChange({ animStates: [...states, { name: `State ${states.length + 1}`, clip: '', blendParam: '', blend: [], speed: 1, loop: true }] }, 'state.add')}>
          Add state
        </button>
      </Row>
      <div className="subhead">Transitions (first match wins)</div>
      {transitions.map((t, i) => (
        <div key={i} className="anim-state">
          <SelectField label="From" value={t.from} options={[['*', 'Any state'], ...stateOptions]} onChange={(from) => setTransition(i, { from }, 'from')} />
          <SelectField label="To" value={t.to} options={stateOptions} onChange={(to) => setTransition(i, { to }, 'to')} />
          <TextField label="When" value={t.when} onChange={(when) => setTransition(i, { when }, 'when')} />
          <CheckField label="After clip ends" value={t.afterEnd} onChange={(afterEnd) => setTransition(i, { afterEnd }, 'end')} />
          <NumberField label="Fade (s)" value={t.fade} step={0.05} min={0} onChange={(fade) => setTransition(i, { fade }, 'fade')} />
          <Row label="">
            <button type="button" onClick={() => onChange({ animTransitions: transitions.filter((_, k) => k !== i) }, 'transition.remove')}>
              Remove transition
            </button>
          </Row>
        </div>
      ))}
      <Row label="">
        <button
          type="button"
          onClick={() => onChange({ animTransitions: [...transitions, { from: states[0].name, to: states[states.length - 1].name, when: '', fade: 0.2, afterEnd: false }] }, 'transition.add')}
        >
          Add transition
        </button>
      </Row>
      <p className="hint">
        Conditions read parameters set by scripts: <code>speed &gt; 0.1 &amp;&amp; grounded</code>, <code>!grounded</code>, or a trigger name
        like <code>jump</code> (ctx.animation.trigger). PlayerController sets speed, verticalSpeed and grounded.
      </p>
    </div>
  )
}
