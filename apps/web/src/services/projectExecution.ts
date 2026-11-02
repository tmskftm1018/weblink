/** Recognize the exported full-stack layout; this is guidance, not code execution. */
export function projectExecutionMode(files: { path: string }[]): 'COMPOSE' | 'PYTHON' | 'MISSING' {
  const paths = new Set(files.map(file => file.path))
  if (paths.has('compose.yaml') && paths.has('web/package.json') && paths.has('api/main.py')) return 'COMPOSE'
  return paths.has('main.py') ? 'PYTHON' : 'MISSING'
}
