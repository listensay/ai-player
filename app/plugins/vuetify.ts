import { h } from 'vue'
import { createVuetify } from 'vuetify'
import { VApp, VBtn, VBtnToggle, VCard, VCheckbox, VChip, VDialog, VExpansionPanels, VExpansionPanel, VExpansionPanelTitle, VExpansionPanelText, VFileInput, VList, VListItem, VMenu, VRadio, VRadioGroup, VSelect, VSlider, VTextField, VTextarea } from 'vuetify/components'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleCheck, CircleAlert, CircleDot, Info, Minus, Paperclip, Plus, Square, SquareCheck, SquareMinus, X } from '@lucide/vue'
import { zhHans } from 'vuetify/locale'

const iconAliases = {
  complete: Check, cancel: X, close: X, delete: X, clear: X, success: CircleCheck, info: Info,
  warning: CircleAlert, error: CircleAlert, prev: ChevronLeft, next: ChevronRight,
  checkboxOn: SquareCheck, checkboxOff: Square, checkboxIndeterminate: SquareMinus,
  radioOn: CircleDot, radioOff: Circle, dropdown: ChevronDown, expand: ChevronDown,
  subgroup: ChevronDown, collapse: ChevronUp, plus: Plus, minus: Minus, file: Paperclip,
}

export const vuetify = createVuetify({
  components: { VApp, VBtn, VBtnToggle, VCard, VCheckbox, VChip, VDialog, VExpansionPanels, VExpansionPanel, VExpansionPanelTitle, VExpansionPanelText, VFileInput, VList, VListItem, VMenu, VRadio, VRadioGroup, VSelect, VSlider, VTextField, VTextarea },
  locale: { locale: 'zhHans', messages: { zhHans } },
  icons: {
    defaultSet: 'lucide', aliases: iconAliases,
    sets: { lucide: { component: props => h(props.tag, [h(typeof props.icon === 'string' ? (iconAliases[props.icon as keyof typeof iconAliases] ?? Circle) : props.icon as typeof Circle, { size: 20, 'aria-hidden': 'true' })]) } },
  },
  theme: {
    defaultTheme: 'warmPaper',
    themes: { warmPaper: {
      dark: false,
      colors: {
        background: '#f9f4f2', surface: '#ffffff', 'surface-variant': '#f1ebe6',
        'on-background': '#2d2c2b', 'on-surface': '#2d2c2b', 'on-surface-variant': '#44423f',
        primary: '#0061ef', secondary: '#3b197f', ink: '#2d2c2b', sunbeam: '#ffce00',
        error: '#b3261e', info: '#3b197f', success: '#3b197f', warning: '#ffce00',
      },
      variables: { 'border-color': '#e2ded9', 'border-opacity': 1, 'high-emphasis-opacity': 1, 'medium-emphasis-opacity': .78 },
    } },
  },
  defaults: {
    VBtn: { rounded: 'pill', elevation: 0, style: 'text-transform:none;letter-spacing:-.01em;font-weight:700' },
    VCard: { rounded: 'xl', elevation: 0, border: true },
    VDialog: { scrim: '#2d2c2b', opacity: .4 },
    VMenu: { offset: 6 },
    VExpansionPanels: { variant: 'accordion', flat: true, static: true },
    VTextField: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto', color: 'secondary', bgColor: 'surface', rounded: 'lg' },
    VTextarea: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto', color: 'secondary', bgColor: 'surface', rounded: 'lg' },
    VFileInput: { variant: 'outlined', density: 'comfortable', hideDetails: 'auto', color: 'secondary', bgColor: 'surface', rounded: 'lg', prependIcon: '', appendInnerIcon: '$file' },
    VSlider: { density: 'compact', hideDetails: true, elevation: 0, trackSize: 4, thumbSize: 14, trackColor: '#e2ded9', trackFillColor: '#2d2c2b', thumbColor: '#ffce00' },
    VSelect: { variant: 'outlined', density: 'compact', hideDetails: true, color: 'secondary', bgColor: 'surface', rounded: 'lg', menuProps: { maxHeight: 280 } },
    VCheckbox: { density: 'compact', hideDetails: true, color: 'secondary' },
    VRadio: { density: 'comfortable', color: 'secondary' },
    VChip: { size: 'small', variant: 'tonal', rounded: 'pill' },
  },
})
