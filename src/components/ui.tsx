import type { ReactNode } from 'react'
import './ui.css'

export function Button(props: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'default' | 'danger'
  title?: string
}) {
  const variant = props.variant ?? 'default'
  return (
    <button
      className={`btn ${variant}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      type="button"
    >
      {props.children}
    </button>
  )
}

export function TextInput(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'password' | 'number'
}) {
  return (
    <input
      className="input"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      type={props.type ?? 'text'}
    />
  )
}

export function TextArea(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      className="input"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      rows={props.rows ?? 5}
      style={{ resize: 'vertical' }}
    />
  )
}

export function NumberInput(props: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      className="input"
      value={Number.isFinite(props.value) ? String(props.value) : ''}
      onChange={(e) => props.onChange(e.currentTarget.valueAsNumber)}
      type="number"
      min={props.min}
      max={props.max}
    />
  )
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{props.label}</div>
      {props.children}
      {props.hint ? <div className="field-hint">{props.hint}</div> : null}
    </div>
  )
}

export function Card(props: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="card">
      {props.title ? (
        <div className="card-head">
          <div className="card-title">{props.title}</div>
          {props.right ? <div className="card-right">{props.right}</div> : null}
        </div>
      ) : null}
      <div className="card-body">{props.children}</div>
    </div>
  )
}

export function InlineCode(props: { children: ReactNode }) {
  return <span className="code">{props.children}</span>
}
