import Editor, { DiffEditor, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'

loader.config({ monaco })

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
    theme="vs-dark"
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
  return <DiffEditor height="360px" original={original} modified={modified} language={languageForPath(path)} theme="vs-dark" originalModelPath={`${modelScope}/before/${path}`} modifiedModelPath={`${modelScope}/after/${path}`} options={{ readOnly: true, originalEditable: false, renderSideBySide: sideBySide, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', fontSize: 13, diffAlgorithm: 'advanced', maxComputationTime: 1000 }} />
}
