export interface AiFormOption {
  id: string
  label: string
  description?: string
}

interface AiFieldBase {
  id: string
  label: string
  required: boolean
}
export type AiFormField =
  | (AiFieldBase & { type: 'text' | 'textarea'; placeholder?: string; maxLength: number })
  | (AiFieldBase & { type: 'number'; placeholder?: string; min?: number; max?: number })
  | (AiFieldBase & { type: 'date'; min?: string; max?: string })
  | (AiFieldBase & { type: 'single-choice' | 'multiple-choice'; options: AiFormOption[] })

export interface AiInteractionForm {
  id: string
  title?: string
  submitLabel: string
  fields: AiFormField[]
}

export type AiFormValue = string | number | string[] | null
export type AiFormAnswers = Record<string, AiFormValue>
