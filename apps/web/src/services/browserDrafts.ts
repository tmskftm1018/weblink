export type BrowserDraft = { version: number; answers: Record<string, string>; baseAnswers?: Record<string, string>; updatedAt?: string }

export function parseBrowserDraft(raw: string | null): BrowserDraft | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as BrowserDraft
    if (!value || !Number.isInteger(value.version) || value.version < 0 || !value.answers || typeof value.answers !== 'object' || Array.isArray(value.answers)) return null
    if (!Object.values(value.answers).every(item => typeof item === 'string')) return null
    if (value.baseAnswers !== undefined && (!value.baseAnswers || typeof value.baseAnswers !== 'object' || Array.isArray(value.baseAnswers) || !Object.values(value.baseAnswers).every(item => typeof item === 'string'))) return null
    if (value.updatedAt !== undefined && (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)))) return null
    return value
  } catch { return null }
}

export function readBrowserDraft(key: string): BrowserDraft | null {
  // Each tab keeps its own copy, so another tab cannot replace unsaved work here.
  try { const draft = parseBrowserDraft(window.sessionStorage.getItem(key)); if (draft) return draft } catch { /* Try persistent recovery. */ }
  try { return parseBrowserDraft(window.localStorage.getItem(key)) } catch { return null }
}

export function writeBrowserDraft(key: string, draft: BrowserDraft): 'persistent' | 'session' | 'unavailable' {
  const raw = JSON.stringify(draft)
  let stored = false
  try { window.sessionStorage.setItem(key, raw); stored = true } catch { /* Storage may be disabled or full. */ }
  try { window.localStorage.setItem(key, raw); return 'persistent' } catch { /* Session copy can still help. */ }
  return stored ? 'session' : 'unavailable'
}

export function clearBrowserDraft(key: string, draft: BrowserDraft): void {
  // Clear only the exact copy that was saved or explicitly dismissed.
  // A save finishing in this tab must not remove another tab's newer recovery.
  for (const kind of ['sessionStorage', 'localStorage'] as const) {
    try {
      const storage = window[kind]
      const current = parseBrowserDraft(storage.getItem(key))
      if (current && current.version === draft.version && JSON.stringify(current.answers) === JSON.stringify(draft.answers)) storage.removeItem(key)
    } catch { /* Recovery storage is optional. */ }
  }
}
