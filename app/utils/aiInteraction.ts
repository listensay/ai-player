import type { AiFormAnswers, AiFormField, AiInteractionForm } from '../types/aiInteraction'
import { isRecord } from './guide.ts'
import { validDate } from './studyProgram.ts'

function fail(): never {
  throw new Error('AI 表单格式无效，请重试。')
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail()
  return value.trim()
}
function id(value: unknown) {
  const result = text(value, 64)
  if (!/^[a-z][a-z0-9_-]*$/i.test(result) || ['constructor', 'prototype'].includes(result.toLowerCase())) fail()
  return result
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail()
}

/** AI may describe controls, never executable components, HTML, events or styles. */
export function parseAiInteractionForm(raw: unknown): AiInteractionForm {
  if (!isRecord(raw) || JSON.stringify(raw).length > 40000) fail()
  keys(raw, ['id', 'title', 'submitLabel', 'fields'])
  if (!Array.isArray(raw.fields) || !raw.fields.length || raw.fields.length > 8) fail()
  const fields = raw.fields.map((field): AiFormField => {
    if (!isRecord(field)) fail()
    if (field.required !== undefined && typeof field.required !== 'boolean') fail()
    const base = { id: id(field.id), label: text(field.label, 300), required: field.required !== false }
    if (field.type === 'single-choice' || field.type === 'multiple-choice') {
      keys(field, ['id', 'type', 'label', 'required', 'options'])
      if (!Array.isArray(field.options) || field.options.length < 2 || field.options.length > 12) fail()
      const options = field.options.map((option) => {
        if (!isRecord(option)) fail()
        keys(option, ['id', 'label', 'description'])
        return {
          id: id(option.id),
          label: text(option.label, 300),
          ...(option.description !== undefined ? { description: text(option.description, 800) } : {}),
        }
      })
      if (new Set(options.map((option) => option.id)).size !== options.length) fail()
      return { ...base, type: field.type, options }
    }
    if (field.type === 'text' || field.type === 'textarea') {
      keys(field, ['id', 'type', 'label', 'required', 'placeholder', 'maxLength'])
      const maxLength = field.maxLength ?? 4000
      if (typeof maxLength !== 'number' || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 4000) fail()
      return {
        ...base,
        type: field.type,
        maxLength,
        ...(field.placeholder !== undefined ? { placeholder: text(field.placeholder, 300) } : {}),
      }
    }
    if (field.type === 'number') {
      keys(field, ['id', 'type', 'label', 'required', 'placeholder', 'min', 'max'])
      for (const value of [field.min, field.max])
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9))
          fail()
      if (field.min !== undefined && field.max !== undefined && Number(field.min) > Number(field.max)) fail()
      return {
        ...base,
        type: 'number',
        ...(field.min !== undefined ? { min: field.min as number } : {}),
        ...(field.max !== undefined ? { max: field.max as number } : {}),
        ...(field.placeholder !== undefined ? { placeholder: text(field.placeholder, 300) } : {}),
      }
    }
    if (field.type === 'date') {
      keys(field, ['id', 'type', 'label', 'required', 'min', 'max'])
      for (const value of [field.min, field.max]) if (value !== undefined && !validDate(value)) fail()
      if (field.min !== undefined && field.max !== undefined && String(field.min) > String(field.max)) fail()
      return {
        ...base,
        type: 'date',
        ...(field.min !== undefined ? { min: field.min as string } : {}),
        ...(field.max !== undefined ? { max: field.max as string } : {}),
      }
    }
    return fail()
  })
  if (new Set(fields.map((field) => field.id)).size !== fields.length) fail()
  return {
    id: id(raw.id),
    submitLabel: text(raw.submitLabel, 80),
    fields,
    ...(raw.title !== undefined ? { title: text(raw.title, 300) } : {}),
  }
}

export function validateAiFormAnswers(form: AiInteractionForm, raw: unknown): AiFormAnswers {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !form.fields.some((field) => field.id === key))) fail()
  const answers: AiFormAnswers = {}
  for (const field of form.fields) {
    const value = raw[field.id]
    const empty =
      value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)
    if (empty) {
      if (field.required) throw new Error(`请填写“${field.label}”。`)
      answers[field.id] = null
      continue
    }
    if (field.type === 'single-choice' || field.type === 'multiple-choice') {
      const selected = field.type === 'single-choice' ? [value] : value
      if (
        !Array.isArray(selected) ||
        selected.length > field.options.length ||
        new Set(selected).size !== selected.length ||
        selected.some((choice) => typeof choice !== 'string' || !field.options.some((option) => option.id === choice))
      )
        throw new Error(`请重新选择“${field.label}”。`)
      answers[field.id] = field.type === 'single-choice' ? (value as string) : ([...selected] as string[])
    } else if (field.type === 'number') {
      const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
      if (!Number.isFinite(number) || number < (field.min ?? -1e9) || number > (field.max ?? 1e9))
        throw new Error(`“${field.label}”的数字无效。`)
      answers[field.id] = number
    } else if (field.type === 'date') {
      if (!validDate(value) || value < (field.min ?? '0000-00-00') || value > (field.max ?? '9999-12-31'))
        throw new Error(`“${field.label}”的日期无效。`)
      answers[field.id] = value
    } else {
      if (typeof value !== 'string' || !value.trim() || !('maxLength' in field) || value.length > field.maxLength)
        throw new Error(`请检查“${field.label}”的内容。`)
      answers[field.id] = value.trim()
    }
  }
  return answers
}

export function aiFormAnswerText(form: AiInteractionForm, answers: AiFormAnswers) {
  return form.fields
    .map((field) => {
      const value = answers[field.id]
      if (value == null) return `${field.label}：未填写`
      const display =
        field.type === 'single-choice' || field.type === 'multiple-choice'
          ? (Array.isArray(value) ? value : [value])
              .map((choice) => {
                const option = field.options.find((item) => item.id === choice)!
                return `${option.label}${option.description ? `（${option.description}）` : ''}`
              })
              .join('；')
          : String(value)
      return `${field.label}：${display}`
    })
    .join('\n')
}
