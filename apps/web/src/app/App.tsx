import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { authService, User } from '../services/auth'
import { AttemptResult, Course, Lesson, learningService } from '../services/learning'
import { connectionService, GoogleConnectionStatus, GoogleSheetValues } from '../services/connections'
import { ProjectSummary, ProjectVersion, ProjectVersionDetails, ProjectWorkspace, projectService } from '../services/projects'
import { bindProjectDirectory, chooseProjectDirectory, getProjectDirectory, moveProjectFileInDirectory, ProjectDirectory, readProjectDirectory, removeProjectFileFromDirectory, unbindProjectDirectory, writeProjectDirectory } from '../services/localProjects'
import ProjectFileTree, { buildProjectFileTree } from './ProjectFileTree'

type Mode = 'login' | 'signup'
type View = 'lesson' | 'projects' | 'workspace' | 'connections'
type NewProjectEntryKind = 'auto' | 'file' | 'folder'

function inferProjectEntryKind(path: string): Exclude<NewProjectEntryKind, 'auto'> {
  const name = path.replace(/\\/g, '/').split('/').pop()?.trim() ?? ''
  const extensionlessFiles = new Set(['dockerfile', 'makefile', 'license', 'procfile', 'gemfile', 'justfile'])
  if (extensionlessFiles.has(name.toLocaleLowerCase()) || name.startsWith('.')) return 'file'
  return name.lastIndexOf('.') > 0 ? 'file' : 'folder'
}

function uniqueProjectPath(path: string, files: ProjectWorkspace['files'], kind: Exclude<NewProjectEntryKind, 'auto'>): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '')
  const segments = normalized.split('/')
  const name = segments.pop() ?? ''
  const parent = segments.join('/')
  const lower = (value: string) => value.toLocaleLowerCase()
  if (parent && files.some((file) => lower(file.path) === lower(parent) || lower(parent).startsWith(`${lower(file.path)}/`))) {
    throw new Error(`‘${parent}’ 경로에 같은 이름의 파일이 있어 그 안에 항목을 만들 수 없습니다.`)
  }
  const conflicts = (candidate: string) => files.some((file) => {
    const existing = lower(file.path)
    const current = lower(candidate)
    return existing === current || (kind === 'folder' && existing.startsWith(`${current}/`))
      || (kind === 'file' && existing.startsWith(`${current}/`))
  })
  if (!conflicts(normalized)) return normalized
  const dot = kind === 'file' ? name.lastIndexOf('.') : -1
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidateName = `${stem} (${suffix})${extension}`
    const candidate = parent ? `${parent}/${candidateName}` : candidateName
    if (!conflicts(candidate)) return candidate
  }
  throw new Error('같은 이름의 항목이 너무 많아 새 이름을 정하지 못했습니다.')
}

const MonacoCodeEditor = lazy(() => import('./MonacoCodeEditor'))

function editorLanguage(path: string): string {
  const extension = path.split('.').pop()?.toLocaleLowerCase()
  const languages: Record<string, string> = {
    py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', html: 'html', css: 'css', scss: 'scss', md: 'markdown', yml: 'yaml',
    yaml: 'yaml', sql: 'sql', sh: 'shell', bash: 'shell', xml: 'xml', java: 'java',
    go: 'go', rs: 'rust', cpp: 'cpp', c: 'c',
  }
  return extension ? languages[extension] ?? 'plaintext' : 'plaintext'
}

function extractGoogleSpreadsheetId(value: string): string | null {
  const trimmed = value.trim()
  if (/^[A-Za-z0-9_-]{10,200}$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null
    const match = url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [mode, setMode] = useState<Mode>('signup')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [courses, setCourses] = useState<Course[]>([])
  const [course, setCourse] = useState<Course | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [lessonLoading, setLessonLoading] = useState(false)
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null)
  const [assembledBlocks, setAssembledBlocks] = useState<string[]>([])
  const [view, setView] = useState<View>('lesson')
  const [googleConnection, setGoogleConnection] = useState<GoogleConnectionStatus | null>(null)
  const [connectionsBusy, setConnectionsBusy] = useState(false)
  const [connectionsError, setConnectionsError] = useState('')
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [sheetRange, setSheetRange] = useState("'시트1'!A1:Z100")
  const [sheetPreview, setSheetPreview] = useState<GoogleSheetValues | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectSearch, setProjectSearch] = useState('')
  const [projectFolders, setProjectFolders] = useState<Record<string, string>>({})
  const [archiveToImport, setArchiveToImport] = useState<File | null>(null)
  const [archiveProjectName, setArchiveProjectName] = useState('')
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null)
  const [localProjectDirectory, setLocalProjectDirectory] = useState<ProjectDirectory | null>(null)
  const [pendingProjectDirectory, setPendingProjectDirectory] = useState<ProjectDirectory | null>(null)
  const [projectVersions, setProjectVersions] = useState<ProjectVersion[]>([])
  const [versionPreview, setVersionPreview] = useState<ProjectVersionDetails | null>(null)
  const [selectedPath, setSelectedPath] = useState('')
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([])
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [newEntryPath, setNewEntryPath] = useState('')
  const [newEntryKind, setNewEntryKind] = useState<NewProjectEntryKind>('auto')
  const [showNewEntryForm, setShowNewEntryForm] = useState(false)
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectDirty, setProjectDirty] = useState(false)
  const [projectNeedsReload, setProjectNeedsReload] = useState(false)
  const [projectNotice, setProjectNotice] = useState('')
  const [projectError, setProjectError] = useState('')
  const [runResult, setRunResult] = useState<Awaited<ReturnType<typeof projectService.getRun>> | null>(null)
  const [debugHypothesis, setDebugHypothesis] = useState('')
  const [expectedOutput, setExpectedOutput] = useState('')
  const [debugSaved, setDebugSaved] = useState(false)
  const [debugHint, setDebugHint] = useState<Awaited<ReturnType<typeof projectService.requestDebugHint>> | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLocaleLowerCase()
    return projects.filter((project) => `${project.name} ${project.description}`.toLocaleLowerCase().includes(query))
  }, [projects, projectSearch])
  const projectFileTree = useMemo(() => buildProjectFileTree(workspace?.files ?? []), [workspace?.files])
  const blockPalette = useMemo(() => {
    const blocks = lesson?.content.block_activity?.blocks ?? []
    const shuffled = [...blocks]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }
    return shuffled
  }, [lesson?.id])
  const sheetValidation = useMemo(() => {
    if (!sheetPreview) return null
    const values = sheetPreview.values
    const headers = values[0]?.map((value) => String(value).trim()) ?? []
    const issues: string[] = []
    if (headers.length === 0) issues.push('첫 행에 열 제목을 입력해 주세요.')
    if (headers.some((header) => !header)) issues.push('비어 있는 열 제목이 있어요.')
    if (new Set(headers.map((header) => header.toLocaleLowerCase())).size !== headers.length) {
      issues.push('중복된 열 제목이 있어요.')
    }
    const keys = new Set<string>()
    let invalidRows = 0
    for (const row of values.slice(1)) {
      if (row.length !== headers.length || !String(row[0] ?? '').trim()) {
        invalidRows += 1
        continue
      }
      const key = String(row[0]).trim()
      if (keys.has(key)) invalidRows += 1
      keys.add(key)
    }
    if (values.length < 2) issues.push('열 제목 아래에 데이터 행을 하나 이상 추가해 주세요.')
    if (invalidRows) issues.push(`${invalidRows}개 행에 첫 열이 비었거나 열 수가 맞지 않거나 고유 키가 중복돼 있어요.`)
    return { issues, validRows: Math.max(0, values.length - 1 - invalidRows) }
  }, [sheetPreview])

  useEffect(() => {
    authService.me().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function handleEditorShortcut(event: KeyboardEvent) {
      const target = event.target
      if (!(target instanceof HTMLElement) || !target.closest('.monaco-editor')) return
      const modifier = event.ctrlKey || event.metaKey
      if (!modifier || view !== 'workspace' || !workspace) return
      if (event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        if (!projectBusy && projectDirty) void saveProjectDraft()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (!projectBusy) void runProject()
      } else if (event.key.toLocaleLowerCase() === 'w') {
        event.preventDefault()
        event.stopPropagation()
        if (!projectBusy && selectedPath) closeProjectFile(selectedPath)
      }
    }
    window.addEventListener('keydown', handleEditorShortcut, true)
    return () => window.removeEventListener('keydown', handleEditorShortcut, true)
  }, [view, workspace, projectBusy, projectDirty, selectedPath, openFilePaths, saveProjectDraft, runProject])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLessonLoading(true)
    learningService.courses()
      .then(async (loadedCourses) => {
        if (cancelled) return
        setCourses(loadedCourses)
        const firstCourse = loadedCourses.find((item) => item.lessons.some((entry) => entry.status !== 'COMPLETED')) ?? loadedCourses[0]
        const firstLesson = firstCourse?.lessons.find((item) => item.status !== 'COMPLETED') ?? firstCourse?.lessons[0]
        setCourse(firstCourse ?? null)
        if (!firstCourse || !firstLesson) return
        const lessonDetails = await learningService.lesson(firstCourse.slug, firstLesson.slug)
        if (!cancelled) setLesson(lessonDetails)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '학습 내용을 불러오지 못했습니다.')
      })
      .finally(() => { if (!cancelled) setLessonLoading(false) })
    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    let cancelled = false
    Promise.all(projects.map(async (project) => {
      try {
        const directory = await getProjectDirectory(project.id)
        return [project.id, directory?.name ?? ''] as const
      } catch {
        return [project.id, ''] as const
      }
    })).then((entries) => {
      if (!cancelled) setProjectFolders(Object.fromEntries(entries.filter(([, name]) => name)))
    })
    return () => { cancelled = true }
  }, [projects])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    try {
      const authenticatedUser = mode === 'signup'
        ? await authService.signup({ email, password, display_name: String(form.get('display_name') ?? '') })
        : await authService.login({ email, password })
      setUser(authenticatedUser)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '인증 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    await authService.logout()
    setUser(null)
    setMode('login')
    setCourses([])
    setCourse(null)
    setLesson(null)
    setAttemptResult(null)
    setAssembledBlocks([])
    setProjects([])
    setWorkspace(null)
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    setProjectFolders({})
    setProjectVersions([])
    setVersionPreview(null)
    setView('lesson')
  }

  async function showProjects() {
    if (view === 'workspace' && projectDirty && workspace) {
      setProjectBusy(true)
      try {
        await persistWorkspaceDraft(workspace)
      } catch (cause) {
        setProjectError(cause instanceof Error ? cause.message : '먼저 초안을 저장해 주세요.')
        return
      } finally {
        setProjectBusy(false)
      }
    }
    setView('projects')
    setWorkspace(null)
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    setProjectError('')
    setProjectNotice('')
    setProjectBusy(true)
    try {
      setProjects(await projectService.list())
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트 목록을 불러오지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function showConnections() {
    if (view === 'workspace' && projectDirty && workspace) {
      setProjectBusy(true)
      try {
        await persistWorkspaceDraft(workspace)
      } catch (cause) {
        setProjectError(cause instanceof Error ? cause.message : '먼저 초안을 저장해 주세요.')
        return
      } finally {
        setProjectBusy(false)
      }
    }
    setView('connections')
    setConnectionsError('')
    setConnectionsBusy(true)
    try {
      setGoogleConnection(await connectionService.googleStatus())
    } catch (cause) {
      setConnectionsError(cause instanceof Error ? cause.message : '연결 상태를 불러오지 못했습니다.')
    } finally {
      setConnectionsBusy(false)
    }
  }

  async function startGoogleConnection() {
    setConnectionsBusy(true)
    setConnectionsError('')
    try {
      const result = await connectionService.startGoogle()
      window.location.assign(result.authorization_url)
    } catch (cause) {
      setConnectionsError(cause instanceof Error ? cause.message : 'Google 연결을 시작하지 못했습니다.')
      setConnectionsBusy(false)
    }
  }

  async function disconnectGoogleConnection() {
    setConnectionsBusy(true)
    setConnectionsError('')
    try {
      await connectionService.disconnectGoogle()
      setGoogleConnection(await connectionService.googleStatus())
      setSheetPreview(null)
    } catch (cause) {
      setConnectionsError(cause instanceof Error ? cause.message : 'Google 연결을 해제하지 못했습니다.')
    } finally {
      setConnectionsBusy(false)
    }
  }

  async function previewGoogleSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedId = extractGoogleSpreadsheetId(spreadsheetId)
    if (!normalizedId) {
      setConnectionsError('스프레드시트 ID 또는 docs.google.com의 Google Sheets 주소를 입력해 주세요.')
      setSheetPreview(null)
      return
    }
    setSpreadsheetId(normalizedId)
    setConnectionsBusy(true)
    setConnectionsError('')
    setSheetPreview(null)
    try {
      setSheetPreview(await connectionService.readGoogleSheet(normalizedId, sheetRange))
    } catch (cause) {
      setConnectionsError(cause instanceof Error ? cause.message : '스프레드시트를 읽지 못했습니다.')
    } finally {
      setConnectionsBusy(false)
    }
  }

  async function showLesson() {
    if (view === 'workspace' && projectDirty && workspace) {
      setProjectBusy(true)
      try {
        await persistWorkspaceDraft(workspace)
      } catch (cause) {
        setProjectError(cause instanceof Error ? cause.message : '먼저 초안을 저장해 주세요.')
        return
      } finally {
        setProjectBusy(false)
      }
    }
    setView('lesson')
    setProjectError('')
  }

  async function openLesson(lessonSlug: string) {
    if (!course || lesson?.slug === lessonSlug || lessonLoading) return
    setLessonLoading(true)
    setError('')
    setAttemptResult(null)
    setAssembledBlocks([])
    try {
      setLesson(await learningService.lesson(course.slug, lessonSlug))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '수업을 불러오지 못했습니다.')
    } finally {
      setLessonLoading(false)
    }
  }

  async function openCourse(courseSlug: string) {
    const selectedCourse = courses.find((item) => item.slug === courseSlug)
    if (!selectedCourse || selectedCourse.slug === course?.slug || lessonLoading) return
    const firstLesson = selectedCourse.lessons.find((item) => item.status !== 'COMPLETED') ?? selectedCourse.lessons[0]
    if (!firstLesson) return
    setLessonLoading(true)
    setError('')
    setAttemptResult(null)
    setAssembledBlocks([])
    try {
      const details = await learningService.lesson(selectedCourse.slug, firstLesson.slug)
      setCourse(selectedCourse)
      setLesson(details)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '코스를 불러오지 못했습니다.')
    } finally {
      setLessonLoading(false)
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProjectBusy(true)
    setProjectError('')
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    try {
      const created = await projectService.create({ name: newProjectName, description: newProjectDescription })
      setWorkspace(created)
      setProjectVersions([])
      setVersionPreview(null)
      resetProjectFiles(created.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNotice('새 프로젝트를 만들었습니다.')
      setView('workspace')
      setNewProjectName('')
      setNewProjectDescription('')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트를 만들지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function createSampleProject() {
    if (projectBusy) return
    setProjectBusy(true)
    setProjectError('')
    setProjectNotice('')
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    let createdId: string | null = null
    const files = [
      {
        path: 'README.md',
        content: '# 독서 기록 앱\n\n실행 버튼을 눌러 책을 추가하고 읽기 상태를 바꿔 보세요.\n\n- `main.py`: 프로그램의 시작점\n- `books.py`: SQLite 데이터베이스와 책 관리 함수\n\n책 기록은 프로젝트 전용 SQLite 데이터베이스(`/data/books.db`)에 저장되어 다음 실행에도 남습니다.\n',
      },
      {
        path: 'main.py',
        content: 'from books import add_book, initialize_database, list_books, mark_as_read\n\n\ndef show_books():\n    print("\\n내 책 목록")\n    for book in list_books():\n        status = "읽음" if book["is_read"] else "읽는 중"\n        print(f"- {book[\'title\']} / {book[\'author\']} ({status})")\n\n\ninitialize_database()\nadd_book("어린 왕자", "앙투안 드 생텍쥐페리")\nadd_book("모모", "미하엘 엔데")\nmark_as_read("어린 왕자")\nshow_books()\n',
      },
      {
        path: 'books.py',
        content: 'import sqlite3\n\nDATABASE_PATH = "/data/books.db"\n\n\ndef connect():\n    return sqlite3.connect(DATABASE_PATH)\n\n\ndef initialize_database():\n    with connect() as database:\n        database.execute(\n            """CREATE TABLE IF NOT EXISTS books (\n                title TEXT PRIMARY KEY,\n                author TEXT NOT NULL,\n                is_read INTEGER NOT NULL DEFAULT 0\n            )"""\n        )\n\n\ndef add_book(title, author):\n    with connect() as database:\n        database.execute(\n            "INSERT OR IGNORE INTO books (title, author) VALUES (?, ?)",\n            (title, author),\n        )\n\n\ndef mark_as_read(title):\n    with connect() as database:\n        database.execute(\n            "UPDATE books SET is_read = 1 WHERE title = ?",\n            (title,),\n        )\n\n\ndef list_books():\n    with connect() as database:\n        database.row_factory = sqlite3.Row\n        rows = database.execute(\n            "SELECT title, author, is_read FROM books ORDER BY title"\n        ).fetchall()\n        return [dict(row) for row in rows]\n',
      },
    ]
    try {
      const created = await projectService.create({
        name: '독서 기록 앱',
        description: 'Python과 SQLite로 책 기록을 저장하고 수정하는 실행 예제',
      })
      createdId = created.id
      await projectService.saveDraft(created.id, created.draft_version, files)
      const loaded = await projectService.get(created.id)
      setWorkspace(loaded)
      setProjects((current) => [loaded, ...current.filter((item) => item.id !== loaded.id)])
      setProjectVersions([])
      setVersionPreview(null)
      resetProjectFiles('main.py')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice('실행해 볼 수 있는 SQLite 예제 프로젝트를 만들었어요.')
      setView('workspace')
    } catch (cause) {
      if (createdId) await projectService.delete(createdId).catch(() => undefined)
      setProjectError(cause instanceof Error ? cause.message : '예제 프로젝트를 만들지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function createSheetsDatabaseProject() {
    const normalizedId = extractGoogleSpreadsheetId(spreadsheetId)
    const range = sheetPreview?.range
    if (!normalizedId || !range || !sheetPreview?.values.length || projectBusy) {
      setConnectionsError('먼저 사용할 Google Sheets 범위를 미리보기 해 주세요.')
      return
    }
    setProjectBusy(true)
    setConnectionsError('')
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    let createdProjectId: string | null = null
    try {
      const source = [
        'import json',
        'import sqlite3',
        'from weblink_api import get_google_sheet',
        '',
        `SPREADSHEET_ID = ${JSON.stringify(normalizedId)}`,
        `SHEET_RANGE = ${JSON.stringify(range)}`,
        '',
        'sheet = get_google_sheet(SPREADSHEET_ID, SHEET_RANGE)',
        "rows = sheet['values']",
        "if len(rows) < 2:",
        "    raise ValueError('헤더와 데이터 행이 있는 범위를 선택해 주세요.')",
        "headers = [str(value).strip() for value in rows[0]]",
        "if not headers or any(not header for header in headers) or len(set(headers)) != len(headers):",
        "    raise ValueError('열 제목은 비어 있거나 중복될 수 없습니다.')",
        'connection = sqlite3.connect("/data/sheets_import.db")',
        "connection.execute('CREATE TABLE IF NOT EXISTS sheet_rows (row_key TEXT PRIMARY KEY, data_json TEXT NOT NULL)')",
        "connection.execute('CREATE TEMP TABLE IF NOT EXISTS current_rows (row_key TEXT PRIMARY KEY, data_json TEXT NOT NULL)')",
        "connection.execute('BEGIN')",
        'inserted = updated = skipped = 0',
        'try:',
        '    for row in rows[1:]:',
        '        if len(row) != len(headers):',
        '            skipped += 1',
        '            continue',
        '        record = dict(zip(headers, row))',
        '        row_key = str(row[0]).strip()',
        '        if not row_key:',
        '            skipped += 1',
        '            continue',
        "        if connection.execute('SELECT 1 FROM current_rows WHERE row_key = ?', (row_key,)).fetchone():",
        '            skipped += 1',
        '            continue',
        "        exists = connection.execute('SELECT 1 FROM sheet_rows WHERE row_key = ?', (row_key,)).fetchone()",
        "        connection.execute('INSERT INTO current_rows VALUES (?, ?)', (row_key, json.dumps(record, ensure_ascii=False)))",
        '        if exists:',
        '            updated += 1',
        '        else:',
        '            inserted += 1',
        "    if skipped:",
        "        raise ValueError(f'잘못되거나 중복된 행 {skipped}개가 있어 기존 DB를 보호하기 위해 중단했습니다.')",
        "    if inserted + updated == 0:",
        "        raise ValueError('저장할 수 있는 행이 없어 기존 DB를 그대로 두었습니다.')",
        "    connection.execute('DELETE FROM sheet_rows WHERE row_key NOT IN (SELECT row_key FROM current_rows)')",
        "    connection.execute('INSERT OR REPLACE INTO sheet_rows SELECT * FROM current_rows')",
        '    connection.commit()',
        'except Exception:',
        '    connection.rollback()',
        '    connection.close()',
        '    raise',
        "total = connection.execute('SELECT COUNT(*) FROM sheet_rows').fetchone()[0]",
        "print(f'새로 저장: {inserted}행 · 갱신: {updated}행 · 제외: {skipped}행')",
        "print(f'프로젝트 DB 전체 행: {total}행')",
        'connection.close()',
        '',
        '# 첫 번째 열 값을 고유 키로 사용하며, 성공하면 삭제된 행까지 현재 시트와 일치시킵니다.',
        '# Google OAuth 비밀값은 이 코드에 들어가지 않으며 WebLink 연결을 통해서만 시트를 읽습니다.',
      ].join('\n')
      const created = await projectService.create({
        name: 'Google Sheets 데이터 연결',
        description: `시트 ${range}의 행을 프로젝트 SQLite DB에 저장하는 예제입니다.`,
      })
      createdProjectId = created.id
      const files = created.files.map((file) => file.path === 'main.py' ? { ...file, content: `${source}\n` } : file)
      await projectService.saveDraft(created.id, created.draft_version, files)
      const revisionResult = await projectService.createRevision(created.id)
      const [loaded, versions, projectList] = await Promise.all([
        projectService.get(created.id),
        projectService.listVersions(created.id),
        projectService.list(),
      ])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setProjects(projectList)
      resetProjectFiles('main.py')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setRunResult(null)
      setDebugSaved(false)
      setDebugHint(null)
      setProjectNotice('프로젝트를 만들었어요. 시트 데이터를 읽고 프로젝트 DB에 저장하고 있습니다…')
      setProjectError('')
      setView('workspace')
      setVersionPreview(null)
      let result = await projectService.run(created.id, revisionResult.revision.id)
      setRunResult(result)
      for (let attempt = 0; attempt < 60 && (result.status === 'QUEUED' || result.status === 'RUNNING'); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        result = await projectService.getRun(created.id, result.id)
        setRunResult(result)
      }
      setProjectNotice(result.status === 'SUCCEEDED'
        ? 'Google Sheets 데이터를 프로젝트 DB로 가져왔어요. 아래 실행 결과에서 저장·갱신한 행 수를 확인할 수 있습니다.'
        : result.status === 'FAILED'
          ? '프로젝트는 만들었지만 동기화 실행에 실패했어요. 아래 오류를 확인하고 코드를 수정한 뒤 다시 실행해 주세요.'
          : '프로젝트는 만들었어요. 실행이 아직 진행 중입니다. 잠시 뒤 실행 결과를 확인해 주세요.')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '시트 데이터 프로젝트를 준비하지 못했습니다.'
      if (createdProjectId) {
        try {
          const [loaded, versions, projectList] = await Promise.all([
            projectService.get(createdProjectId),
            projectService.listVersions(createdProjectId),
            projectService.list(),
          ])
          setWorkspace(loaded)
          setProjectVersions(versions)
          setProjects(projectList)
          resetProjectFiles('main.py')
          setProjectDirty(false)
          setProjectNeedsReload(false)
          setView('workspace')
          setProjectError(`프로젝트는 만들었지만 자동 동기화를 마치지 못했어요. 실행 결과를 확인하거나 다시 실행해 주세요. (${message})`)
        } catch {
          setConnectionsError(`프로젝트는 생성됐지만 프로젝트 화면을 열지 못했어요. 내 프로젝트에서 확인해 주세요. (${message})`)
        }
      } else {
        setConnectionsError(message)
      }
    } finally {
      setProjectBusy(false)
    }
  }

  async function handleImportProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!archiveToImport) {
      setProjectError('먼저 가져올 ZIP 파일을 선택해 주세요.')
      return
    }
    if (archiveToImport.size > 1_500_000) {
      setProjectError('ZIP 파일은 1.5MB 이하여야 합니다.')
      return
    }
    const form = event.currentTarget
    setProjectBusy(true)
    setProjectError('')
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    try {
      const imported = await projectService.importArchive(archiveProjectName, archiveToImport)
      setWorkspace(imported)
      setProjectVersions([])
      setVersionPreview(null)
      resetProjectFiles(imported.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice('ZIP에서 프로젝트 파일을 가져왔어요. .env와 개인 키 파일은 보안상 제외했어요.')
      setProjects((current) => [{
        id: imported.id,
        name: imported.name,
        description: imported.description,
        draft_version: imported.draft_version,
        updated_at: imported.updated_at,
      }, ...current])
      setView('workspace')
      setArchiveToImport(null)
      setArchiveProjectName('')
      form.reset()
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'ZIP 파일을 프로젝트로 가져오지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function openProject(projectId: string) {
    setProjectBusy(true)
    setProjectError('')
    setProjectNotice('')
    try {
      const [loaded, versions, directory] = await Promise.all([
        projectService.get(projectId),
        projectService.listVersions(projectId),
        getProjectDirectory(projectId).catch(() => null),
      ])
      setWorkspace(loaded)
      setLocalProjectDirectory(directory)
      setPendingProjectDirectory(null)
      setProjectVersions(versions)
      setVersionPreview(null)
      resetProjectFiles(loaded.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setView('workspace')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트를 열지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  function updateProjectFile(content: string) {
    if (!workspace) return
    if (content.length > 200_000) {
      setProjectError('파일 하나는 200,000자 이하여야 합니다.')
      return
    }
    const nextFiles = workspace.files.map((file) => file.path === selectedPath ? { ...file, content } : file)
    const totalBytes = nextFiles.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0)
    if (totalBytes > 1_000_000) {
      setProjectError('프로젝트 파일 전체 크기는 1MB 이하여야 합니다. 코드를 줄인 뒤 저장해 주세요.')
      return
    }
    setWorkspace({
      ...workspace,
      files: nextFiles,
    })
    setProjectDirty(true)
    setProjectError('')
    setProjectNotice('저장되지 않은 변경 사항이 있습니다.')
  }

  function openProjectFile(path: string) {
    setSelectedPath(path)
    setOpenFilePaths((current) => current.includes(path) ? current : [...current, path])
  }

  function resetProjectFiles(path: string) {
    setSelectedPath(path)
    setOpenFilePaths(path ? [path] : [])
  }

  async function createProjectEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const kind = newEntryKind === 'auto' ? inferProjectEntryKind(newEntryPath) : newEntryKind
    if (kind === 'folder') await createProjectFolder(newEntryPath)
    else await addProjectFile(newEntryPath)
  }

  async function createProjectFolder(folderPathInput: string) {
    if (!workspace) return
    const folderPath = folderPathInput.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
    if (!folderPath || folderPath.length > 230 || folderPath.startsWith('/') || folderPath.includes('\0')
      || folderPath.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
      setProjectError('폴더 경로는 230자 이내의 안전한 상대 경로여야 합니다.')
      return
    }
    let uniqueFolderPath: string
    try {
      uniqueFolderPath = uniqueProjectPath(folderPath, workspace.files, 'folder')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '폴더 이름을 정하지 못했습니다.')
      return
    }
    const markerPath = `${uniqueFolderPath}/.gitkeep`
    if (workspace.files.length >= 50) {
      setProjectError('프로젝트 파일과 폴더 표시 파일을 합쳐 50개까지만 저장할 수 있습니다.')
      return
    }
    setProjectBusy(true)
    setProjectError('')
    try {
      const marker = { path: markerPath, content: '' }
      if (localProjectDirectory) await writeProjectDirectory(localProjectDirectory, [marker])
      setWorkspace({ ...workspace, files: [...workspace.files, marker].sort((a, b) => a.path.localeCompare(b.path)) })
      setProjectDirty(true)
      setNewEntryPath('')
      setNewEntryKind('auto')
      setShowNewEntryForm(false)
      setProjectNotice(uniqueFolderPath === folderPath
        ? `‘${uniqueFolderPath}’ 폴더를 만들었습니다. 파일을 끌어다 놓거나 +에서 경로를 입력해 파일을 만들 수 있어요.`
        : `같은 이름이 있어 ‘${uniqueFolderPath}’ 폴더를 만들었습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '폴더를 만들지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function moveProjectFileToFolder(filePath: string, folderPath: string) {
    if (!workspace) return
    const filename = filePath.split('/').pop()
    const requestedPath = filename ? (folderPath ? `${folderPath}/${filename}` : filename) : ''
    if (!requestedPath || requestedPath === filePath) return
    const file = workspace.files.find((item) => item.path === filePath)
    if (!file) return
    let newPath: string
    try {
      newPath = uniqueProjectPath(requestedPath, workspace.files.filter((item) => item.path !== filePath), 'file')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '파일 이름을 정하지 못했습니다.')
      return
    }
    if (filePath === 'main.py' && !window.confirm('main.py를 폴더로 옮기면 루트에 main.py가 없어 프로젝트를 실행할 수 없어요. 나중에 루트에 main.py를 다시 만들면 실행할 수 있습니다. 계속 이동할까요?')) return
    const markerPath = folderPath ? `${folderPath}/.gitkeep` : ''
    const hasFolderMarker = Boolean(markerPath) && workspace.files.some((item) => item.path === markerPath)
    setProjectBusy(true)
    setProjectError('')
    try {
      if (localProjectDirectory) {
        await moveProjectFileInDirectory(localProjectDirectory, filePath, newPath, file.content)
        if (hasFolderMarker) await removeProjectFileFromDirectory(localProjectDirectory, markerPath).catch(() => undefined)
      }
      const files = workspace.files
        .filter((item) => item.path !== filePath && (!markerPath || item.path !== markerPath))
        .concat({ ...file, path: newPath })
        .sort((left, right) => left.path.localeCompare(right.path))
      setWorkspace({ ...workspace, files })
      setSelectedPath((current) => current === filePath ? newPath : current)
      setOpenFilePaths((current) => current.map((path) => path === filePath ? newPath : path))
      setProjectDirty(true)
      setProjectNotice(newPath === requestedPath
        ? `‘${filePath}’ 파일을 ‘${newPath}’로 옮겼습니다. 초안을 저장하면 WebLink에도 적용됩니다.`
        : `같은 이름이 있어 ‘${filePath}’ 파일을 ‘${newPath}’로 옮겼습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '파일을 폴더로 옮기지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  function closeProjectFile(path: string) {
    const nextOpenPaths = openFilePaths.filter((item) => item !== path)
    setOpenFilePaths(nextOpenPaths)
    if (selectedPath === path) {
      const closedIndex = openFilePaths.indexOf(path)
      setSelectedPath(nextOpenPaths[Math.min(closedIndex, nextOpenPaths.length - 1)] ?? '')
    }
  }

  async function chooseLocalProjectDirectory() {
    if (!workspace) return
    setProjectBusy(true)
    setProjectError('')
    try {
      setPendingProjectDirectory(await chooseProjectDirectory())
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setProjectError(cause instanceof Error ? cause.message : '폴더를 선택하지 못했습니다.')
      }
    } finally {
      setProjectBusy(false)
    }
  }

  async function importLocalProjectDirectory() {
    if (!workspace || !pendingProjectDirectory) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const files = await readProjectDirectory(pendingProjectDirectory)
      const saved = await projectService.saveDraft(workspace.id, workspace.draft_version, files)
      await projectService.createRevision(workspace.id)
      await bindProjectDirectory(workspace.id, pendingProjectDirectory)
      const [loaded, versions] = await Promise.all([
        projectService.get(workspace.id),
        projectService.listVersions(workspace.id),
      ])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setLocalProjectDirectory(pendingProjectDirectory)
      setPendingProjectDirectory(null)
      setProjectFolders((current) => ({ ...current, [workspace.id]: pendingProjectDirectory.name }))
      resetProjectFiles(loaded.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice(`폴더의 파일 ${files.length}개를 가져와 초안 v${saved.draft_version}로 저장했어요.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '폴더에서 프로젝트를 가져오지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function exportProjectToLocalDirectory() {
    if (!workspace || !pendingProjectDirectory) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const excluded = await writeProjectDirectory(pendingProjectDirectory, workspace.files)
      await bindProjectDirectory(workspace.id, pendingProjectDirectory)
      setLocalProjectDirectory(pendingProjectDirectory)
      setPendingProjectDirectory(null)
      setProjectFolders((current) => ({ ...current, [workspace.id]: pendingProjectDirectory.name }))
      setProjectNotice(excluded
        ? `프로젝트 파일을 폴더에 복사했어요. 비밀 파일 ${excluded}개는 제외했습니다.`
        : '프로젝트 파일을 선택한 폴더에 복사했어요. 이제 GitHub Desktop에서 변경 사항을 커밋하고 올릴 수 있습니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트 파일을 폴더에 저장하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function refreshProjectFromLocalDirectory() {
    if (!workspace || !localProjectDirectory) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const files = await readProjectDirectory(localProjectDirectory)
      const saved = await projectService.saveDraft(workspace.id, workspace.draft_version, files)
      await projectService.createRevision(workspace.id)
      const [loaded, versions] = await Promise.all([
        projectService.get(workspace.id),
        projectService.listVersions(workspace.id),
      ])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setProjectDirty(false)
      setProjectNeedsReload(false)
      resetProjectFiles(loaded.files[0]?.path ?? '')
      setProjectNotice(`폴더의 최신 파일을 불러와 초안 v${saved.draft_version}로 저장했어요.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '로컬 폴더를 다시 읽지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function disconnectLocalProjectDirectory() {
    if (!workspace || !window.confirm('WebLink와 폴더의 연결만 해제할까요? 컴퓨터 폴더의 파일은 삭제되지 않습니다.')) return
    setProjectBusy(true)
    try {
      await unbindProjectDirectory(workspace.id)
      setLocalProjectDirectory(null)
      setProjectFolders((current) => {
        const next = { ...current }
        delete next[workspace.id]
        return next
      })
      setProjectNotice('폴더 연결을 해제했어요. 컴퓨터 폴더와 파일은 그대로 있습니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '폴더 연결을 해제하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function deleteSavedVersion(version: ProjectVersion) {
    if (!workspace || !window.confirm(`${version.name} 복사본을 삭제할까요? 현재 프로젝트 초안과 다른 버전은 그대로 유지됩니다.`)) return
    setProjectBusy(true)
    setProjectError('')
    try {
      await projectService.deleteVersion(workspace.id, version.id)
      setProjectVersions((current) => current.filter((item) => item.id !== version.id))
      setVersionPreview((current) => current?.id === version.id ? null : current)
      setProjectNotice(`${version.name} 복사본을 삭제했습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '저장한 복사본을 삭제하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function deleteProjectById(projectId: string, projectName: string) {
    if (!window.confirm(`‘${projectName}’ 프로젝트와 초안, 저장 버전, 실행 기록을 WebLink에서 삭제할까요? 연결된 컴퓨터/GitHub 폴더의 파일은 보존됩니다.`)) return
    setProjectBusy(true)
    setProjectError('')
    try {
      await projectService.delete(projectId)
      await unbindProjectDirectory(projectId).catch(() => undefined)
      setProjects((current) => current.filter((item) => item.id !== projectId))
      setProjectFolders((current) => {
        const next = { ...current }
        delete next[projectId]
        return next
      })
      if (workspace?.id === projectId) {
        setWorkspace(null)
        setLocalProjectDirectory(null)
        setPendingProjectDirectory(null)
        setProjectVersions([])
        setVersionPreview(null)
        setProjectDirty(false)
        setProjectNeedsReload(false)
        setView('projects')
      }
      setProjectNotice(`‘${projectName}’ 프로젝트의 WebLink 초안·버전·실행 기록을 삭제했습니다. 컴퓨터/GitHub 폴더는 보존했어요.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트를 삭제하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function deleteCurrentProject() {
    if (workspace) await deleteProjectById(workspace.id, workspace.name)
  }

  async function addProjectFile(pathInput: string) {
    if (!workspace || !pathInput.trim()) return
    const path = pathInput.trim().replace(/\\/g, '/')
    if (path.length > 240 || path.startsWith('/') || path.includes('\0') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
      setProjectError('파일 경로는 240자 이내의 안전한 상대 경로여야 합니다.')
      return
    }
    if (path.split('/').pop()?.toLowerCase() === '.gitkeep') {
      setProjectError('.gitkeep은 폴더를 보존하기 위해 WebLink가 관리하는 파일입니다.')
      return
    }
    if (workspace.files.length >= 50) {
      setProjectError('프로젝트 파일은 50개까지만 추가할 수 있습니다.')
      return
    }
    let uniquePath: string
    try {
      uniquePath = uniqueProjectPath(path, workspace.files, 'file')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '파일 이름을 정하지 못했습니다.')
      return
    }
    const parentFolder = uniquePath.split('/').slice(0, -1).join('/')
    const markerPath = parentFolder ? `${parentFolder}/.gitkeep` : ''
    setProjectBusy(true)
    setProjectError('')
    try {
      if (localProjectDirectory) {
        await writeProjectDirectory(localProjectDirectory, [{ path: uniquePath, content: '' }])
        if (markerPath && workspace.files.some((file) => file.path === markerPath)) {
          await removeProjectFileFromDirectory(localProjectDirectory, markerPath).catch(() => undefined)
        }
      }
      const files = workspace.files.filter((file) => !markerPath || file.path !== markerPath)
      setWorkspace({ ...workspace, files: [...files, { path: uniquePath, content: '' }].sort((a, b) => a.path.localeCompare(b.path)) })
      openProjectFile(uniquePath)
      setNewEntryPath('')
      setNewEntryKind('auto')
      setShowNewEntryForm(false)
      setProjectDirty(true)
      setProjectNotice(uniquePath === path ? '새 파일이 추가되었습니다. 저장해 주세요.' : `같은 이름이 있어 ‘${uniquePath}’ 파일로 만들었습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '새 파일을 추가하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function importDroppedFiles(droppedFiles: File[], folderPath: string) {
    if (!workspace || !droppedFiles.length) return
    const folderMarker = folderPath ? `${folderPath}/.gitkeep` : ''
    const existingFiles = workspace.files.filter((file) => !folderMarker || file.path !== folderMarker)
    if (existingFiles.length + droppedFiles.length > 50) {
      setProjectError('프로젝트에는 폴더 표시 파일을 포함해 최대 50개까지만 넣을 수 있어요.')
      return
    }
    setProjectBusy(true)
    setProjectError('')
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const addedFiles: ProjectWorkspace['files'] = []
      let incomingBytes = 0
      for (const file of droppedFiles) {
        const name = file.name.trim()
        const lowerName = name.toLocaleLowerCase()
        const sensitive = lowerName === '.env' || (lowerName.startsWith('.env.') && lowerName !== '.env.example')
          || ['id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'].includes(lowerName)
          || /\.(pem|key|p12|pfx)$/i.test(name)
        if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name === '.' || name === '..'
          || lowerName === '.git' || lowerName === '.gitkeep') {
          throw new Error(`‘${name || '이름 없는 파일'}’은 프로젝트에 넣을 수 없는 이름입니다.`)
        }
        if (sensitive) throw new Error(`‘${name}’은 비밀 정보가 포함될 수 있어 가져오지 않았습니다.`)
        if (file.size > 200_000) throw new Error(`‘${name}’ 파일이 200KB를 넘어 가져올 수 없습니다.`)
        incomingBytes += file.size
        const path = folderPath ? `${folderPath}/${name}` : name
        let content: string
        try {
          content = decoder.decode(await file.arrayBuffer())
        } catch {
          throw new Error(`‘${name}’은 UTF-8 텍스트가 아니어서 가져올 수 없습니다.`)
        }
        const uniquePath = uniqueProjectPath(path, [...existingFiles, ...addedFiles], 'file')
        addedFiles.push({ path: uniquePath, content })
      }
      const currentBytes = existingFiles.reduce((sum, file) => sum + new TextEncoder().encode(file.content).byteLength, 0)
      if (currentBytes + incomingBytes > 1_000_000) throw new Error('프로젝트 파일 전체 용량은 1MB까지 지원합니다.')
      if (localProjectDirectory) {
        await writeProjectDirectory(localProjectDirectory, addedFiles)
        if (folderMarker && workspace.files.some((file) => file.path === folderMarker)) {
          await removeProjectFileFromDirectory(localProjectDirectory, folderMarker).catch(() => undefined)
        }
      }
      setWorkspace({ ...workspace, files: [...existingFiles, ...addedFiles].sort((left, right) => left.path.localeCompare(right.path)) })
      openProjectFile(addedFiles[0]?.path ?? '')
      setProjectDirty(true)
      setProjectNotice(`${addedFiles.length}개 파일을 ${folderPath ? `‘${folderPath}’ 폴더` : '프로젝트 루트'}에 추가했습니다. 저장하면 WebLink 초안에도 적용됩니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '파일을 프로젝트에 추가하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function renameProjectFile(oldPath: string) {
    if (!workspace) return
    const entered = window.prompt('새 파일 경로를 입력하세요.', oldPath)
    if (entered === null) return
    const newPath = entered.trim().replace(/\\/g, '/')
    if (!newPath || newPath.length > 240 || newPath.startsWith('/') || newPath.includes('\0')
      || newPath.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
      setProjectError('파일 경로는 240자 이내의 안전한 상대 경로여야 합니다.')
      return
    }
    if (newPath === oldPath) return
    const file = workspace.files.find((item) => item.path === oldPath)
    if (!file) return
    let finalPath: string
    try {
      finalPath = uniqueProjectPath(newPath, workspace.files.filter((item) => item.path !== oldPath), 'file')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '파일 이름을 정하지 못했습니다.')
      return
    }
    if (oldPath === 'main.py' && !window.confirm('main.py 이름을 바꾸면 루트에 main.py가 없어 프로젝트를 실행할 수 없어요. 루트에 main.py를 다시 만들면 실행할 수 있습니다. 계속할까요?')) return
    setProjectBusy(true)
    setProjectError('')
    try {
      if (localProjectDirectory) await moveProjectFileInDirectory(localProjectDirectory, oldPath, finalPath, file.content)
      setWorkspace({ ...workspace, files: workspace.files.map((item) => item.path === oldPath ? { ...item, path: finalPath } : item).sort((a, b) => a.path.localeCompare(b.path)) })
      setSelectedPath((current) => current === oldPath ? finalPath : current)
      setOpenFilePaths((current) => current.map((path) => path === oldPath ? finalPath : path))
      setProjectDirty(true)
      setProjectNotice(finalPath !== newPath
        ? `같은 이름이 있어 ‘${finalPath}’로 변경했습니다.`
        : localProjectDirectory
          ? `${oldPath}의 이름을 ${finalPath}(으)로 바꾸고 연결 폴더에도 반영했습니다. 저장하면 WebLink 초안에 적용됩니다.`
          : `${oldPath}의 이름을 ${finalPath}(으)로 바꿨습니다. 저장하면 WebLink 초안에 적용됩니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '파일 이름을 바꾸지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function deleteProjectFile(path: string) {
    if (!workspace) return
    const mainWarning = path === 'main.py' ? ' 루트 main.py가 없어 프로젝트를 실행할 수 없으며, 다시 만들면 실행할 수 있습니다.' : ''
    const prompt = localProjectDirectory
      ? `‘${path}’ 파일을 WebLink 초안과 연결된 컴퓨터 폴더에서 삭제할까요? GitHub에 올라간 파일은 직접 커밋하기 전까지 그대로 유지됩니다.${mainWarning}`
      : `‘${path}’ 파일을 WebLink 프로젝트 초안에서 삭제할까요?${mainWarning}`
    if (!window.confirm(prompt)) return
    setProjectBusy(true)
    setProjectError('')
    try {
      if (localProjectDirectory) await removeProjectFileFromDirectory(localProjectDirectory, path)
      const files = workspace.files.filter((file) => file.path !== path)
      const tabs = openFilePaths.filter((openPath) => openPath !== path)
      const nextTabs = tabs.length ? tabs : files[0] ? [files[0].path] : []
      setWorkspace({ ...workspace, files })
      setOpenFilePaths(nextTabs)
      if (selectedPath === path) setSelectedPath(nextTabs[0] ?? '')
      setProjectDirty(true)
      setProjectNotice(`‘${path}’ 파일을 삭제했습니다. 초안에 저장하려면 Ctrl+S를 누르세요.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '파일을 삭제하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function saveProjectDraft() {
    if (!workspace) return
    setProjectBusy(true)
    setProjectError('')
    try {
      await persistWorkspaceDraft(workspace)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '초안을 저장하지 못했습니다.'
      setProjectError(message)
      setProjectNeedsReload(message.includes('최신 초안'))
    } finally {
      setProjectBusy(false)
    }
  }

  async function persistWorkspaceDraft(current: ProjectWorkspace): Promise<ProjectWorkspace> {
    if (current.files.length > 50) throw new Error('프로젝트 파일은 50개 이하여야 합니다.')
    if (current.files.some((file) => file.content.length > 200_000)) throw new Error('파일 하나는 200,000자 이하여야 합니다.')
    if (current.files.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0) > 1_000_000) {
      throw new Error('프로젝트 파일 전체 크기는 1MB 이하여야 합니다.')
    }
    const paths = current.files.map((file) => file.path)
    if (paths.some((path) => path.length > 240 || path.startsWith('/') || path.includes('\\') || path.includes('\0')
      || path.split('/').some((part) => !part || part === '.' || part === '..'))) {
      throw new Error('프로젝트에 안전하지 않은 파일 경로가 있습니다. 상대 경로를 확인해 주세요.')
    }
    if (new Set(paths).size !== paths.length) throw new Error('같은 파일 경로가 두 번 들어 있어 초안을 저장할 수 없습니다.')
    let saved: Awaited<ReturnType<typeof projectService.saveDraft>>
    try {
      saved = await projectService.saveDraft(current.id, current.draft_version, current.files)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '초안을 저장하지 못했습니다.'
      setProjectNeedsReload(message.includes('최신 초안'))
      throw cause
    }
    const next = { ...current, draft_version: saved.draft_version, updated_at: saved.updated_at }
    setWorkspace(next)
    setProjects((items) => items.map((item) => item.id === current.id
      ? { ...item, draft_version: saved.draft_version, updated_at: saved.updated_at }
      : item))
    setProjectDirty(false)
    setProjectNeedsReload(false)
    setProjectError('')
    const changed = saved.draft_version > current.draft_version
    if (localProjectDirectory) {
      try {
        const excluded = await writeProjectDirectory(localProjectDirectory, current.files)
        setProjectNotice(excluded
          ? `WebLink 초안을 저장했어요. 비밀 파일 ${excluded}개는 컴퓨터 폴더에서 제외했습니다.`
          : changed
            ? `초안 v${saved.draft_version}을 저장하고 ${localProjectDirectory.name} 폴더에도 기록했어요.`
            : `변경된 파일이 없어 초안과 ${localProjectDirectory.name} 폴더를 그대로 두었습니다.`)
      } catch (cause) {
        setProjectNotice('WebLink 초안은 저장됐어요. 컴퓨터 폴더 저장은 아래 버튼으로 다시 시도할 수 있습니다.')
        setProjectError(cause instanceof Error ? cause.message : '컴퓨터 폴더에 기록하지 못했습니다.')
      }
    } else {
      setProjectNotice(changed ? `초안 v${saved.draft_version}로 저장했습니다.` : '변경된 파일이 없어 초안을 그대로 두었습니다.')
    }
    return next
  }

  function discardProjectChanges() {
    if (!projectDirty || !window.confirm('저장하지 않은 수정 내용을 버리고 마지막 저장 상태로 되돌릴까요?')) return
    void reloadWorkspace()
  }

  async function syncWorkspaceToLocalDirectory() {
    if (!workspace || !localProjectDirectory) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const excluded = await writeProjectDirectory(localProjectDirectory, workspace.files)
      setProjectNotice(excluded
        ? `${localProjectDirectory.name} 폴더에 기록했어요. 비밀 파일 ${excluded}개는 제외했습니다.`
        : `현재 WebLink 파일을 ${localProjectDirectory.name} 폴더에 기록했어요. GitHub Desktop에서 변경 사항을 확인할 수 있습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '로컬 폴더에 저장하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function reloadWorkspace() {
    if (!workspace) return
    setProjectBusy(true)
    try {
      const [loaded, versions] = await Promise.all([projectService.get(workspace.id), projectService.listVersions(workspace.id)])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setVersionPreview(null)
      resetProjectFiles(loaded.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectError('최신 초안을 불러왔습니다.')
      setProjectNotice('')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '초안을 다시 불러오지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function saveProjectVersion() {
    if (!workspace) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const current = projectDirty ? await persistWorkspaceDraft(workspace) : workspace
      const revisionResult = await projectService.createRevision(current.id)
      const revision = revisionResult.revision
      const existingCopy = projectVersions.find((version) => version.source_revision_id === revision.id)
      if (existingCopy) {
        setProjectNotice(`같은 내용의 ${existingCopy.name}이 이미 있어 새 복사본은 만들지 않았습니다.`)
        return
      }
      const nextVersionNumber = Math.max(0, ...projectVersions.map((version) => version.version_number)) + 1
      const saved = await projectService.saveVersion(current.id, revision.id, `버전 ${nextVersionNumber}`)
      setProjectVersions((current) => current.some((version) => version.id === saved.id) ? current : [saved, ...current])
      if (revisionResult.created) {
        setWorkspace((current) => current ? { ...current, revisions: [revision, ...current.revisions] } : current)
      }
      setProjectNotice(`${saved.name}을 저장했습니다. 연결된 리비전 ${revision.revision_number}은 변경되지 않습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '버전을 저장하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function downloadProjectArchive() {
    if (!workspace || projectBusy) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const current = projectDirty ? await persistWorkspaceDraft(workspace) : workspace
      await projectService.exportArchive(current.id, current.name)
      setProjectNotice('저장된 프로젝트 파일을 ZIP으로 내려받았어요. .env와 개인 키 파일은 보안상 제외됩니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트 ZIP을 내려받지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function viewProjectVersion(versionId: string) {
    if (!workspace) return
    setProjectBusy(true)
    setProjectError('')
    try {
      setVersionPreview(await projectService.getVersion(workspace.id, versionId))
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '버전을 불러오지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function restoreProjectVersion(versionId: string) {
    if (!workspace) return
    if (!window.confirm(projectDirty
      ? '현재 수정 내용을 먼저 저장한 뒤 선택한 버전으로 복원할까요?'
      : '선택한 버전으로 복원할까요? 현재 초안은 복원 버전으로 교체됩니다.')) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const current = projectDirty ? await persistWorkspaceDraft(workspace) : workspace
      const restored = await projectService.restoreVersion(current.id, versionId)
      const [loaded, versions] = await Promise.all([projectService.get(current.id), projectService.listVersions(current.id)])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setVersionPreview(null)
      resetProjectFiles(loaded.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice(`버전을 복원해 리비전 ${restored.restored_revision_number}로 기록했습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '버전을 복원하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function runProject() {
    if (!workspace) return
    if (!workspace.files.some((file) => file.path === 'main.py')) {
      setProjectError('프로젝트를 실행하려면 루트에 main.py 파일이 있어야 합니다. + 버튼에서 main.py를 다시 만들어 주세요.')
      return
    }
    setProjectBusy(true)
    setProjectError('')
    setRunResult(null)
    setDebugSaved(false)
    setDebugHint(null)
    try {
      const current = projectDirty ? await persistWorkspaceDraft(workspace) : workspace
      const created = await projectService.createRevision(current.id)
      const revision = created.revision
      if (created.created) {
        setWorkspace((current) => current ? { ...current, revisions: [revision, ...current.revisions] } : current)
      }
      let result = await projectService.run(current.id, revision.id)
      setRunResult(result)
      while (result.status === 'QUEUED' || result.status === 'RUNNING') {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        result = await projectService.getRun(current.id, result.id)
        setRunResult(result)
      }
      setProjectNotice(result.status === 'SUCCEEDED' ? '실행이 완료되었습니다.' : '실행이 끝났습니다. 출력을 확인해 주세요.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트를 실행하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function saveDebugNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace || !runResult || !debugHypothesis.trim()) return
    setProjectBusy(true)
    setProjectError('')
    try {
      await projectService.saveDebugSession(workspace.id, runResult.id, debugHypothesis, expectedOutput)
      setDebugSaved(true)
      setProjectNotice('디버깅 기록을 저장했습니다. 다음 실행에서 가설을 확인해 보세요.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '디버깅 기록을 저장하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function requestDebugHint() {
    if (!workspace || !runResult || !debugHypothesis.trim()) return
    setAiBusy(true)
    setProjectError('')
    try {
      const hint = await projectService.requestDebugHint(workspace.id, runResult.id, debugHypothesis, expectedOutput)
      setDebugHint(hint)
      setDebugSaved(true)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'AI 힌트를 가져오지 못했습니다.')
    } finally {
      setAiBusy(false)
    }
  }

  async function handleAttempt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!lesson) return
    setError('')
    const activity = lesson.content.block_activity
    if (activity && assembledBlocks.length === 0) {
      setError('먼저 블록을 쌓아 코드를 만들어 보세요.')
      return
    }
    setSubmitting(true)
    setAttemptResult(null)
    const form = new FormData(event.currentTarget)
    try {
      const result = await learningService.submit(lesson.id, {
        input: activity ? JSON.stringify(assembledBlocks) : String(form.get('input') ?? ''),
        process: activity
          ? assembledBlocks.map((id) => activity.blocks.find((block) => block.id === id)?.code ?? '').join('')
          : String(form.get('process') ?? ''),
        output: activity ? activity.expected_output : String(form.get('output') ?? ''),
      })
      setAttemptResult(result)
      setLesson({ ...lesson, status: result.status, attempts_count: result.attempts_count })
      setCourse((current) => current ? {
        ...current,
        completed_lessons: current.completed_lessons + (result.completed && lesson.status !== 'COMPLETED' ? 1 : 0),
        lessons: current.lessons.map((item) => item.id === lesson.id ? { ...item, status: result.status } : item),
      } : current)
      setCourses((current) => current.map((item) => item.slug !== course?.slug ? item : {
        ...item,
        completed_lessons: item.completed_lessons + (result.completed && lesson.status !== 'COMPLETED' ? 1 : 0),
        lessons: item.lessons.map((entry) => entry.id === lesson.id ? { ...entry, status: result.status } : entry),
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '답안을 저장하지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function continueInProject() {
    if (!lesson?.content.block_activity || !attemptResult?.completed || projectBusy) return
    setProjectBusy(true)
    setProjectError('')
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    try {
      const created = await projectService.create({
        name: `${lesson.title} 프로젝트`,
        description: '블록으로 조립한 파이썬 코드를 실제 프로젝트로 이어서 만들어 봅니다.',
      })
      const source = assembledBlocks
        .map((id) => lesson.content.block_activity?.blocks.find((block) => block.id === id)?.code ?? '')
        .join('')
      const safeSpreadsheetId = extractGoogleSpreadsheetId(spreadsheetId) ?? ''
      const previewRange = sheetPreview?.range ?? ''
      const safeSheetRange = /^[\w.'!:$ -]{1,128}$/.test(previewRange) ? previewRange : ''
      const projectSource = source
        .split("'YOUR_SPREADSHEET_ID'")
        .join(safeSpreadsheetId ? `'${safeSpreadsheetId}'` : "'YOUR_SPREADSHEET_ID'")
        .split('"\'시트1\'!A1:C4"')
        .join(safeSheetRange ? JSON.stringify(safeSheetRange) : '"\'시트1\'!A1:C4"')
      const files = created.files.map((file) => file.path === 'main.py' ? { ...file, content: `${projectSource}\n` } : file)
      await projectService.saveDraft(created.id, created.draft_version, files)
      await projectService.createRevision(created.id)
      const [loaded, versions, projectList] = await Promise.all([
        projectService.get(created.id),
        projectService.listVersions(created.id),
        projectService.list(),
      ])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setProjects(projectList)
      resetProjectFiles('main.py')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice(projectSource.includes('YOUR_SPREADSHEET_ID')
        ? '코드를 프로젝트로 옮겼어요. 실행하기 전에 YOUR_SPREADSHEET_ID를 본인 시트 ID로 바꿔 주세요.'
        : '시트 ID와 미리보기 범위를 코드에 채워 프로젝트로 옮겼어요. 이제 실행하고 바꿔 보세요.')
      setProjectError('')
      setView('workspace')
      setVersionPreview(null)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트로 코드를 옮기지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  function addBlock(blockId: string) {
    setAssembledBlocks((current) => current.includes(blockId) ? current : [...current, blockId])
    setAttemptResult(null)
    setError('')
  }

  function moveBlock(index: number, offset: number) {
    setAssembledBlocks((current) => {
      const nextIndex = index + offset
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
    setAttemptResult(null)
  }

  function removeBlock(index: number) {
    setAssembledBlocks((current) => current.filter((_, blockIndex) => blockIndex !== index))
    setAttemptResult(null)
  }

  if (loading) return <main className="welcome"><p className="status">WebLink를 준비하고 있어요…</p></main>

  if (user) {
    return (
      <div className="learning-shell">
        <header className="learning-topbar">
          <div className="topbar-brand"><div className="brand-mark small" aria-hidden="true">W</div><span>WebLink</span></div>
          <nav className="topbar-nav" aria-label="주요 메뉴">
            <button className={view === 'lesson' ? 'active' : ''} type="button" onClick={showLesson} disabled={projectBusy}>배우기</button>
            <button className={view === 'projects' || view === 'workspace' ? 'active' : ''} type="button" onClick={showProjects} disabled={projectBusy}>내 프로젝트</button>
            <button className={view === 'connections' ? 'active' : ''} type="button" onClick={showConnections} disabled={projectBusy}>연결 앱</button>
          </nav>
          <div className="account-menu"><span>{user.display_name}</span><button type="button" onClick={handleLogout}>로그아웃</button></div>
        </header>
        {view === 'connections' ? (
          <main className="connections-main">
            <div className="connections-heading"><p className="eyebrow">프로젝트와 외부 서비스</p><h1>연결 앱</h1><p>외부 앱 연결을 안전하게 관리하고, 프로젝트에서 필요한 데이터만 읽어 올 수 있어요.</p></div>
            {new URLSearchParams(window.location.search).get('connection') === 'google_connected' && <p className="project-notice connection-message">Google 계정을 연결했어요. 이제 스프레드시트 데이터를 확인할 수 있어요.</p>}
            {new URLSearchParams(window.location.search).get('connection')?.startsWith('google_') && new URLSearchParams(window.location.search).get('connection') !== 'google_connected' && <p className="form-error connection-message" role="alert">Google 연결이 완료되지 않았어요. 설정과 계정 권한을 확인한 뒤 다시 시도해 주세요.</p>}
            {connectionsError && <p className="form-error connection-message" role="alert">{connectionsError}</p>}
            {connectionsBusy && !googleConnection ? <p className="connection-loading">연결 상태를 확인하고 있어요…</p> : (
              <section className="connection-card">
                <div className="connection-title"><span className="google-mark" aria-hidden="true">G</span><div><h2>Google Sheets</h2><p>스프레드시트 읽기 전용 연결</p></div><span className={`connection-badge ${googleConnection?.connected ? 'connected' : ''}`}>{googleConnection?.connected ? '연결됨' : '연결 안 됨'}</span></div>
                {googleConnection?.connected ? <>
                  <p className="connected-account">연결 계정 <strong>{googleConnection.account_email ?? 'Google 계정'}</strong></p>
                  <p className="connection-description">프로젝트는 연결한 계정이 읽을 수 있는 스프레드시트 값만 가져올 수 있어요. Google 토큰은 암호화해 보관하고 실행 코드에는 전달하지 않아요.</p>
                  <form className="sheet-preview-form" onSubmit={previewGoogleSheet}>
                    <h3>시트 데이터 미리보기</h3>
                    <label>스프레드시트 ID 또는 주소<input value={spreadsheetId} onChange={(event) => { setSpreadsheetId(event.target.value); setSheetPreview(null) }} required maxLength={500} placeholder="ID 또는 Google Sheets 주소를 붙여넣으세요" /></label>
                    <label>시트 범위<input value={sheetRange} onChange={(event) => { setSheetRange(event.target.value); setSheetPreview(null) }} required maxLength={128} placeholder="예: '시트1'!A1:C20" /></label>
                    <button className="primary-button" type="submit" disabled={connectionsBusy || !spreadsheetId.trim()}>{connectionsBusy ? '읽는 중…' : '데이터 확인하기'}</button>
                  </form>
                  {sheetPreview && <div className="sheet-preview"><p><strong>{sheetPreview.range}</strong> · {sheetPreview.values.length}행</p>{sheetPreview.values.length ? <><div className="sheet-table-wrap"><table aria-label="Google Sheets 미리보기"><thead><tr>{sheetPreview.values[0].map((cell, cellIndex) => <th scope="col" key={cellIndex}>{String(cell || `열 ${cellIndex + 1}`)}</th>)}</tr></thead><tbody>{sheetPreview.values.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell)}</td>)}</tr>)}</tbody></table></div><p className={sheetValidation?.issues.length ? 'sheet-validation-error' : 'sheet-validation-ok'} role="status" aria-live="polite">{sheetValidation?.issues.length ? sheetValidation.issues.join(' ') : `가져올 행 ${sheetValidation?.validRows ?? 0}개를 확인했어요.`}</p><button className="primary-button" type="button" onClick={createSheetsDatabaseProject} disabled={projectBusy || Boolean(sheetValidation?.issues.length)}>{projectBusy ? '프로젝트 생성·동기화 중…' : '시트 데이터를 가져와 프로젝트 DB에 저장'}</button><p className="sheet-import-note">누르면 새 프로젝트를 만들고 시트 데이터를 한 번 동기화합니다. 첫 번째 열은 고유 키로 사용해요. 잘못되거나 중복된 행이 있으면 저장을 중단하고, 성공하면 삭제된 행도 반영합니다. OAuth 비밀값은 코드에 넣지 않아요.</p></> : <p>범위에 데이터가 없어요.</p>}</div>}
                  <details className="connection-code"><summary>프로젝트 코드에서 사용하는 방법</summary><pre>{`from weblink_api import get_google_sheet\n\nsheet = get_google_sheet("${spreadsheetId || 'SPREADSHEET_ID'}", "${sheetRange || 'Sheet1!A1:Z100'}")\nrows = sheet["values"]\nprint(rows)`}</pre><p>실행 코드는 네트워크에 직접 연결하지 않고, 실행별로 제한된 WebLink 연결 경로를 사용해요.</p></details>
                  <button className="disconnect-button" type="button" onClick={disconnectGoogleConnection} disabled={connectionsBusy}>{connectionsBusy ? '처리 중…' : 'Google 연결 해제'}</button>
                </> : <>
                  <p className="connection-description">Google Sheets를 연결하면 프로젝트에서 허용된 시트 범위를 읽고, 필요한 데이터를 로컬 데이터베이스에 저장하는 흐름을 연습할 수 있어요. 쓰기 권한은 요청하지 않아요.</p>
                  {googleConnection?.configured ? <button className="primary-button" type="button" onClick={startGoogleConnection} disabled={connectionsBusy}>{connectionsBusy ? '준비 중…' : 'Google 계정 연결하기'}</button> : <div className="connection-setup"><strong>서버 설정이 필요해요</strong><p>`.env`에 Google OAuth 웹 클라이언트 정보와 연결 암호화 키를 넣고 Docker 서비스를 다시 시작하면 연결 버튼이 활성화돼요.</p><code>GOOGLE_OAUTH_CLIENT_ID</code><code>GOOGLE_OAUTH_CLIENT_SECRET</code><code>CONNECTION_ENCRYPTION_KEY</code><small>리디렉션 주소: http://localhost:8000/api/v1/connections/google/oauth/callback</small></div>}
                </>}
              </section>
            )}
          </main>
        ) : view === 'projects' ? (
          <main className="project-list-main">
            <div className="project-heading"><p className="eyebrow">내 저장소에서 만들고, 함께 작업하기</p><h1>프로젝트 작업 공간</h1><p>코드를 직접 소유하고 GitHub Desktop으로 친구와 공유하세요. WebLink는 편집·실행·학습 도구를 제공합니다.</p></div>
            <section className="project-storage-hub" aria-label="프로젝트 저장 방식">
              <div className="storage-hub-heading"><div><p className="eyebrow">저장 위치와 협업</p><h2>내 코드, 내가 선택한 저장소</h2></div><span>Drive 연결은 이후 추가</span></div>
              <div className="storage-provider-grid">
                <article className="storage-provider-card local-provider"><span className="storage-provider-icon" aria-hidden="true">⌂</span><div><h3>내 컴퓨터 · GitHub Desktop</h3><p>프로젝트를 연 뒤 내 컴퓨터 폴더와 연결하세요. 공유 저장소를 GitHub Desktop으로 복제해 두면 WebLink에서 편집한 파일을 그 폴더에 저장하고, 친구와는 GitHub에서 커밋·동기화할 수 있어요.</p><small>Chrome·Edge 지원 · ZIP 내보내기는 다른 브라우저에서도 사용 가능</small></div></article>
              <article className="storage-provider-card weblink-provider"><span className="storage-provider-icon" aria-hidden="true">W</span><div><h3>WebLink 실행 공간</h3><p>코드를 실행하고 DB·외부 앱 연결을 시험할 때 사용하는 작업용 공간입니다. 현재 이 앱은 직접 운영하는 Docker/PostgreSQL에 사본을 저장해요.</p><small>프로젝트 실행과 저장에 사용</small></div></article>
                <article className="storage-provider-card planned-provider"><span className="storage-provider-icon" aria-hidden="true">↗</span><div><h3>Google Drive</h3><p>Drive에서 폴더와 파일을 고르고 바로 저장하는 연결은 다음 단계입니다.</p><small>아직 연결되지 않음</small></div></article>
              </div>
              <p className="storage-hub-note">협업 시작: GitHub Desktop에서 친구가 초대한 저장소를 복제하고, 프로젝트 전용 하위 폴더를 만든 뒤 프로젝트 화면에서 그 폴더를 연결하세요. 저장 후 GitHub Desktop에서 변경 파일을 커밋하고 푸시하면 친구가 받을 수 있어요.</p>
            </section>
            {projectNotice && <p className="project-notice project-list-notice" role="status">{projectNotice}</p>}
            <div className="project-list-layout">
              <section className="project-cards">
                <div className="project-cards-heading"><h2>내 작업</h2><label className="project-search"><span className="sr-only">프로젝트 검색</span><input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="프로젝트 검색" /></label></div>
                {projectError && <p className="form-error" role="alert">{projectError}</p>}
                {projectBusy && projects.length === 0 ? <p className="empty-projects">프로젝트를 불러오고 있어요…</p> : filteredProjects.length ? filteredProjects.map((project) => (
                  <div className="project-card-entry" key={project.id}>
                    <button className="project-card" type="button" onClick={() => openProject(project.id)} disabled={projectBusy}>
                      <span className="project-card-icon">↗</span>
                      <span className="project-card-copy"><strong>{project.name}</strong><small>{project.description || '설명이 아직 없습니다.'}</small><small>초안 v{project.draft_version} · {new Date(project.updated_at).toLocaleDateString('ko-KR')}</small><span className="project-storage-badge">{projectFolders[project.id] ? `폴더 · ${projectFolders[project.id]}` : 'WebLink 작업 사본'}</span></span>
                    </button>
                    <button className="plain-danger-button project-list-delete" type="button" onClick={() => deleteProjectById(project.id, project.name)} disabled={projectBusy} aria-label={`${project.name} 프로젝트 삭제`}>삭제</button>
                  </div>
                )) : <p className="empty-projects">{projectSearch ? '검색어와 맞는 프로젝트가 없어요.' : '첫 프로젝트를 만들면 여기에서 작업을 이어갈 수 있어요.'}</p>}
              </section>
              <div className="project-side-actions">
                <form className="project-create-form" onSubmit={handleCreateProject}>
                  <p className="eyebrow">새 출발</p><h2>프로젝트 만들기</h2>
                  <label>프로젝트 이름<input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} required maxLength={120} placeholder="예: 나만의 인사말 앱" /></label>
                  <label>한 줄 설명<textarea value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} maxLength={1000} rows={3} placeholder="무엇을 만들고 싶나요?" /></label>
                  <button className="primary-button" type="submit" disabled={projectBusy}>{projectBusy ? '처리 중…' : '프로젝트 시작하기'}</button>
                  <div className="sample-project-start"><p>먼저 기능을 살펴보고 싶다면</p><button className="secondary-button" type="button" onClick={createSampleProject} disabled={projectBusy}>{projectBusy ? '예제 준비 중…' : 'SQLite 예제 열기'}</button><small>실행해 볼 수 있는 독서 기록 앱과 여러 파일을 만들어요.</small></div>
                </form>
                <form className="project-create-form project-import-form" onSubmit={handleImportProject}>
                  <p className="eyebrow">다른 기기에서 가져오기</p><h2>프로젝트 ZIP 불러오기</h2>
                  <p className="import-project-note">WebLink에서 내려받은 ZIP을 선택하세요. `.env`와 개인 키 파일은 가져오지 않습니다. ZIP은 1.5MB 이하, 압축을 푼 UTF-8 텍스트 파일은 전체 1MB 이하여야 해요.</p>
                  <label>ZIP 파일<input type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    setArchiveToImport(file)
                    if (file) setArchiveProjectName(file.name.replace(/\.zip$/i, '').slice(0, 120))
                  }} required /></label>
                  <label>새 프로젝트 이름<input value={archiveProjectName} onChange={(event) => setArchiveProjectName(event.target.value)} required maxLength={120} placeholder="가져온 프로젝트 이름" /></label>
                  <button className="primary-button" type="submit" disabled={projectBusy || !archiveToImport}>{projectBusy ? '가져오는 중…' : 'ZIP 가져오기'}</button>
                </form>
              </div>
            </div>
          </main>
        ) : view === 'workspace' ? workspace ? (
          <main className="workspace-main">
            <div className="workspace-heading">
              <div><button className="back-link" type="button" onClick={showProjects}>← 프로젝트 목록</button><h1>{workspace.name}</h1><p>초안 버전 {workspace.draft_version}{projectDirty ? ' · 저장되지 않은 변경 사항' : ''}</p></div>
              <div className="workspace-actions">
                <button className="secondary-button" type="button" onClick={saveProjectDraft} disabled={projectBusy || !projectDirty}>{projectBusy ? '저장 중…' : '초안 저장'}</button>
                {projectDirty && <button className="secondary-button" type="button" onClick={discardProjectChanges} disabled={projectBusy}>변경 취소</button>}
                <button className="secondary-button" type="button" onClick={saveProjectVersion} disabled={projectBusy}>{projectBusy ? '처리 중…' : '버전 저장'}</button>
                <button className="primary-button" type="button" onClick={runProject} disabled={projectBusy || !workspace.files.some((file) => file.path === 'main.py')} title={!workspace.files.some((file) => file.path === 'main.py') ? '루트에 main.py 파일이 있어야 실행할 수 있습니다.' : undefined}>{projectBusy ? '실행 중…' : '실행'}</button>
                <button className="secondary-button" type="button" onClick={downloadProjectArchive} disabled={projectBusy} title="초안을 저장한 뒤 프로젝트 파일을 ZIP으로 내려받습니다.">{projectBusy ? '처리 중…' : 'ZIP 다운로드'}</button>
                <button className="plain-danger-button" type="button" onClick={deleteCurrentProject} disabled={projectBusy}>프로젝트 삭제</button>
              </div>
            </div>
            {projectNotice && <p className="project-notice" role="status">{projectNotice}</p>}
            {projectError && <p className="form-error project-message" role="alert">{projectError}</p>}
            {!workspace.files.some((file) => file.path === 'main.py') && <p className="form-error project-message" role="status">루트 main.py가 없어 실행할 수 없어요. 왼쪽 + 버튼에서 파일 종류를 선택하고 <code>main.py</code>를 만들면 다시 실행할 수 있습니다.</p>}
            {projectNeedsReload && <button className="reload-draft-button" type="button" onClick={reloadWorkspace} disabled={projectBusy}>서버의 최신 초안 불러오기</button>}
            <section className="workspace-storage-card">
              <div className="workspace-storage-summary"><div><p className="eyebrow">프로젝트 파일 저장 위치</p><h2>{localProjectDirectory ? `내 컴퓨터 · ${localProjectDirectory.name}` : 'WebLink 작업 공간'}</h2><p>{localProjectDirectory ? '초안을 저장하면 선택한 폴더에도 파일이 기록됩니다. GitHub Desktop에서 커밋·푸시해 친구와 공유할 수 있어요.' : '파일은 WebLink 작업 공간에 저장 중입니다. 내 컴퓨터나 GitHub Desktop 폴더를 연결해 코드 사본을 직접 관리할 수 있어요.'}</p></div><span className={`storage-state ${localProjectDirectory ? 'storage-state-local' : ''}`}>{localProjectDirectory ? '폴더 연결됨' : 'WebLink 저장'}</span></div>
              {!localProjectDirectory ? <button className="secondary-button" type="button" onClick={chooseLocalProjectDirectory} disabled={projectBusy}>내 컴퓨터 / GitHub Desktop 폴더 연결</button> : <div className="workspace-storage-actions"><button className="secondary-button" type="button" onClick={refreshProjectFromLocalDirectory} disabled={projectBusy || projectDirty}>폴더에서 최신 파일 가져오기</button><button className="secondary-button" type="button" onClick={syncWorkspaceToLocalDirectory} disabled={projectBusy || projectDirty}>WebLink 파일을 폴더에 저장</button><button className="plain-danger-button" type="button" onClick={disconnectLocalProjectDirectory} disabled={projectBusy}>연결 해제</button></div>}
              {pendingProjectDirectory && <div className="folder-connection-choice"><strong>선택한 폴더: {pendingProjectDirectory.name}</strong><p>전용 프로젝트 폴더를 선택했는지 확인한 뒤 한 방향을 고르세요. 가져오기는 현재 WebLink 초안을 교체하고, 폴더에 복사하기는 같은 경로의 파일을 덮어씁니다. 비밀 파일은 제외됩니다.</p><div><button className="secondary-button" type="button" onClick={importLocalProjectDirectory} disabled={projectBusy}>폴더에서 WebLink로 가져오기</button><button className="primary-button" type="button" onClick={exportProjectToLocalDirectory} disabled={projectBusy}>WebLink 파일을 폴더에 복사</button><button className="plain-danger-button" type="button" onClick={() => setPendingProjectDirectory(null)} disabled={projectBusy}>취소</button></div></div>}
              <small className="workspace-storage-footnote">이 브라우저는 폴더 연결을 이 컴퓨터에만 기억합니다. 친구는 저장소를 자신의 컴퓨터에 복제한 다음 같은 방식으로 폴더를 연결해야 해요. 동기화는 자동으로 GitHub에 올리지 않으므로 GitHub Desktop에서 커밋하고 푸시하세요.</small>
            </section>
            {runResult && <section className="run-output" aria-live="polite">
              <div className="run-output-heading"><strong>실행 결과 · {runResult.status}</strong><button type="button" className="run-output-close" onClick={() => setRunResult(null)} disabled={projectBusy} aria-label="실행 결과 닫기" title="닫기">×</button></div>
              <p><b>예상</b> 코드를 실행하면 의도한 결과가 나와야 합니다.</p><p><b>실제 출력</b></p><pre>{runResult.stdout || '(출력 없음)'}</pre><p><b>오류</b></p><pre>{runResult.stderr || (runResult.failure_category ? `실패 유형: ${runResult.failure_category}` : '(오류 없음)')}</pre><p><b>종료 코드</b> {runResult.exit_code ?? '실행 중'}</p>
              {runResult.status === 'FAILED' && <form className="debug-notes" onSubmit={saveDebugNotes}><h3>오류를 되짚어 보기</h3><p className="debug-explainer">실행 오류를 보고 예상 결과와 원인에 대한 생각을 적어 두면, 이 실행에 연결해 저장하고 나중에 이어서 볼 수 있어요.</p><label>어떤 결과를 예상했나요?<textarea value={expectedOutput} onChange={(event) => setExpectedOutput(event.target.value)} rows={2} maxLength={16384} /></label><label>왜 이런 결과가 나왔다고 생각하나요?<textarea value={debugHypothesis} onChange={(event) => setDebugHypothesis(event.target.value)} rows={3} required maxLength={4000} placeholder="오류가 난 이유를 추측해서 적어 보세요." /></label><p className="ai-privacy-note">AI 힌트를 요청하면 main.py 일부, 실행 오류, 예상 결과와 가설이 AI 제공자에게 전달됩니다. 코드는 대신 고치지 않아요.</p><div className="debug-actions"><button className="secondary-button" type="submit" disabled={projectBusy || aiBusy || !debugHypothesis.trim()}>{debugSaved ? '디버깅 기록 업데이트' : '디버깅 기록 저장'}</button><button className="primary-button" type="button" onClick={requestDebugHint} disabled={projectBusy || aiBusy || !debugHypothesis.trim()}>{aiBusy ? '힌트를 생각하고 있어요…' : 'AI 디버깅 힌트'}</button></div>{debugSaved && <span role="status">이 실행에 대한 디버깅 기록을 저장했어요.</span>}{debugHint && <div className="ai-hint" role="status"><strong>{debugHint.summary}</strong><p>{debugHint.hint}</p><em>{debugHint.next_question}</em></div>}</form>}
            </section>}
            <div className="workspace-grid">
              <aside className="file-panel">
                <div className="file-panel-heading"><p className="panel-label">파일 탐색기</p><button type="button" className="file-add-button" onClick={() => { setNewEntryPath(''); setNewEntryKind('auto'); setShowNewEntryForm((current) => !current) }} disabled={projectBusy} aria-label="새 파일 또는 폴더 만들기" title="새 파일 또는 폴더 만들기">＋</button></div>
                <ProjectFileTree tree={projectFileTree} selectedPath={selectedPath} busy={projectBusy} onOpen={openProjectFile} onRename={(path) => void renameProjectFile(path)} onDelete={(path) => void deleteProjectFile(path)} onMoveFile={(path, folder) => void moveProjectFileToFolder(path, folder)} onImportFiles={(files, folder) => void importDroppedFiles(files, folder)} />
                {showNewEntryForm && <form className="new-entry-form" onSubmit={createProjectEntry}>
                  <label>파일 또는 폴더 경로<input autoFocus value={newEntryPath} onChange={(event) => setNewEntryPath(event.target.value)} placeholder="예: src/main.py 또는 src" required maxLength={240} /></label>
                  <label>항목 종류<select value={newEntryKind} onChange={(event) => setNewEntryKind(event.target.value as NewProjectEntryKind)}><option value="auto">자동 판단{newEntryPath.trim() ? ` · ${inferProjectEntryKind(newEntryPath) === 'file' ? '파일' : '폴더'}` : ''}</option><option value="file">파일</option><option value="folder">폴더</option></select></label>
                  <p>이름에 확장자가 있으면 파일, 없으면 폴더로 추정합니다. 이름만으로 판단하기 어려우면 종류를 직접 선택하세요.</p>
                  <button type="submit" className="primary-button" disabled={projectBusy}>{projectBusy ? '만드는 중…' : '만들기'}</button>
                </form>}
                <p className="panel-label revision-label">저장한 버전</p>
                {projectVersions.length ? projectVersions.map((version) => <div className="saved-version-row" key={version.id}><strong>v{version.version_number} · {version.name}</strong><small>Python {version.runtime_spec.version}</small><div><button type="button" onClick={() => viewProjectVersion(version.id)} disabled={projectBusy}>보기</button><button type="button" onClick={() => restoreProjectVersion(version.id)} disabled={projectBusy}>복원</button><button className="delete-version-button" type="button" onClick={() => deleteSavedVersion(version)} disabled={projectBusy}>삭제</button></div></div>) : <p className="revision-empty">저장한 버전이 없습니다.</p>}
              </aside>
              <section className="editor-panel">
                <div className="editor-tabs" role="tablist" aria-label="열린 파일">
                  {openFilePaths.map((path) => {
                    const file = workspace.files.find((item) => item.path === path)
                    if (!file) return null
                    return <div key={file.path} className={`editor-tab${selectedPath === file.path ? ' active' : ''}`}>
                      <button type="button" role="tab" aria-selected={selectedPath === file.path} className="editor-tab-select" onClick={() => openProjectFile(file.path)}><span className="editor-tab-icon">{file.path.endsWith('.py') ? '🐍' : '▤'}</span>{file.path.split('/').pop()}{selectedPath === file.path && projectDirty && <i aria-label="저장되지 않음" />}</button>
                      <button type="button" className="editor-tab-close" onClick={() => closeProjectFile(file.path)} aria-label={`${file.path} 탭 닫기`} title="탭 닫기">×</button>
                    </div>
                  })}
                </div>
                <div className="editor-toolbar"><span>{selectedPath || '파일을 선택해 주세요'}</span><span>{projectDirty ? '변경됨' : '저장됨'}</span></div>
                <div className="monaco-editor-container">
                  {selectedPath ? <Suspense fallback={<div className="editor-empty">VS Code 편집기를 불러오는 중…</div>}><MonacoCodeEditor path={selectedPath} value={workspace.files.find((file) => file.path === selectedPath)?.content ?? ''} readOnly={projectBusy} onChange={(value) => updateProjectFile(value)} /></Suspense> : <div className="editor-empty">왼쪽에서 파일을 선택하거나 새 파일을 추가하세요.</div>}
                </div>
                <div className="editor-statusbar"><span>WebLink 편집기</span><span>{selectedPath ? editorLanguage(selectedPath) : '일반 텍스트'}</span><span>Ctrl+S 저장 · Ctrl+Enter 실행 · Ctrl+F 찾기 · Ctrl+W 탭 닫기</span></div>
              </section>
            </div>
            {versionPreview && <section className="version-preview"><div><strong>v{versionPreview.version_number} · {versionPreview.name}</strong><button className="back-link" type="button" onClick={() => setVersionPreview(null)}>닫기</button></div><p>{versionPreview.description || `리비전 ${workspace.revisions.find((item) => item.id === versionPreview.source_revision_id)?.revision_number ?? ''}에서 저장한 읽기 전용 버전`}</p>{versionPreview.files.map((file) => <details key={file.path}><summary>{file.path}</summary><pre>{file.content}</pre></details>)}</section>}
          </main>
        ) : <main className="learning-main"><p className="status">프로젝트를 여는 중…</p>{projectError && <p className="form-error" role="alert">{projectError}</p>}</main> : lessonLoading ? <main className="learning-main"><p className="status">수업을 준비하고 있어요…</p></main> : error && !lesson ? (
          <main className="learning-main"><p className="form-error" role="alert">{error}</p></main>
        ) : course && lesson ? (
          <main className="learning-main">
            <aside className="course-rail">
              <p className="eyebrow">학습 경로</p>
              <div className="course-picker" aria-label="학습 코스 목록">
                {courses.map((item) => <button key={item.slug} type="button" className={item.slug === course.slug ? 'active' : ''} onClick={() => openCourse(item.slug)} disabled={lessonLoading} aria-current={item.slug === course.slug ? 'page' : undefined}>
                  <span>{item.title}</span><small>{item.completed_lessons}/{item.total_lessons} 완료</small>
                </button>)}
              </div>
              <p className="eyebrow">학습 코스</p>
              <h2>{course.title}</h2>
              <p>{course.description}</p>
              <div className="course-progress"><span>{course.completed_lessons} / {course.total_lessons} 수업 완료</span><div><i style={{ width: `${course.total_lessons ? course.completed_lessons / course.total_lessons * 100 : 0}%` }} /></div></div>
              {course.lessons.map((item, index) => (
                <button className={`lesson-nav ${item.id === lesson.id ? 'selected' : ''}`} key={item.id} type="button" onClick={() => openLesson(item.slug)} disabled={lessonLoading} aria-current={item.id === lesson.id ? 'page' : undefined}>
                  <span className="lesson-number">{item.status === 'COMPLETED' ? '✓' : String(index + 1).padStart(2, '0')}</span>
                  <span><strong>{item.title}</strong><small>{item.status === 'COMPLETED' ? '완료' : item.status === 'IN_PROGRESS' ? '학습 중' : '시작 전'}</small></span>
                </button>
              ))}
            </aside>
            <article className="lesson-content">
              <p className="eyebrow">개념 배우기 · 약 5분</p>
              <h1>{lesson.title}</h1>
              <p className="lesson-summary">{lesson.summary}</p>
              <section className="objective-card"><span>오늘의 목표</span><p>{lesson.learning_objective}</p></section>
              <h2>프로그램은 어떻게 동작할까요?</h2>
              <p className="lesson-copy">{lesson.content.scenario}</p>
              <div className="flow-steps">
                {lesson.content.steps.map((step, index) => (
                  <div className="flow-step" key={step.label}>
                    <span className="flow-index">0{index + 1}</span>
                    <div><span className="flow-label">{step.label}</span><strong>{step.value}</strong><p>{step.description}</p></div>
                  </div>
                ))}
              </div>
              <div className="concept-row" aria-label="배우는 개념">
                {lesson.concepts.map((concept) => <span key={concept.slug} title={concept.description}>{concept.name}</span>)}
              </div>
              <section className="challenge-card">
                <p className="eyebrow">직접 생각해 보기</p>
                <h2>{lesson.content.challenge}</h2>
                <form className="answer-form" onSubmit={handleAttempt}>
                  {lesson.content.block_activity ? (
                    <section className="block-activity" aria-label="블록 코딩 활동">
                      <p className="block-instruction">{lesson.content.block_activity.instruction}</p>
                      <div className="block-goal"><span>만들 결과</span><strong>{lesson.content.block_activity.expected_output}</strong></div>
                      <div className="block-workbench">
                        <div className="block-palette">
                          <h3>사용할 블록</h3>
                          <p>블록을 눌러 코드 영역에 쌓아 보세요.</p>
                            {blockPalette.map((block) => {
                              const isUsed = assembledBlocks.includes(block.id)
                              return <button className={`code-block${isUsed ? ' used' : ''}`} key={block.id} type="button" onClick={() => addBlock(block.id)} disabled={submitting || isUsed} aria-pressed={isUsed}>
                            <strong className="code-block-title">{block.label}{isUsed && <span className="block-used-badge">✓ 사용함</span>}</strong><code>{block.code.split('\n').join('↵')}</code><small>{block.description}</small>
                          </button>
                            })}
                        </div>
                        <div className="block-stack-panel">
                          <h3>내 코드 블록 <span>{assembledBlocks.length}개</span></h3>
                          <ol className="block-stack">
                            {assembledBlocks.map((blockId, index) => {
                              const block = lesson.content.block_activity?.blocks.find((item) => item.id === blockId)
                              return block ? <li className="stacked-block" key={`${blockId}-${index}`}>
                                <span className="stack-order">{index + 1}</span>
                                <div><strong>{block.label}</strong><code>{block.code.split('\n').join('↵')}</code></div>
                                <div className="stack-controls"><button type="button" aria-label={`${block.label} 위로`} onClick={() => moveBlock(index, -1)} disabled={index === 0 || submitting}>↑</button><button type="button" aria-label={`${block.label} 아래로`} onClick={() => moveBlock(index, 1)} disabled={index === assembledBlocks.length - 1 || submitting}>↓</button><button type="button" aria-label={`${block.label} 제거`} onClick={() => removeBlock(index)} disabled={submitting}>×</button></div>
                              </li> : null
                            })}
                            {!assembledBlocks.length && <li className="stack-empty">여기에 블록을 쌓아 코드를 만들어 보세요.</li>}
                          </ol>
                          <h3>완성되는 파이썬 코드</h3>
                          <pre className="assembled-code">{assembledBlocks.map((id) => lesson.content.block_activity?.blocks.find((block) => block.id === id)?.code ?? '').join('') || '# 블록을 쌓으면 코드가 여기에 나타나요'}</pre>
                        </div>
                      </div>
                      {error && <p className="form-error" role="alert">{error}</p>}
                      {attemptResult && <div className="block-feedback" role="status"><p className={attemptResult.feedback.input.correct ? 'answer-feedback good' : 'answer-feedback'}>{attemptResult.feedback.input.message}</p><p className={attemptResult.feedback.process.correct ? 'answer-feedback good' : 'answer-feedback'}>{attemptResult.feedback.process.message}</p></div>}
                      {attemptResult?.completed && <><p className="completion-message" role="status">좋아요! 블록이 실제 파이썬 코드로 연결되는 것을 확인했어요.</p><button className="primary-button" type="button" onClick={continueInProject} disabled={projectBusy}>{projectBusy ? '프로젝트를 준비하고 있어요…' : '내 프로젝트에서 이어 만들기'}</button></>}
                      {!attemptResult?.completed && <button className="primary-button" type="submit" disabled={submitting}>{submitting ? '블록을 확인하고 있어요…' : '블록 순서 확인하기'}</button>}
                    </section>
                  ) : <>
                    {lesson.content.prompts.map((prompt) => (
                      <label key={prompt.field}>{prompt.label}
                        <input name={prompt.field} placeholder={prompt.placeholder} required maxLength={prompt.field === 'process' ? 500 : 300} />
                        {attemptResult && <span className={attemptResult.feedback[prompt.field].correct ? 'answer-feedback good' : 'answer-feedback'}>{attemptResult.feedback[prompt.field].message}</span>}
                      </label>
                    ))}
                    {error && <p className="form-error" role="alert">{error}</p>}
                    {attemptResult?.completed && <p className="completion-message" role="status">잘했어요! 입력, 처리, 출력의 흐름을 이해했어요.</p>}
                    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? '답을 살펴보고 있어요…' : '답안 확인하기'}</button>
                  </>}
                </form>
                <p className="attempt-count">시도 횟수: {lesson.attempts_count}</p>
              </section>
            </article>
          </main>
        ) : <main className="learning-main"><p>아직 공개된 수업이 없습니다.</p></main>}
      </div>
    )
  }

  return (
    <main className="welcome auth-page">
      <div className="brand-mark" aria-hidden="true">W</div>
      <p className="eyebrow">LEARN BY BUILDING</p>
      <h1>{mode === 'signup' ? '배우고, 만들고, 이해해요.' : '다시 만나 반가워요.'}</h1>
      <p className="intro">WebLink에서 소프트웨어를 직접 만들며 배워 보세요.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === 'signup' && (
          <label>이름<input name="display_name" type="text" autoComplete="name" required maxLength={80} /></label>
        )}
        <label>이메일<input name="email" type="email" autoComplete="email" required maxLength={320} /></label>
        <label>비밀번호<input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={12} maxLength={128} /></label>
        {mode === 'signup' && <p className="form-hint">비밀번호는 12자 이상으로 설정해 주세요.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? '잠시만요…' : mode === 'signup' ? '계정 만들기' : '로그인'}
        </button>
      </form>
      <p className="switch-mode">
        {mode === 'signup' ? '이미 계정이 있나요?' : '처음이신가요?'}{' '}
        <button type="button" onClick={() => { setError(''); setMode(mode === 'signup' ? 'login' : 'signup') }}>
          {mode === 'signup' ? '로그인' : '계정 만들기'}
        </button>
      </p>
      <p className="status"><span /> 배우는 과정을 프로젝트로 연결해요</p>
    </main>
  )
}
