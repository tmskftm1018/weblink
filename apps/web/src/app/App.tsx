import { FormEvent, useEffect, useMemo, useState } from 'react'
import { authService, User } from '../services/auth'
import { AttemptResult, Course, Lesson, learningService } from '../services/learning'
import { connectionService, GoogleConnectionStatus, GoogleSheetValues } from '../services/connections'
import { ProjectSummary, ProjectVersion, ProjectVersionDetails, ProjectWorkspace, projectService } from '../services/projects'

type Mode = 'login' | 'signup'
type View = 'lesson' | 'projects' | 'workspace' | 'connections'

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
  const [sheetRange, setSheetRange] = useState('Sheet1!A1:Z100')
  const [sheetPreview, setSheetPreview] = useState<GoogleSheetValues | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null)
  const [projectVersions, setProjectVersions] = useState<ProjectVersion[]>([])
  const [versionPreview, setVersionPreview] = useState<ProjectVersionDetails | null>(null)
  const [selectedPath, setSelectedPath] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [newFilePath, setNewFilePath] = useState('')
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
  const blockPalette = useMemo(() => {
    const blocks = lesson?.content.block_activity?.blocks ?? []
    const shuffled = [...blocks]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }
    return shuffled
  }, [lesson?.id])

  useEffect(() => {
    authService.me().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])

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
    setProjectVersions([])
    setVersionPreview(null)
    setView('lesson')
  }

  async function showProjects() {
    if (view === 'workspace' && projectDirty) {
      setProjectError('나가기 전에 변경 사항을 저장해 주세요.')
      return
    }
    setView('projects')
    setWorkspace(null)
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
    if (view === 'workspace' && projectDirty) {
      setProjectError('연결 관리로 이동하기 전에 프로젝트 변경 사항을 저장해 주세요.')
      return
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
    setConnectionsBusy(true)
    setConnectionsError('')
    setSheetPreview(null)
    try {
      setSheetPreview(await connectionService.readGoogleSheet(spreadsheetId, sheetRange))
    } catch (cause) {
      setConnectionsError(cause instanceof Error ? cause.message : '스프레드시트를 읽지 못했습니다.')
    } finally {
      setConnectionsBusy(false)
    }
  }

  function showLesson() {
    if (view === 'workspace' && projectDirty) {
      setProjectError('수업으로 이동하기 전에 변경 사항을 저장해 주세요.')
      return
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
    try {
      const created = await projectService.create({ name: newProjectName, description: newProjectDescription })
      setWorkspace(created)
      setProjectVersions([])
      setVersionPreview(null)
      setSelectedPath(created.files[0]?.path ?? '')
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

  async function openProject(projectId: string) {
    setProjectBusy(true)
    setProjectError('')
    setProjectNotice('')
    try {
      const [loaded, versions] = await Promise.all([projectService.get(projectId), projectService.listVersions(projectId)])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setVersionPreview(null)
      setSelectedPath(loaded.files[0]?.path ?? '')
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
    setWorkspace({
      ...workspace,
      files: workspace.files.map((file) => file.path === selectedPath ? { ...file, content } : file),
    })
    setProjectDirty(true)
    setProjectNotice('저장되지 않은 변경 사항이 있습니다.')
  }

  function addProjectFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace || !newFilePath.trim()) return
    const path = newFilePath.trim().replace(/\\/g, '/')
    if (workspace.files.some((file) => file.path === path)) {
      setProjectError('같은 경로의 파일이 이미 있습니다.')
      return
    }
    setWorkspace({ ...workspace, files: [...workspace.files, { path, content: '' }].sort((a, b) => a.path.localeCompare(b.path)) })
    setSelectedPath(path)
    setNewFilePath('')
    setProjectDirty(true)
    setProjectError('')
    setProjectNotice('새 파일이 추가되었습니다. 저장해 주세요.')
  }

  async function saveProjectDraft() {
    if (!workspace) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const saved = await projectService.saveDraft(workspace.id, workspace.draft_version, workspace.files)
      setWorkspace({ ...workspace, draft_version: saved.draft_version, updated_at: saved.updated_at })
      setProjects((current) => current.map((project) => project.id === workspace.id
        ? { ...project, draft_version: saved.draft_version, updated_at: saved.updated_at }
        : project))
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice(`초안을 v${saved.draft_version}로 저장했습니다.`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '초안을 저장하지 못했습니다.'
      setProjectError(message)
      setProjectNeedsReload(message.includes('최신 초안'))
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
      setSelectedPath(loaded.files[0]?.path ?? '')
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

  async function saveProjectRevision() {
    if (!workspace || projectDirty) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const result = await projectService.createRevision(workspace.id)
      setWorkspace({
        ...workspace,
        revisions: result.created
          ? [result.revision, ...workspace.revisions]
          : workspace.revisions,
      })
      setProjectNotice(result.created
        ? `리비전 ${result.revision.revision_number}을(를) 만들었습니다.`
        : '변경된 파일이 없어 기존 리비전을 유지했습니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '리비전을 만들지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function saveProjectVersion() {
    if (!workspace || projectDirty) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const revisionResult = await projectService.createRevision(workspace.id)
      const revision = revisionResult.revision
      const saved = await projectService.saveVersion(workspace.id, revision.id, `버전 ${projectVersions.length + 1}`)
      setProjectVersions((current) => [saved, ...current])
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
    if (!workspace || projectDirty) {
      setProjectError('복원 전에 초안을 저장해 주세요.')
      return
    }
    setProjectBusy(true)
    setProjectError('')
    try {
      const restored = await projectService.restoreVersion(workspace.id, versionId)
      const [loaded, versions] = await Promise.all([projectService.get(workspace.id), projectService.listVersions(workspace.id)])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setVersionPreview(null)
      setSelectedPath(loaded.files[0]?.path ?? '')
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
    if (!workspace || projectDirty) {
      setProjectError('실행 전에 초안을 저장해 주세요.')
      return
    }
    setProjectBusy(true)
    setProjectError('')
    setRunResult(null)
    setDebugSaved(false)
    setDebugHint(null)
    try {
      const created = await projectService.createRevision(workspace.id)
      const revision = created.revision
      if (created.created) {
        setWorkspace((current) => current ? { ...current, revisions: [revision, ...current.revisions] } : current)
      }
      let result = await projectService.run(workspace.id, revision.id)
      setRunResult(result)
      while (result.status === 'QUEUED' || result.status === 'RUNNING') {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        result = await projectService.getRun(workspace.id, result.id)
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
    try {
      const created = await projectService.create({
        name: `${lesson.title} 프로젝트`,
        description: '블록으로 조립한 파이썬 코드를 실제 프로젝트로 이어서 만들어 봅니다.',
      })
      const source = assembledBlocks
        .map((id) => lesson.content.block_activity?.blocks.find((block) => block.id === id)?.code ?? '')
        .join('')
      const files = created.files.map((file) => file.path === 'main.py' ? { ...file, content: `${source}\n` } : file)
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
      setSelectedPath('main.py')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice('블록으로 조립한 코드를 프로젝트로 옮겼어요. 이제 실행하고 바꿔 보세요.')
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
                    <label>스프레드시트 ID<input value={spreadsheetId} onChange={(event) => setSpreadsheetId(event.target.value)} required maxLength={200} placeholder="주소에서 /d/ 다음에 있는 ID" /></label>
                    <label>시트 범위<input value={sheetRange} onChange={(event) => setSheetRange(event.target.value)} required maxLength={128} placeholder="예: Sheet1!A1:C20" /></label>
                    <button className="primary-button" type="submit" disabled={connectionsBusy || !spreadsheetId.trim()}>{connectionsBusy ? '읽는 중…' : '데이터 확인하기'}</button>
                  </form>
                  {sheetPreview && <div className="sheet-preview"><p><strong>{sheetPreview.range}</strong> · {sheetPreview.values.length}행</p>{sheetPreview.values.length ? <div className="sheet-table-wrap"><table><tbody>{sheetPreview.values.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell)}</td>)}</tr>)}</tbody></table></div> : <p>범위에 데이터가 없어요.</p>}</div>}
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
            <div className="project-heading"><p className="eyebrow">만들며 배우기</p><h1>내 프로젝트</h1><p>아이디어를 작은 프로젝트로 시작해 보세요. 초안은 언제든 저장하고, 의미 있는 순간을 리비전으로 남길 수 있어요.</p></div>
            <div className="project-list-layout">
              <section className="project-cards">
                <h2>프로젝트 목록</h2>
                {projectError && <p className="form-error" role="alert">{projectError}</p>}
                {projectBusy && projects.length === 0 ? <p className="empty-projects">프로젝트를 불러오고 있어요…</p> : projects.length ? projects.map((project) => (
                  <button className="project-card" key={project.id} type="button" onClick={() => openProject(project.id)}>
                    <span className="project-card-icon">↗</span>
                    <span className="project-card-copy"><strong>{project.name}</strong><small>{project.description || '설명이 아직 없습니다.'}</small><small>초안 v{project.draft_version} · {new Date(project.updated_at).toLocaleDateString('ko-KR')}</small></span>
                  </button>
                )) : <p className="empty-projects">첫 프로젝트를 만들어 보세요. 시작 파일이 함께 준비됩니다.</p>}
              </section>
              <form className="project-create-form" onSubmit={handleCreateProject}>
                <p className="eyebrow">새 출발</p><h2>프로젝트 만들기</h2>
                <label>프로젝트 이름<input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} required maxLength={120} placeholder="예: 나만의 인사말 앱" /></label>
                <label>한 줄 설명<textarea value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} maxLength={1000} rows={3} placeholder="무엇을 만들고 싶나요?" /></label>
                <button className="primary-button" type="submit" disabled={projectBusy}>{projectBusy ? '만드는 중…' : '프로젝트 시작하기'}</button>
              </form>
            </div>
          </main>
        ) : view === 'workspace' ? workspace ? (
          <main className="workspace-main">
            <div className="workspace-heading">
              <div><button className="back-link" type="button" onClick={showProjects}>← 프로젝트 목록</button><h1>{workspace.name}</h1><p>초안 버전 {workspace.draft_version}{projectDirty ? ' · 저장되지 않은 변경 사항' : ''}</p></div>
              <div className="workspace-actions">
                <button className="secondary-button" type="button" onClick={saveProjectDraft} disabled={projectBusy || !projectDirty}>{projectBusy ? '저장 중…' : '초안 저장'}</button>
                <button className="primary-button" type="button" onClick={saveProjectRevision} disabled={projectBusy || projectDirty}>{projectBusy ? '처리 중…' : '리비전 만들기'}</button>
                <button className="secondary-button" type="button" onClick={saveProjectVersion} disabled={projectBusy || projectDirty}>{projectBusy ? '처리 중…' : '버전 저장'}</button>
                <button className="primary-button" type="button" onClick={runProject} disabled={projectBusy || projectDirty}>{projectBusy ? '실행 중…' : '실행'}</button>
              </div>
            </div>
            {projectNotice && <p className="project-notice" role="status">{projectNotice}</p>}
            {projectError && <p className="form-error project-message" role="alert">{projectError}</p>}
            {projectNeedsReload && <button className="reload-draft-button" type="button" onClick={reloadWorkspace} disabled={projectBusy}>서버의 최신 초안 불러오기</button>}
            {runResult && <section className="run-output" aria-live="polite"><strong>실행 결과 · {runResult.status}</strong><p><b>예상</b> 코드를 실행하면 의도한 결과가 나와야 합니다.</p><p><b>실제 출력</b></p><pre>{runResult.stdout || '(출력 없음)'}</pre><p><b>오류</b></p><pre>{runResult.stderr || (runResult.failure_category ? `실패 유형: ${runResult.failure_category}` : '(오류 없음)')}</pre><p><b>종료 코드</b> {runResult.exit_code ?? '실행 중'}</p>
              {runResult.status === 'FAILED' && <form className="debug-notes" onSubmit={saveDebugNotes}><h3>디버깅해 보기</h3><label>어떤 결과를 예상했나요?<textarea value={expectedOutput} onChange={(event) => setExpectedOutput(event.target.value)} rows={2} maxLength={16384} /></label><label>왜 이런 결과가 나왔다고 생각하나요?<textarea value={debugHypothesis} onChange={(event) => setDebugHypothesis(event.target.value)} rows={3} required maxLength={4000} placeholder="원인에 대한 가설을 적어 보세요." /></label><p className="ai-privacy-note">AI 힌트를 요청하면 main.py 일부, 실행 오류, 예상 결과와 가설이 AI 제공자에게 전달됩니다. 코드는 대신 고치지 않아요.</p><div className="debug-actions"><button className="secondary-button" type="submit" disabled={projectBusy || aiBusy || !debugHypothesis.trim()}>{debugSaved ? '기록 업데이트' : '가설 저장'}</button><button className="primary-button" type="button" onClick={requestDebugHint} disabled={projectBusy || aiBusy || !debugHypothesis.trim()}>{aiBusy ? '힌트를 생각하고 있어요…' : 'AI 디버깅 힌트'}</button></div>{debugSaved && <span role="status">기록됨</span>}{debugHint && <div className="ai-hint" role="status"><strong>{debugHint.summary}</strong><p>{debugHint.hint}</p><em>{debugHint.next_question}</em></div>}</form>}
            </section>}
            <div className="workspace-grid">
              <aside className="file-panel">
                <p className="panel-label">파일</p>
                {workspace.files.map((file) => <button className={`file-row ${selectedPath === file.path ? 'active' : ''}`} key={file.path} type="button" onClick={() => setSelectedPath(file.path)}><span>▤</span>{file.path}</button>)}
                <form className="new-file-form" onSubmit={addProjectFile}><input value={newFilePath} onChange={(event) => setNewFilePath(event.target.value)} placeholder="src/new-file.ts" aria-label="새 파일 경로" required maxLength={240} /><button type="submit" disabled={projectBusy}>추가</button></form>
                <p className="panel-label revision-label">리비전 기록</p>
                {workspace.revisions.length ? workspace.revisions.map((revision) => <div className="revision-row" key={revision.id}><strong>리비전 {revision.revision_number}</strong><small>{revision.source_hash.slice(0, 10)}</small></div>) : <p className="revision-empty">저장한 리비전이 아직 없습니다.</p>}
                <p className="panel-label revision-label">저장한 버전</p>
                {projectVersions.length ? projectVersions.map((version) => <div className="saved-version-row" key={version.id}><strong>v{version.version_number} · {version.name}</strong><small>Python {version.runtime_spec.version}</small><div><button type="button" onClick={() => viewProjectVersion(version.id)} disabled={projectBusy}>보기</button><button type="button" onClick={() => restoreProjectVersion(version.id)} disabled={projectBusy || projectDirty}>복원</button></div></div>) : <p className="revision-empty">저장한 버전이 없습니다.</p>}
              </aside>
              <section className="editor-panel">
                <div className="editor-toolbar"><span>{selectedPath || '파일을 선택해 주세요'}</span><span>{projectDirty ? '변경됨' : '저장됨'}</span></div>
                <textarea className="code-editor" aria-label="파일 편집기" spellCheck={false} disabled={projectBusy} value={workspace.files.find((file) => file.path === selectedPath)?.content ?? ''} onChange={(event) => updateProjectFile(event.target.value)} />
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
