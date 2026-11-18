import Editor, { DiffEditor, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'

loader.config({ monaco })

const journalEditorTheme = 'development-journal'
monaco.editor.defineTheme(journalEditorTheme, {
  base: 'vs-dark',
  inherit: false,
  rules: [
    { token: 'comment', foreground: 'B7A5B3', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C8AEFA' },
    { token: 'type', foreground: 'AECBFF' },
    { token: 'number', foreground: 'AECBFF' },
    { token: 'constant', foreground: 'AECBFF' },
    { token: 'string', foreground: 'FFC0C8' },
    { token: 'regexp', foreground: 'EBADDD' },
    { token: 'tag', foreground: 'C8AEFA' },
    { token: 'attribute.name', foreground: 'EBADDD' },
    { token: 'attribute.value', foreground: 'FFC0C8' },
    { token: 'delimiter', foreground: 'D5CAD4' },
    { token: 'metatag', foreground: 'AECBFF' },
  ],
  colors: {
    'editor.background': '#211e22',
    'editor.foreground': '#F2E9EE',
    'editorCursor.foreground': '#FBBBD0',
    'editorLineNumber.foreground': '#AD9BA6',
    'editorLineNumber.activeForeground': '#F2E9EE',
    'editor.lineHighlightBackground': '#352932',
    'editor.selectionBackground': '#81435D',
    'editor.inactiveSelectionBackground': '#664759',
    'editorBracketHighlight.foreground1': '#FBBBD0',
    'editorBracketHighlight.foreground2': '#C8AEFA',
    'editorBracketHighlight.foreground3': '#AECBFF',
    'editorBracketMatch.background': '#613E56',
    'editorBracketMatch.border': '#DBA0BD',
    'editorHint.foreground': '#C8AEFA',
    'editorSuggestWidget.highlightForeground': '#FBBBD0',
    'editorGutter.addedBackground': '#B5A1F3',
    'editorOverviewRuler.addedForeground': '#B5A1F3',
    'diffEditor.insertedTextBackground': '#B5A1F34D',
    'diffEditor.insertedLineBackground': '#B5A1F326',
    'diffEditorGutter.insertedLineBackground': '#69508A',
    'diffEditorOverview.insertedForeground': '#B5A1F3',
    'diffEditor.removedTextBackground': '#E887A455',
    'diffEditor.removedLineBackground': '#E887A429',
    'diffEditorGutter.removedLineBackground': '#884359',
    'diffEditorOverview.removedForeground': '#E887A4',
  },
})

function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLocaleLowerCase()
  const languages: Record<string, string> = {
    py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', html: 'html', css: 'css', scss: 'scss', md: 'markdown', yml: 'yaml',
    yaml: 'yaml', sql: 'sql', sh: 'shell', bash: 'shell', xml: 'xml', java: 'java',
    go: 'go', rs: 'rust', cpp: 'cpp', c: 'c',
  }
  return extension ? languages[extension] ?? 'plaintext' : 'plaintext'
}

type Props = {
  path: string
  value: string
  readOnly: boolean
  onChange: (value: string) => void
  initialLine?: number | null
  initialColumn?: number | null
  focusOnReveal?: boolean
  revealToken?: number
  onCursorChange?: (line: number) => void
}

export default function MonacoCodeEditor({ path, value, readOnly, onChange, initialLine, initialColumn, focusOnReveal, revealToken, onCursorChange }: Props) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const cursorListener = useRef<monaco.IDisposable | null>(null)
  const cursorCallback = useRef(onCursorChange)
  cursorCallback.current = onCursorChange
  const reveal = () => {
    const editor = editorRef.current
    if (!editor || !initialLine) return
    const line = Math.max(1, Math.min(initialLine, editor.getModel()?.getLineCount() ?? 1))
    const column = Math.max(1, Math.min(initialColumn ?? 1, editor.getModel()?.getLineMaxColumn(line) ?? 1))
    editor.setPosition({ lineNumber: line, column })
    editor.revealLineInCenter(line)
    if (focusOnReveal) editor.focus()
  }
  useEffect(() => { reveal() }, [path, initialLine, initialColumn, focusOnReveal, revealToken])
  useEffect(() => () => cursorListener.current?.dispose(), [])
  return <Editor
    height="100%"
    language={languageForPath(path)}
    theme={journalEditorTheme}
    path={path}
    value={value}
    onMount={(editor) => {
      editorRef.current = editor
      cursorListener.current?.dispose()
      cursorListener.current = editor.onDidChangeCursorPosition(event => cursorCallback.current?.(event.position.lineNumber))
      reveal()
    }}
    onChange={(nextValue) => onChange(nextValue ?? '')}
    options={{
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "Consolas, 'Courier New', monospace",
      tabSize: 4,
      insertSpaces: true,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      renderLineHighlight: 'line',
      padding: { top: 12, bottom: 12 },
      bracketPairColorization: { enabled: true },
      guides: { indentation: true },
    }}
  />
}

export function MonacoDiffViewer({ original, modified, modelScope, path, sideBySide }: { original: string; modified: string; modelScope: string; path: string; sideBySide: boolean }) {
  return <DiffEditor height="360px" original={original} modified={modified} language={languageForPath(path)} theme={journalEditorTheme} originalModelPath={`${modelScope}/before/${path}`} modifiedModelPath={`${modelScope}/after/${path}`} options={{ readOnly: true, originalEditable: false, renderSideBySide: sideBySide, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', fontSize: 13, diffAlgorithm: 'advanced', maxComputationTime: 1000 }} />
}
