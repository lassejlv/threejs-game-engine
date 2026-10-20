import { useEffect, useState } from 'react'
import { useStore } from '../../../react'
import type { AssetKind } from '../../assetLibrary'
import { assetLibrary, editorStore } from '../../editor'
import { Row, SelectField } from '../fields'
import { modelClips } from '../../runtime/nodes'

export function ClipSelect({ asset, value, onChange }: { asset: string | null; value: string; onChange: (clip: string) => void }) {
  const clips = useStore(modelClips, (s) => (asset ? s[asset] : undefined))
  if (!clips?.length && !value) return null
  return (
    <SelectField
      label="Animation"
      value={value}
      options={[['', 'None'], ...(clips ?? []).map((c) => [c, c] as const), ...(value && !clips?.includes(value) ? [[value, value] as const] : [])]}
      onChange={onChange}
    />
  )
}

/** Plays an audio asset in the editor (outside the game's audio graph). */
export function PreviewButton({ asset, volume }: { asset: string | null; volume: number }) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)
  useEffect(() => () => audio?.pause(), [audio])
  const url = asset ? assetLibrary.url(asset) : null
  return (
    <button
      type="button"
      disabled={!url}
      onClick={() => {
        if (audio) {
          audio.pause()
          setAudio(null)
          return
        }
        const el = new Audio(url!)
        el.volume = Math.min(1, volume)
        el.onended = () => setAudio(null)
        void el.play()
        setAudio(el)
      }}
    >
      {audio ? 'Stop preview' : 'Preview'}
    </button>
  )
}

export function AssetSelect({
  kind,
  label,
  value,
  onChange,
}: {
  kind: AssetKind
  label: string
  value: string | null
  onChange: (value: string | null) => void
}) {
  const assets = useStore(editorStore, (s) => s.assets)
  const options = assets.filter((a) => a.kind === kind)
  return (
    <Row label={label}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">None</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        {value && !options.some((a) => a.id === value) && <option value={value}>Missing asset</option>}
      </select>
    </Row>
  )
}

export function TextureField({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  return <AssetSelect kind="texture" label="Texture" value={value} onChange={onChange} />
}
