import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

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
}

export default function MonacoCodeEditor({ path, value, readOnly, onChange }: Props) {
  return <Editor
    height="100%"
    language={languageForPath(path)}
    theme="vs-dark"
    path={path}
    value={value}
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
