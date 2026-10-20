import { type EntityDoc, type ParamValue, type ProjectDoc, type ScriptRefDoc } from '../../document'
import { editorStore, updateEntity } from '../../editor'
import { resolveBehavior, scriptLabel } from '../../scripting'
import { Row, Section, SelectField } from '../fields'
import { Icon } from '../icons'
import { ParamFields } from './EntityInspector'

export function ScriptSection({
  entity,
  index,
  scriptRef,
  doc,
  options,
}: {
  entity: EntityDoc
  index: number
  scriptRef: ScriptRefDoc
  doc: ProjectDoc
  options: [string, string][]
}) {
  const behavior = resolveBehavior(scriptRef.script, doc)
  const update = (patch: Partial<ScriptRefDoc>, key: string) =>
    updateEntity(
      entity.id,
      (e) => ({ scripts: e.scripts.map((s, i) => (i === index ? { ...s, ...patch } : s)) }),
      { merge: `${entity.id}.script${index}.${key}` },
    )
  const remove = () => updateEntity(entity.id, (e) => ({ scripts: e.scripts.filter((_, i) => i !== index) }))
  const setParam = (key: string, value: ParamValue) => update({ params: { ...scriptRef.params, [key]: value } }, key)
  const isProjectScript = !scriptRef.script.startsWith('builtin:')

  return (
    <Section title={scriptLabel(scriptRef.script, doc)} icon={<Icon name="script" />} onRemove={remove}>
      <SelectField label="Script" value={scriptRef.script} options={options} onChange={(script) => update({ script, params: {} }, 'script')} />
      {behavior instanceof Error ? (
        <p className="error-text">{behavior.message}</p>
      ) : (
        <>
          {behavior.description && <p className="hint">{behavior.description}</p>}
          <ParamFields params={behavior.params} values={scriptRef.params} onChange={setParam} />
        </>
      )}
      {isProjectScript && (
        <Row label="">
          <button type="button" onClick={() => editorStore.set({ openScript: scriptRef.script })}>
            Edit script
          </button>
        </Row>
      )}
    </Section>
  )
}
