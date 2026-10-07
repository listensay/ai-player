export const PROGRAMMING_LANGUAGES = {
  javascript: { name: 'JavaScript', extension: 'js' },
  typescript: { name: 'TypeScript', extension: 'ts' },
  python: { name: 'Python', extension: 'py' },
  java: { name: 'Java', extension: 'java' },
  c: { name: 'C', extension: 'c' },
  cpp: { name: 'C++', extension: 'cpp' },
  csharp: { name: 'C#', extension: 'cs' },
  go: { name: 'Go', extension: 'go' },
  rust: { name: 'Rust', extension: 'rs' },
  ruby: { name: 'Ruby', extension: 'rb' },
  php: { name: 'PHP', extension: 'php' },
  swift: { name: 'Swift', extension: 'swift' },
  kotlin: { name: 'Kotlin', extension: 'kt' },
  shell: { name: 'Shell', extension: 'sh' },
  powershell: { name: 'PowerShell', extension: 'ps1' },
  lua: { name: 'Lua', extension: 'lua' },
  perl: { name: 'Perl', extension: 'pl' },
  r: { name: 'R', extension: 'r' },
} as const
export type ProgrammingLanguage = keyof typeof PROGRAMMING_LANGUAGES
export function isProgrammingLanguage(value: unknown): value is ProgrammingLanguage {
  return typeof value === 'string' && Object.hasOwn(PROGRAMMING_LANGUAGES, value)
}
export function programmingLanguageName(language: ProgrammingLanguage) {
  return PROGRAMMING_LANGUAGES[language].name
}
export function usesFunctionInterface(language: ProgrammingLanguage) {
  return ['javascript', 'typescript', 'python'].includes(language)
}

export function programmingFilename(language: ProgrammingLanguage) {
  if (language === 'java') return 'Main.java'
  if (language === 'kotlin') return 'Main.kt'
  if (language === 'csharp') return 'Program.cs'
  return `solution.${PROGRAMMING_LANGUAGES[language].extension}`
}
