import { memo, useEffect, useMemo, useState } from 'react'
import { type NodeProps, Handle, Position } from '@xyflow/react'
import { FormInput, Plus, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFlowDirection, getSourcePosition } from './flow-direction-context'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { NodeExecutionFooter } from './node-status-bar'

export interface FormTriggerFieldConfig {
  id: string
  key: string
  label: string
  placeholder?: string
  required?: boolean
  multiline?: boolean
  defaultValue?: string
}

export interface FormTriggerConfig {
  title?: string
  submitLabel?: string
  fields?: FormTriggerFieldConfig[]
  lastSubmission?: string
}

export interface FormTriggerNodeData {
  label: string
  config: FormTriggerConfig
  isRunning?: boolean
  runtimeStatus?: string
  onEditConfig: (nodeId: string, config: FormTriggerConfig) => void | Promise<void>
  onSubmit: (nodeId: string, values: Record<string, string>, config: FormTriggerConfig) => void | Promise<void>
  [key: string]: unknown
}

function sanitizeFieldKey(value: string, index: number): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || `field_${index + 1}`
}

function normalizeField(field: Partial<FormTriggerFieldConfig> | undefined, index: number): FormTriggerFieldConfig {
  const rawLabel = typeof field?.label === 'string' ? field.label.trim() : ''
  const keySource = typeof field?.key === 'string' && field.key.trim().length > 0 ? field.key : rawLabel
  const key = sanitizeFieldKey(keySource, index)
  const id = typeof field?.id === 'string' && field.id.trim().length > 0
    ? field.id.trim()
    : `form-field-${index + 1}-${key}`
  return {
    id,
    key,
    label: rawLabel || `Field ${index + 1}`,
    placeholder: typeof field?.placeholder === 'string' ? field.placeholder : '',
    required: field?.required === true,
    multiline: field?.multiline === true,
    defaultValue: typeof field?.defaultValue === 'string' ? field.defaultValue : ''
  }
}

function normalizeFields(input: FormTriggerFieldConfig[] | undefined): FormTriggerFieldConfig[] {
  if (!Array.isArray(input)) return []
  const normalized = input.map((field, index) => normalizeField(field, index))
  const seenKeys = new Map<string, number>()
  return normalized.map((field) => {
    const count = seenKeys.get(field.key) ?? 0
    seenKeys.set(field.key, count + 1)
    if (count === 0) return field
    return { ...field, key: `${field.key}_${count + 1}` }
  })
}

function createDefaultField(index: number): FormTriggerFieldConfig {
  return {
    id: `form-field-${Date.now().toString(36)}-${index}`,
    key: `field_${index + 1}`,
    label: `Field ${index + 1}`,
    placeholder: '',
    required: false,
    multiline: false,
    defaultValue: ''
  }
}

function FormTriggerNodeInner({ id, data, selected }: NodeProps): React.ReactElement {
  const { label, config, isRunning, runtimeStatus, onEditConfig, onSubmit } = data as unknown as FormTriggerNodeData
  const fields = useMemo(() => normalizeFields(config?.fields), [config?.fields])
  const submitLabel = config?.submitLabel?.trim() || 'Submit'
  const formTitle = config?.title?.trim()

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})

  const [editTitle, setEditTitle] = useState(formTitle ?? '')
  const [editSubmitLabel, setEditSubmitLabel] = useState(submitLabel)
  const [editFields, setEditFields] = useState<FormTriggerFieldConfig[]>(fields)

  const fieldSignature = useMemo(
    () => fields.map((field) => `${field.id}:${field.key}:${field.defaultValue ?? ''}`).join('|'),
    [fields]
  )

  useEffect(() => {
    setValues((prev) => {
      const next: Record<string, string> = {}
      for (const field of fields) {
        next[field.key] = prev[field.key] ?? field.defaultValue ?? ''
      }
      return next
    })
  }, [fieldSignature, fields])

  useEffect(() => {
    if (!open) return
    setEditTitle(formTitle ?? '')
    setEditSubmitLabel(submitLabel)
    setEditFields(fields)
  }, [open, formTitle, submitLabel, fields])

  const missingRequired = fields.some((field) => field.required && !(values[field.key] ?? '').trim())

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const normalized = normalizeFields(editFields)
      await Promise.resolve(
        onEditConfig(id, {
          ...config,
          title: editTitle.trim() || undefined,
          submitLabel: editSubmitLabel.trim() || undefined,
          fields: normalized
        })
      )
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    if (missingRequired || submitting || isRunning) return
    setSubmitting(true)
    try {
      const payload: Record<string, string> = {}
      for (const field of fields) {
        payload[field.key] = values[field.key] ?? ''
      }
      await Promise.resolve(
        onSubmit(id, payload, {
          ...config,
          title: formTitle || undefined,
          submitLabel,
          fields
        })
      )
    } finally {
      setSubmitting(false)
    }
  }

  const direction = useFlowDirection()
  const sourcePos = getSourcePosition(direction)

  return (
    <>
      <div
        className={cn(
          'w-[280px] rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md',
          selected && 'ring-2 ring-primary',
          isRunning && 'border-emerald-500/50 shadow-emerald-500/10 shadow-md'
        )}
        onDoubleClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <Handle
          type="source"
          position={sourcePos}
          className="!h-3 !w-3 !border-2 !border-emerald-300 !bg-emerald-500"
        />

        <div className="mb-2 flex items-start gap-2">
          <FormInput className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{label || 'Form Trigger'}</p>
            {formTitle ? (
              <p className="truncate text-[10px] text-muted-foreground">{formTitle}</p>
            ) : (
              <p className="text-[10px] text-muted-foreground/60">Double-click to edit form</p>
            )}
          </div>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(true)
            }}
            title="Edit form"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {fields.length > 0 ? (
          <div className="space-y-1.5">
            {fields.map((field) => (
              <div key={field.id} className="space-y-1">
                <label className="block text-[10px] font-medium text-foreground/85">
                  {field.label}
                  {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                </label>
                {field.multiline ? (
                  <textarea
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        [field.key]: event.target.value
                      }))
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    rows={2}
                    placeholder={field.placeholder || field.label}
                    className="w-full resize-none rounded border bg-background px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring/50"
                  />
                ) : (
                  <Input
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        [field.key]: event.target.value
                      }))
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    placeholder={field.placeholder || field.label}
                    className="h-7 text-[11px]"
                  />
                )}
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              className="mt-1 h-7 w-full text-[11px]"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                void handleSubmit()
              }}
              disabled={missingRequired || submitting || isRunning}
            >
              {submitting || isRunning ? 'Submitting...' : submitLabel}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="w-full rounded border border-dashed px-2 py-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(true)
            }}
          >
            Configure form fields
          </button>
        )}

        <NodeExecutionFooter
          status={runtimeStatus}
          isRunning={isRunning}
          className="-mb-3 -mx-3 mt-2 px-3 py-1.5"
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-[760px]"
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Form Trigger</DialogTitle>
            <DialogDescription>
              Configure fields shown on the node. Submitting the form will start execution from this node.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground/80">Form title</label>
                <Input
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground/80">Submit button label</label>
                <Input
                  value={editSubmitLabel}
                  onChange={(event) => setEditSubmitLabel(event.target.value)}
                  placeholder="Submit"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-foreground/80">Fields</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-[11px]"
                  onClick={() =>
                    setEditFields((prev) => [...prev, createDefaultField(prev.length)])
                  }
                >
                  <Plus className="h-3 w-3" />
                  Add field
                </Button>
              </div>

              {editFields.length === 0 ? (
                <p className="rounded border border-dashed p-2 text-[11px] text-muted-foreground">
                  No fields configured. Add a field to render inputs on the node.
                </p>
              ) : null}

              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {editFields.map((field, index) => (
                  <div key={field.id} className="space-y-2 rounded border bg-muted/20 p-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-foreground/80">Label</label>
                        <Input
                          value={field.label}
                          onChange={(event) =>
                            setEditFields((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, label: event.target.value } : item
                              )
                            )
                          }
                          placeholder="Field label"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-foreground/80">Key</label>
                        <Input
                          value={field.key}
                          onChange={(event) =>
                            setEditFields((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, key: event.target.value } : item
                              )
                            )
                          }
                          placeholder="field_key"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-foreground/80">Placeholder</label>
                        <Input
                          value={field.placeholder ?? ''}
                          onChange={(event) =>
                            setEditFields((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, placeholder: event.target.value } : item
                              )
                            )
                          }
                          placeholder="Optional placeholder"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-foreground/80">Default value</label>
                        <Input
                          value={field.defaultValue ?? ''}
                          onChange={(event) =>
                            setEditFields((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, defaultValue: event.target.value } : item
                              )
                            )
                          }
                          placeholder="Optional default value"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-[11px]">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={field.required === true}
                            onChange={(event) =>
                              setEditFields((prev) =>
                                prev.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, required: event.target.checked } : item
                                )
                              )
                            }
                            className="h-3.5 w-3.5 rounded border accent-emerald-600"
                          />
                          Required
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={field.multiline === true}
                            onChange={(event) =>
                              setEditFields((prev) =>
                                prev.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, multiline: event.target.checked } : item
                                )
                              )
                            }
                            className="h-3.5 w-3.5 rounded border accent-emerald-600"
                          />
                          Multiline
                        </label>
                      </div>

                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setEditFields((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const FormTriggerNode = memo(FormTriggerNodeInner)
