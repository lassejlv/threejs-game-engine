import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Vec3 } from '../document'
import { beginTransaction, endTransaction } from '../editor'

export interface FieldProps<T> {
  label: string
  value: T
  /** Called on every change; callers decide how changes group into undo steps. */
  onChange: (value: T) => void
}

export function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="field" title={title}>
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </div>
  )
}

interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  /** Label rendered inside the input that can be dragged to scrub the value. */
  prefix?: string
  prefixClass?: string
}

const format = (v: number) => String(Math.round(v * 1000) / 1000)

/** Number input with Unity-style drag-to-scrub on its prefix. Shift = 10x, Alt = 0.1x. */
export function NumberInput({ value, onChange, step = 0.1, min = -Infinity, max = Infinity, prefix, prefixClass }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useRef<{ x: number; start: number } | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  const commitDraft = () => {
    if (draft === null) return
    const parsed = Number(draft)
    if (Number.isFinite(parsed)) onChange(clamp(parsed))
    setDraft(null)
  }

  return (
    <div className="num">
      {prefix !== undefined && (
        <span
          className={`num-prefix ${prefixClass ?? ''}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            scrub.current = { x: e.clientX, start: value }
            beginTransaction()
          }}
          onPointerMove={(e) => {
            if (!scrub.current) return
            const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            const next = scrub.current.start + (e.clientX - scrub.current.x) * step * factor
            onChange(clamp(Math.round(next / (step * 0.1)) * step * 0.1))
          }}
          onPointerUp={() => {
            scrub.current = null
            endTransaction()
          }}
          onPointerCancel={() => {
            scrub.current = null
            endTransaction()
          }}
        >
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? format(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(clamp(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)))
          }
        }}
      />
    </div>
  )
}

export function NumberField({ label, value, onChange, ...rest }: FieldProps<number> & Omit<NumberInputProps, 'value' | 'onChange'>) {
  return (
    <Row label={label}>
      <NumberInput value={value} onChange={onChange} prefix="↔" prefixClass="num-prefix-plain" {...rest} />
    </Row>
  )
}

export function Vec3Field({ label, value, onChange, step = 0.1 }: FieldProps<Vec3> & { step?: number }) {
  const set = (i: number, v: number) => {
    const next = [...value] as Vec3
    next[i] = v
    onChange(next)
  }
  return (
    <Row label={label}>
      <div className="vec3">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <NumberInput
            key={axis}
            prefix={axis}
            prefixClass={`axis-${axis.toLowerCase()}`}
            value={value[i]}
            step={step}
            onChange={(v) => set(i, v)}
          />
        ))}
      </div>
    </Row>
  )
}

export function TextField({ label, value, onChange }: FieldProps<string>) {
  return (
    <Row label={label}>
      <TextInput value={value} onChange={onChange} />
    </Row>
  )
}

/** Commits on blur/Enter so typing doesn't create one undo step per keystroke. */
export function TextInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className={className}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onChange(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export function ColorField({ label, value, onChange }: FieldProps<string>) {
  return (
    <Row label={label}>
      <div className="color">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <code>{value}</code>
      </div>
    </Row>
  )
}

export function CheckField({ label, value, onChange }: FieldProps<boolean>) {
  return (
    <Row label={label}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: FieldProps<T> & { options: readonly (readonly [T, string])[] }) {
  return (
    <Row label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </Row>
  )
}

export function Section({
  title,
  icon,
  onRemove,
  children,
  defaultOpen = true,
}: {
  title: string
  icon?: ReactNode
  onRemove?: () => void
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="section">
      <header className="section-header">
        <button type="button" className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className={`caret ${open ? 'open' : ''}`}>▸</span>
          {icon}
          <span>{title}</span>
        </button>
        {onRemove && (
          <button type="button" className="icon-button" onClick={onRemove} title={`Remove ${title}`} aria-label={`Remove ${title}`}>
            ×
          </button>
        )}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  )
}
