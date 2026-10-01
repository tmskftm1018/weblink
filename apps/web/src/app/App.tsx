import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { authService, User } from '../services/auth'
import { AttemptResult, Course, Lesson, learningService } from '../services/learning'
import { connectionService, GitHubConnectionStatus, GoogleConnectionStatus, GoogleSheetValues } from '../services/connections'
import { ManagedProjectInvitation, ProjectGitHubSource, ProjectMember, ProjectSummary, ProjectTask, ProjectTaskActivity, TaskChecklistItem, ProjectTaskPriority, ProjectTaskStatus, ProjectTeamActivity, ProjectVersion, ProjectVersionDetails, ProjectWorkspace, TaskDiscussion, projectService } from '../services/projects'
import { bindProjectDirectory, chooseProjectDirectory, getProjectDirectory, moveProjectFileInDirectory, moveProjectFilesInDirectory, ProjectDirectory, readProjectDirectory, removeEmptyProjectDirectoryFromDirectory, removeProjectFileFromDirectory, unbindProjectDirectory, writeProjectDirectory } from '../services/localProjects'
import { readDroppedProjectItems } from '../services/projectDropImport'
import { pickGoogleDriveFiles } from '../services/googleDrivePicker'
import ProjectFileTree, { buildProjectFileTree } from './ProjectFileTree'
import ProjectReadmePreview from './ProjectReadmePreview'
import LandingPage from './LandingPage'

type Mode = 'login' | 'signup'
type View = 'lesson' | 'projects' | 'workspace' | 'connections'
type ProjectWorkspaceSection = 'overview' | 'code' | 'tasks' | 'team' | 'storage'
type NewProjectEntryKind = 'auto' | 'file' | 'folder'
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const taskColumns: Array<{ status: ProjectTaskStatus; label: string }> = [
  { status: 'TODO', label: '할 일' },
  { status: 'IN_PROGRESS', label: '진행 중' },
  { status: 'DONE', label: '완료' },
]
const taskPriorityOrder: Record<ProjectTaskPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }
const localToday = () => {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

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
  const [showLanding, setShowLanding] = useState(true)
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
  const [githubConnection, setGithubConnection] = useState<GitHubConnectionStatus | null>(null)
  const [githubToken, setGithubToken] = useState('')
  const [connectionsBusy, setConnectionsBusy] = useState(false)
  const [connectionsError, setConnectionsError] = useState('')
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [sheetRange, setSheetRange] = useState("'시트1'!A1:Z100")
  const [sheetPreview, setSheetPreview] = useState<GoogleSheetValues | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([])
  const [projectTeamActivity, setProjectTeamActivity] = useState<ProjectTeamActivity[]>([])
  const [onlineProjectMemberIds, setOnlineProjectMemberIds] = useState<string[]>([])
  const [projectEventsConnected, setProjectEventsConnected] = useState(false)
  const [projectInvitations, setProjectInvitations] = useState<ManagedProjectInvitation[]>([])
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([])
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR')
  const [projectInviteToken, setProjectInviteToken] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('project_invite')
    return fromUrl || window.sessionStorage.getItem('weblink.project-invite') || ''
  })
  const [projectInviteLink, setProjectInviteLink] = useState('')
  const [editingProjectDetails, setEditingProjectDetails] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskAssigneeId, setTaskAssigneeId] = useState('')
  const [taskPriority, setTaskPriority] = useState<ProjectTaskPriority>('NORMAL')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskTitle, setEditingTaskTitle] = useState('')
  const [editingTaskDescription, setEditingTaskDescription] = useState('')
  const [editingTaskPriority, setEditingTaskPriority] = useState<ProjectTaskPriority>('NORMAL')
  const [editingTaskDueDate, setEditingTaskDueDate] = useState('')
  const [openTaskDiscussionId, setOpenTaskDiscussionId] = useState<string | null>(null)
  const [taskDiscussions, setTaskDiscussions] = useState<Record<string, TaskDiscussion>>({})
  const [taskChecklists, setTaskChecklists] = useState<Record<string, TaskChecklistItem[]>>({})
  const [taskCommentDrafts, setTaskCommentDrafts] = useState<Record<string, string>>({})
  const [taskCommentBusy, setTaskCommentBusy] = useState(false)
  const [taskChecklistDrafts, setTaskChecklistDrafts] = useState<Record<string, string>>({})
  const [taskChecklistBusyId, setTaskChecklistBusyId] = useState<string | null>(null)
  const [projectTaskActivity, setProjectTaskActivity] = useState<ProjectTaskActivity[]>([])
  const [seenTaskActivityIds, setSeenTaskActivityIds] = useState<string[]>([])
  const [taskActivityOpen, setTaskActivityOpen] = useState(false)
  const [taskSearch, setTaskSearch] = useState('')
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState('ALL')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<'ALL' | ProjectTaskPriority>('ALL')
  const [taskDeadlineFilter, setTaskDeadlineFilter] = useState<'ALL' | 'OVERDUE' | 'TODAY' | 'WEEK' | 'NO_DATE'>('ALL')
  const [projectSearch, setProjectSearch] = useState('')
  const [projectRoleFilter, setProjectRoleFilter] = useState<'ALL' | 'OWNER' | 'MEMBER'>('ALL')
  const [projectSort, setProjectSort] = useState<'UPDATED' | 'NAME'>('UPDATED')
  const [projectFolders, setProjectFolders] = useState<Record<string, string>>({})
  const [archiveToImport, setArchiveToImport] = useState<File | null>(null)
  const [archiveProjectName, setArchiveProjectName] = useState('')
  const [githubRepositoryUrl, setGithubRepositoryUrl] = useState('')
  const [githubProjectName, setGithubProjectName] = useState('')
  const [projectListPanel, setProjectListPanel] = useState<'create' | 'import' | null>(null)
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null)
  const [githubSource, setGithubSource] = useState<ProjectGitHubSource | null>(null)
  const [workspaceSection, setWorkspaceSection] = useState<ProjectWorkspaceSection>('overview')
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
  const [projectAccessLost, setProjectAccessLost] = useState(false)
  const [projectNotice, setProjectNotice] = useState('')
  const [projectError, setProjectError] = useState('')
  const [runResult, setRunResult] = useState<Awaited<ReturnType<typeof projectService.getRun>> | null>(null)
  const [debugHypothesis, setDebugHypothesis] = useState('')
  const [expectedOutput, setExpectedOutput] = useState('')
  const [debugSaved, setDebugSaved] = useState(false)
  const [debugHint, setDebugHint] = useState<Awaited<ReturnType<typeof projectService.requestDebugHint>> | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const workspaceRef = useRef(workspace)
  const projectDirtyRef = useRef(projectDirty)
  const projectBusyRef = useRef(projectBusy)
  const autoSaveAttemptRef = useRef('')
  workspaceRef.current = workspace
  projectDirtyRef.current = projectDirty
  projectBusyRef.current = projectBusy
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLocaleLowerCase()
    return projects
      .filter((project) => (projectRoleFilter === 'ALL' || (projectRoleFilter === 'OWNER' ? project.role === 'OWNER' : project.role !== 'OWNER'))
        && `${project.name} ${project.description}`.toLocaleLowerCase().includes(query))
      .sort((left, right) => projectSort === 'NAME'
        ? left.name.localeCompare(right.name, 'ko')
        : new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
  }, [projects, projectSearch, projectRoleFilter, projectSort])
  const projectFileTree = useMemo(() => buildProjectFileTree(workspace?.files ?? []), [workspace?.files])
  const projectReadmeFile = workspace?.files.find((file) => file.path.toLocaleLowerCase() === 'readme.md')
  const currentProjectRole = projectMembers.find((member) => member.user_id === user?.id)?.role ?? 'VIEWER'
  const canManageProject = currentProjectRole === 'OWNER' && !projectAccessLost
  const isProjectReadOnly = currentProjectRole === 'VIEWER' || projectAccessLost
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
    if (projectInviteToken) window.sessionStorage.setItem('weblink.project-invite', projectInviteToken)
  }, [projectInviteToken])

  useEffect(() => {
    if (view !== 'workspace' || !workspace || workspace.role !== 'OWNER') {
      setProjectInvitations([])
      return
    }
    let cancelled = false
    projectService.listInvitations(workspace.id)
      .then((invitations) => { if (!cancelled) setProjectInvitations(invitations) })
      .catch(() => { if (!cancelled) setProjectInvitations([]) })
    return () => { cancelled = true }
  }, [view, workspace?.id, workspace?.role])

  useEffect(() => {
    const projectId = workspace?.id
    if (view !== 'workspace' || !projectId) return
    let cancelled = false
    let checking = false
    let refreshRequested = false
    async function checkForCollaboratorChanges() {
      if (checking) { refreshRequested = true; return }
      if (document.visibilityState === 'hidden') return
      const startingWorkspace = workspaceRef.current
      if (!startingWorkspace || startingWorkspace.id !== projectId) return
      checking = true
      try {
        const [latest, latestMembers, latestTasks, latestTeamActivity, latestInvitations] = await Promise.all([
          projectService.get(projectId),
          projectService.listMembers(projectId),
          projectService.listTasks(projectId),
          projectService.listTeamActivity(projectId),
          startingWorkspace.role === 'OWNER' ? projectService.listInvitations(projectId) : Promise.resolve(null),
        ])
        if (cancelled) return
        setProjectMembers(latestMembers)
        setProjectTasks(latestTasks)
        setProjectTeamActivity(latestTeamActivity)
        if (latestInvitations) setProjectInvitations(latestInvitations)
        if (projectAccessLost) {
          setProjectAccessLost(false)
          setProjectError('')
          setProjectNotice('프로젝트 접근 권한이 다시 연결되어 최신 정보를 확인했습니다.')
        }
        const current = workspaceRef.current
        if (!current || current.id !== projectId) return
        const metadataChanged = latest.name !== current.name || latest.description !== current.description
        const draftChanged = latest.draft_version > current.draft_version
        if (metadataChanged) {
          setProjects((items) => items.map((item) => item.id === projectId
            ? { ...item, name: latest.name, description: latest.description, updated_at: latest.updated_at }
            : item))
        }
        if (!draftChanged) {
          if (metadataChanged) {
            setWorkspace((active) => active?.id === projectId
              ? { ...active, name: latest.name, description: latest.description, updated_at: latest.updated_at }
              : active)
            setProjectNotice('팀원이 변경한 프로젝트 이름이나 설명을 반영했습니다.')
          }
          return
        }
        if (projectDirtyRef.current || projectBusyRef.current) {
          if (metadataChanged) {
            setWorkspace((active) => active?.id === projectId
              ? { ...active, name: latest.name, description: latest.description, updated_at: latest.updated_at }
              : active)
          }
          setProjectNeedsReload(true)
          setProjectNotice('팀원이 최신 초안을 저장했습니다. 내 저장되지 않은 수정은 최신 초안을 불러올 때 사라지니, 필요한 코드는 먼저 복사해 보관해 주세요.')
          return
        }
        const latestVersions = await projectService.listVersions(projectId)
        if (cancelled) return
        const currentAfterFetch = workspaceRef.current
        if (!currentAfterFetch || currentAfterFetch.id !== projectId) return
        if (projectDirtyRef.current || projectBusyRef.current || latest.draft_version <= currentAfterFetch.draft_version) {
          if (latest.draft_version > currentAfterFetch.draft_version) {
            setProjectNeedsReload(true)
            setProjectNotice('팀원이 최신 초안을 저장했습니다. 내 저장되지 않은 수정은 최신 초안을 불러올 때 사라지니, 필요한 코드는 먼저 복사해 보관해 주세요.')
          }
          return
        }
        const availablePaths = new Set(latest.files.map((file) => file.path))
        setWorkspace(latest)
        setProjectVersions(latestVersions)
        setOpenFilePaths((currentPaths) => {
          const retained = currentPaths.filter((path) => availablePaths.has(path))
          return retained.length ? retained : latest.files[0] ? [latest.files[0].path] : []
        })
        setSelectedPath((currentPath) => availablePaths.has(currentPath) ? currentPath : latest.files[0]?.path ?? '')
        setProjectNeedsReload(false)
        setProjectError('')
        setProjectNotice(`팀원이 저장한 최신 초안 v${latest.draft_version}을 화면에 반영했습니다.`)
      } catch (cause) {
        if (!cancelled && cause instanceof Error
          && (cause.message.includes('Project not found') || cause.message.includes('프로젝트를 찾지 못했습니다'))) {
          setProjectAccessLost(true)
          setProjectMembers([])
          setProjectTeamActivity([])
          setProjectError('이 프로젝트의 접근 권한이 해제됐거나 프로젝트가 삭제되어 서버와 동기화할 수 없습니다. 저장되지 않은 코드가 있다면 화면을 떠나기 전에 복사해 두세요.')
        }
        // Temporary connection failures do not interrupt editing; the next interval or focus retries.
      } finally {
        checking = false
        if (refreshRequested && !cancelled && (document.visibilityState as string) !== 'hidden') {
          refreshRequested = false
          window.setTimeout(() => void checkForCollaboratorChanges(), 0)
        }
      }
    }
    void checkForCollaboratorChanges()
    const interval = window.setInterval(() => void checkForCollaboratorChanges(), 10_000)
    window.addEventListener('focus', checkForCollaboratorChanges)
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let pingTimer = 0
    const connectToProjectEvents = () => {
      if (cancelled) return
      const socketUrl = `${apiBaseUrl.replace(/\/+$/, '').replace(/^http/, 'ws')}/api/v1/projects/${projectId}/events`
      socket = new WebSocket(socketUrl)
      socket.onopen = () => {
        setProjectEventsConnected(true)
        window.clearTimeout(reconnectTimer)
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send('ping')
        }, 25_000)
      }
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; area?: string }
          if (payload.type === 'project.presence' && Array.isArray((payload as { user_ids?: unknown }).user_ids)) {
            setOnlineProjectMemberIds((payload as { user_ids: string[] }).user_ids.filter((id) => typeof id === 'string'))
          } else if (payload.type === 'project.changed') {
            void checkForCollaboratorChanges()
            void projectService.listTaskActivity(projectId).then(setProjectTaskActivity).catch(() => undefined)
            if (payload.area === 'github') {
              void projectService.githubSource(projectId)
                .then((source) => { if (workspaceRef.current?.id === projectId) setGithubSource(source) })
                .catch(() => undefined)
            }
          }
        } catch {
          // Ignore malformed or future event types; periodic refresh remains the fallback.
        }
      }
      socket.onclose = () => {
        setProjectEventsConnected(false)
        setOnlineProjectMemberIds([])
        window.clearInterval(pingTimer)
        if (!cancelled) reconnectTimer = window.setTimeout(connectToProjectEvents, 5_000)
      }
      socket.onerror = () => socket?.close()
    }
    connectToProjectEvents()
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.clearInterval(pingTimer)
      window.clearTimeout(reconnectTimer)
      socket?.close()
      window.removeEventListener('focus', checkForCollaboratorChanges)
    }
  }, [view, workspace?.id, workspace?.draft_version, projectAccessLost])

  const autoSaveSignature = useMemo(() => workspace
    ? JSON.stringify([workspace.id, workspace.draft_version, workspace.files.map((file) => [file.path, file.content])])
    : '', [workspace])

  useEffect(() => {
    if (view !== 'workspace' || !workspace || !projectDirty || projectBusy || projectNeedsReload || isProjectReadOnly) return
    if (autoSaveAttemptRef.current === autoSaveSignature) return
    const timer = window.setTimeout(() => {
      autoSaveAttemptRef.current = autoSaveSignature
      void saveProjectDraft()
    }, 1_500)
    return () => window.clearTimeout(timer)
  }, [view, workspace, projectDirty, projectBusy, projectNeedsReload, isProjectReadOnly, autoSaveSignature, saveProjectDraft])

  useEffect(() => {
    const projectId = workspace?.id
    const taskId = openTaskDiscussionId
    if (view !== 'workspace' || !projectId || !taskId) return
    let cancelled = false
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const [discussion, checklist] = await Promise.all([
          projectService.getTaskDiscussion(projectId, taskId),
          projectService.listTaskChecklist(projectId, taskId),
        ])
        if (!cancelled) {
          setTaskDiscussions((current) => ({ ...current, [taskId]: discussion }))
          setTaskChecklists((current) => ({ ...current, [taskId]: checklist }))
        }
      } catch {
        // The project membership poll handles revoked access; the open discussion retries next interval.
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [view, workspace?.id, openTaskDiscussionId])

  useEffect(() => {
    const projectId = workspace?.id
    const userId = user?.id
    if (view !== 'workspace' || !projectId || !userId) return
    const storageKey = `weblink.task-activity-seen:${userId}:${projectId}`
    let cancelled = false
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const activities = await projectService.listTaskActivity(projectId)
        if (cancelled) return
        setProjectTaskActivity(activities)
        let previouslySeen: string[] = []
        let hasSavedReadState = false
        try {
          const saved = window.localStorage.getItem(storageKey)
          if (saved !== null) {
            const parsed: unknown = JSON.parse(saved)
            if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) {
              hasSavedReadState = true
              previouslySeen = parsed
            }
          }
        } catch {
          previouslySeen = []
        }
        const seenNow = !hasSavedReadState || taskActivityOpen
          ? [...new Set([...previouslySeen, ...activities.map((item) => item.id)])].slice(-200)
          : previouslySeen
        setSeenTaskActivityIds(seenNow)
        try { window.localStorage.setItem(storageKey, JSON.stringify(seenNow)) } catch { /* Browser storage may be unavailable. */ }
      } catch {
        // Project access and transient API errors are handled by the workspace sync flow.
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [view, workspace?.id, user?.id, taskActivityOpen])

  useEffect(() => {
    setWorkspaceSection('overview')
    setOpenTaskDiscussionId(null)
    setTaskDiscussions({})
    setTaskChecklists({})
    setTaskCommentDrafts({})
    setTaskChecklistDrafts({})
    setProjectTaskActivity([])
    setSeenTaskActivityIds([])
    setTaskActivityOpen(false)
    setTaskSearch('')
    setTaskAssigneeFilter('ALL')
    setTaskPriorityFilter('ALL')
    setTaskDeadlineFilter('ALL')
  }, [workspace?.id])

  useEffect(() => {
    if (openTaskDiscussionId && !projectTasks.some((task) => task.id === openTaskDiscussionId)) {
      setOpenTaskDiscussionId(null)
    }
  }, [openTaskDiscussionId, projectTasks])

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
    setProjectMembers([])
    setOnlineProjectMemberIds([])
    setProjectEventsConnected(false)
    setProjectTeamActivity([])
    setGithubSource(null)
    setProjectTasks([])
    setProjectAccessLost(false)
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
      if (projectAccessLost) {
        if (!window.confirm('프로젝트 접근 권한이 없어 수정 내용을 저장할 수 없습니다. 필요한 코드를 복사해 두었나요? 프로젝트 목록으로 이동할까요?')) return
      } else {
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
    }
    setView('projects')
    setWorkspace(null)
    setProjectMembers([])
    setOnlineProjectMemberIds([])
    setProjectEventsConnected(false)
    setProjectTeamActivity([])
    setProjectTasks([])
    setProjectAccessLost(false)
    setEditingProjectDetails(false)
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
    const [googleResult, githubResult] = await Promise.allSettled([connectionService.googleStatus(), connectionService.githubStatus()])
    if (googleResult.status === 'fulfilled') setGoogleConnection(googleResult.value)
    if (githubResult.status === 'fulfilled') setGithubConnection(githubResult.value)
    const failure = googleResult.status === 'rejected' ? googleResult.reason
      : githubResult.status === 'rejected' ? githubResult.reason : null
    if (failure) setConnectionsError(failure instanceof Error ? failure.message : '연결 상태를 불러오지 못했습니다.')
    setConnectionsBusy(false)
  }

  async function connectGitHub() {
    if (!githubToken.trim()) return
    setConnectionsBusy(true)
    setConnectionsError('')
    try {
      const status = await connectionService.connectGitHub(githubToken.trim())
      setGithubConnection(status)
      setGithubToken('')
    } catch (cause) {
      setConnectionsError(cause instanceof Error ? cause.message : 'GitHub 연결을 저장하지 못했습니다.')
    } finally {
      setConnectionsBusy(false)
    }
  }

  async function disconnectGitHub() {
    setConnectionsBusy(true)
    setConnectionsError('')
    try {
      await connectionService.disconnectGitHub()
      setGithubConnection(await connectionService.githubStatus())
    } catch (cause) {
      setConnectionsError(cause instanceof Error ? cause.message : 'GitHub 연결을 해제하지 못했습니다.')
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
      const members = await projectService.listMembers(created.id)
      setProjectMembers(members)
      setProjectTasks([])
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
      const [loaded, members, tasks] = await Promise.all([projectService.get(created.id), projectService.listMembers(created.id), projectService.listTasks(created.id)])
      setProjectMembers(members)
      setProjectTasks(tasks)
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
      const [loaded, versions, projectList, members, tasks] = await Promise.all([
        projectService.get(created.id),
        projectService.listVersions(created.id),
        projectService.list(),
        projectService.listMembers(created.id),
        projectService.listTasks(created.id),
      ])
      setProjectMembers(members)
      setProjectTasks(tasks)
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
          const [loaded, versions, projectList, members, tasks] = await Promise.all([
            projectService.get(createdProjectId),
            projectService.listVersions(createdProjectId),
            projectService.list(),
            projectService.listMembers(createdProjectId),
            projectService.listTasks(createdProjectId),
          ])
          setProjectMembers(members)
          setProjectTasks(tasks)
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
      setProjectMembers(await projectService.listMembers(imported.id))
      setProjectTasks([])
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
        role: imported.role,
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

  async function handleImportGithubRepository() {
    if (!githubRepositoryUrl.trim() || !githubProjectName.trim()) {
      setProjectError('GitHub 저장소 주소와 프로젝트 이름을 입력해 주세요.')
      return
    }
    setProjectBusy(true)
    setProjectError('')
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    try {
      const imported = await projectService.importGithubRepository(githubProjectName, githubRepositoryUrl)
      setProjectMembers(await projectService.listMembers(imported.id))
      setProjectTasks([])
      setWorkspace(imported)
      setProjectVersions([])
      setVersionPreview(null)
      resetProjectFiles(imported.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice('GitHub 저장소를 가져왔어요. 비밀 파일과 지원하지 않는 파일은 가져오지 않습니다.')
      void projectService.githubSource(imported.id).then((source) => { if (workspaceRef.current?.id === imported.id) setGithubSource(source) }).catch(() => undefined)
      setProjects((current) => [{
        id: imported.id,
        name: imported.name,
        description: imported.description,
        draft_version: imported.draft_version,
        updated_at: imported.updated_at,
        role: imported.role,
      }, ...current])
      setView('workspace')
      setProjectListPanel(null)
      setGithubRepositoryUrl('')
      setGithubProjectName('')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'GitHub 저장소를 가져오지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function selectGoogleDriveProjectFiles(): Promise<ProjectWorkspace['files'] | null> {
    const pickerConfig = await connectionService.googleDrivePickerConfig()
    const selections = await pickGoogleDriveFiles(pickerConfig)
    if (!selections?.length) return null
    if (selections.length > 50) throw new Error('한 번에 최대 50개 파일까지 가져올 수 있습니다.')
    const files: ProjectWorkspace['files'] = []
    for (const selection of selections) {
      const driveFile = await connectionService.importGoogleDriveFile(selection.id)
      const path = uniqueProjectPath(driveFile.file_path, files, 'file')
      files.push({ path, content: driveFile.content })
    }
    const totalBytes = new Blob(files.map((file) => file.content)).size
    if (totalBytes > 1_000_000) throw new Error('가져온 파일의 전체 크기는 1MB 이하여야 합니다. 파일 수를 줄여 다시 선택해 주세요.')
    return files
  }

  async function handleImportGoogleDriveFile() {
    setProjectBusy(true)
    setProjectError('')
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    try {
      const files = await selectGoogleDriveProjectFiles()
      if (!files?.length) return
      const baseName = files[0]!.path.split('/').pop()!.replace(/\.[^.]+$/, '').trim() || 'Drive 프로젝트'
      const projectName = files.length > 1 ? `${baseName} 외 ${files.length - 1}개 파일` : baseName
      const imported = await projectService.importFiles(projectName.slice(0, 120), files)
      setProjectMembers(await projectService.listMembers(imported.id))
      setProjectTasks([])
      setWorkspace(imported)
      setProjectVersions([])
      setVersionPreview(null)
      resetProjectFiles(imported.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectNotice(`Google Drive에서 ${files.length}개 파일을 새 프로젝트로 가져왔어요.`)
      setProjects((current) => [{
        id: imported.id,
        name: imported.name,
        description: imported.description,
        draft_version: imported.draft_version,
        updated_at: imported.updated_at,
        role: imported.role,
      }, ...current])
      setView('workspace')
      setProjectListPanel(null)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'Google Drive 파일을 가져오지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function createDriveDataImportProject() {
    if (projectBusy) return
    setProjectBusy(true)
    setProjectError('')
    setLocalProjectDirectory(null)
    setPendingProjectDirectory(null)
    try {
      const selectedFiles = await selectGoogleDriveProjectFiles()
      if (!selectedFiles?.length) return
      if (selectedFiles.length > 49) throw new Error('프로젝트에 main.py를 함께 만들기 위해 CSV·JSON 파일은 최대 49개까지 선택해 주세요.')
      const unsupported = selectedFiles.filter((file) => !/\.(csv|json)$/i.test(file.path))
      if (unsupported.length) throw new Error('DB 가져오기 프로젝트에는 CSV 또는 JSON 파일만 선택해 주세요.')

      const usedTables = new Set<string>()
      const importStatements = selectedFiles.map((file) => {
        const sourceName = file.path.split('/').pop() ?? 'data'
        const rawTable = sourceName.replace(/\.(csv|json)$/i, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
        const baseTable = /^[a-z]/.test(rawTable) ? rawTable.slice(0, 63) : `data_${rawTable || 'import'}`.slice(0, 63)
        let tableName = baseTable
        let suffix = 2
        while (usedTables.has(tableName)) {
          const ending = `_${suffix++}`
          tableName = `${baseTable.slice(0, 63 - ending.length)}${ending}`
        }
        usedTables.add(tableName)
        const importer = file.path.toLowerCase().endsWith('.csv') ? 'import_csv_to_sqlite' : 'import_json_to_sqlite'
        return `        result = ${importer}(database, ${JSON.stringify(file.path)}, ${JSON.stringify(tableName)})\n        print(f"{result['table_name']}: {result['row_count']}개 행, {len(result['columns'])}개 열")`
      })
      const source = [
        'import sqlite3',
        'from weblink_api import import_csv_to_sqlite, import_json_to_sqlite',
        '',
        '# 파일을 다시 가져오면 연결된 테이블의 기존 행은 파일 내용으로 교체됩니다.',
        'DATABASE_PATH = "/data/imported_data.db"',
        '',
        'try:',
        '    with sqlite3.connect(DATABASE_PATH) as database:',
        ...importStatements,
        'except Exception as error:',
        '    print(f"가져오기에 실패해 이번 변경을 저장하지 않았습니다: {error}")',
        '    raise',
        '',
        'print(f"\\n데이터베이스 저장 위치: {DATABASE_PATH}")',
      ].join('\n')
      const files: ProjectWorkspace['files'] = [
        ...selectedFiles,
        { path: 'main.py', content: `${source}\n` },
      ]
      const firstName = selectedFiles[0]!.path.split('/').pop()!.replace(/\.(csv|json)$/i, '').trim() || 'Drive'
      const projectName = `${firstName}${selectedFiles.length > 1 ? ` 외 ${selectedFiles.length - 1}개` : ''} 데이터 DB`
      const imported = await projectService.importFiles(projectName.slice(0, 120), files)
      const members = await projectService.listMembers(imported.id)
      setProjectMembers(members)
      setProjectTasks([])
      setProjectTeamActivity([])
      setWorkspace(imported)
      setProjects((current) => [{
        id: imported.id,
        name: imported.name,
        description: imported.description,
        draft_version: imported.draft_version,
        updated_at: imported.updated_at,
        role: imported.role,
      }, ...current.filter((item) => item.id !== imported.id)])
      setProjectVersions([])
      setVersionPreview(null)
      resetProjectFiles('main.py')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectAccessLost(false)
      setProjectListPanel(null)
      setView('workspace')
      setProjectNotice('CSV·JSON을 프로젝트 SQLite DB에 가져오는 코드를 만들었어요. 실행하면 /data/imported_data.db에 저장되고, 다시 실행하면 같은 테이블의 행은 파일 내용으로 교체됩니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'Drive 데이터 프로젝트를 만들지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function addGoogleDriveFilesToProject() {
    if (!workspace || isProjectReadOnly) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const importedFiles = await selectGoogleDriveProjectFiles()
      if (!importedFiles?.length) return
      const mergedFiles = [...workspace.files]
      const uniqueFiles: ProjectWorkspace['files'] = []
      for (const file of importedFiles) {
        const nextFile = { ...file, path: uniqueProjectPath(file.path, mergedFiles, 'file') }
        mergedFiles.push(nextFile)
        uniqueFiles.push(nextFile)
      }
      if (mergedFiles.length > 50) throw new Error('프로젝트 파일은 폴더 표시 파일을 포함해 50개까지 저장할 수 있습니다.')
      const totalBytes = new Blob(mergedFiles.map((file) => file.content)).size
      if (totalBytes > 1_000_000) throw new Error('가져온 뒤 프로젝트 파일 전체가 1MB를 넘습니다. 기존 파일이나 가져올 파일 수를 줄여 주세요.')
      setWorkspace({ ...workspace, files: mergedFiles.sort((left, right) => left.path.localeCompare(right.path)) })
      openProjectFile(uniqueFiles[0]!.path)
      setProjectDirty(true)
      setProjectNotice(`${uniqueFiles.length}개 Drive 파일을 프로젝트에 추가했습니다. 초안을 저장하면 적용됩니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'Drive 파일을 프로젝트에 추가하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function openProject(projectId: string) {
    setProjectBusy(true)
    setProjectError('')
    setProjectNotice('')
    setProjectMembers([])
    setOnlineProjectMemberIds([])
    setProjectEventsConnected(false)
    setProjectTeamActivity([])
    setGithubSource(null)
    setProjectTasks([])
    setProjectAccessLost(false)
    setEditingProjectDetails(false)
    try {
      const [loaded, versions, directory, members, tasks] = await Promise.all([
        projectService.get(projectId),
        projectService.listVersions(projectId),
        getProjectDirectory(projectId).catch(() => null),
        projectService.listMembers(projectId),
        projectService.listTasks(projectId),
      ])
      setProjectMembers(members)
      setProjectTasks(tasks)
      setWorkspace(loaded)
      setLocalProjectDirectory(directory)
      setPendingProjectDirectory(null)
      setProjectVersions(versions)
      setVersionPreview(null)
      resetProjectFiles(loaded.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setView('workspace')
      void projectService.githubSource(projectId).then((source) => { if (workspaceRef.current?.id === projectId) setGithubSource(source) }).catch(() => undefined)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트를 열지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  function updateProjectFile(content: string) {
    if (!workspace) return
    if (isProjectReadOnly) {
      setProjectError('이 프로젝트는 보기 전용 권한이라 수정할 수 없습니다.')
      return
    }
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
        setProjectMembers([])
        setProjectTasks([])
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

  async function openOrCreateProjectReadme() {
    if (!workspace) return
    if (projectReadmeFile) {
      openProjectFile(projectReadmeFile.path)
      setWorkspaceSection('code')
      return
    }
    if (isProjectReadOnly || projectBusy) return
    if (workspace.files.length >= 50) {
      setProjectError('프로젝트 파일은 50개까지만 추가할 수 있어 README.md를 만들지 못했습니다.')
      return
    }
    const projectFiles = workspace.files
      .filter((file) => !file.path.toLocaleLowerCase().startsWith('.env') && file.path !== '.gitkeep')
      .map((file) => `- \`${file.path}\``)
    const content = `# ${workspace.name}\n\n${workspace.description || '이 프로젝트가 해결하려는 문제와 주요 기능을 소개해 주세요.'}\n\n## 시작하기\n\n프로젝트 파일을 확인한 뒤 WebLink에서 코드를 실행해 보세요.\n\n## 파일 구성\n\n${projectFiles.length ? projectFiles.join('\n') : '- 아직 프로젝트 파일이 없습니다.'}\n\n## 진행 상황\n\n작업 보드에서 할 일과 팀원별 진행 상황을 정리합니다.\n`
    setProjectBusy(true)
    setProjectError('')
    try {
      if (localProjectDirectory) await writeProjectDirectory(localProjectDirectory, [{ path: 'README.md', content }])
      const files = [...workspace.files, { path: 'README.md', content }].sort((left, right) => left.path.localeCompare(right.path))
      setWorkspace({ ...workspace, files })
      openProjectFile('README.md')
      setProjectDirty(true)
      setWorkspaceSection('code')
      setProjectNotice('README.md 초안을 만들었습니다. 내용을 확인하고 초안 저장을 눌러 주세요.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'README.md를 만들지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function importDroppedFiles(droppedItems: DataTransferItem[], folderPath: string) {
    if (!workspace || !droppedItems.length) return
    const folderMarker = folderPath ? `${folderPath}/.gitkeep` : ''
    const existingFiles = workspace.files.filter((file) => !folderMarker || file.path !== folderMarker)
    setProjectBusy(true)
    setProjectError('')
    try {
      const dropped = await readDroppedProjectItems(droppedItems)
      const addedFiles: ProjectWorkspace['files'] = []
      const sourceFolders = new Set(dropped.emptyFolders)
      for (const sourceFolder of dropped.emptyFolders) {
        const segments = sourceFolder.split('/')
        for (let index = 1; index < segments.length; index += 1) sourceFolders.add(segments.slice(0, index).join('/'))
      }
      for (const file of dropped.files) {
        const segments = file.path.split('/')
        for (let index = 1; index < segments.length; index += 1) sourceFolders.add(segments.slice(0, index).join('/'))
      }
      const folderMap = new Map<string, string>()
      const reservedFolders: ProjectWorkspace['files'] = []
      for (const sourceFolder of [...sourceFolders].sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))) {
        const segments = sourceFolder.split('/')
        const parentSource = segments.slice(0, -1).join('/')
        const parentTarget = parentSource ? folderMap.get(parentSource) : folderPath
        const segmentName = segments[segments.length - 1]!
        const requestedFolder = parentTarget ? `${parentTarget}/${segmentName}` : segmentName
        const targetFolder = uniqueProjectPath(requestedFolder, [...existingFiles, ...addedFiles, ...reservedFolders], 'folder')
        folderMap.set(sourceFolder, targetFolder)
        reservedFolders.push({ path: `${targetFolder}/.gitkeep`, content: '' })
      }
      for (const file of dropped.files) {
        const segments = file.path.split('/')
        const sourceParent = segments.slice(0, -1).join('/')
        const targetParent = sourceParent ? folderMap.get(sourceParent) : folderPath
        const filename = segments[segments.length - 1]!
        const requestedPath = targetParent ? `${targetParent}/${filename}` : filename
        const targetPath = uniqueProjectPath(requestedPath, [...existingFiles, ...addedFiles, ...reservedFolders], 'file')
        addedFiles.push({ path: targetPath, content: file.content })
      }
      const emptyFolderMarkers = dropped.emptyFolders.map((sourceFolder) => ({ path: `${folderMap.get(sourceFolder)!}/.gitkeep`, content: '' }))
      addedFiles.push(...emptyFolderMarkers)
      if (existingFiles.length + addedFiles.length > 50) throw new Error('프로젝트 파일과 빈 폴더는 합쳐 최대 50개까지만 넣을 수 있어요.')
      const incomingBytes = dropped.files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).byteLength, 0)
      const currentBytes = existingFiles.reduce((sum, file) => sum + new TextEncoder().encode(file.content).byteLength, 0)
      if (currentBytes + incomingBytes > 1_000_000) throw new Error('프로젝트 파일 전체 용량은 1MB까지 지원합니다.')
      if (localProjectDirectory) {
        await writeProjectDirectory(localProjectDirectory, addedFiles)
        if (folderMarker && workspace.files.some((file) => file.path === folderMarker)) {
          await removeProjectFileFromDirectory(localProjectDirectory, folderMarker).catch(() => undefined)
        }
      }
      setWorkspace({ ...workspace, files: [...existingFiles, ...addedFiles].sort((left, right) => left.path.localeCompare(right.path)) })
      const firstFile = addedFiles.find((file) => !file.path.endsWith('/.gitkeep'))
      if (firstFile) openProjectFile(firstFile.path)
      setProjectDirty(true)
      const skippedNotice = dropped.skippedSensitiveFiles ? ` 비밀 파일 ${dropped.skippedSensitiveFiles}개는 제외했어요.` : ''
      setProjectNotice(`${dropped.files.length}개 파일과 빈 폴더 ${dropped.emptyFolders.length}개를 ${folderPath ? `‘${folderPath}’ 폴더` : '프로젝트 루트'}에 추가했습니다.${skippedNotice} 저장하면 WebLink 초안에도 적용됩니다.`)
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

  async function deleteProjectFolder(folderPath: string) {
    if (!workspace) return
    const prefix = `${folderPath}/`
    const removedFiles = workspace.files.filter((file) => file.path.startsWith(prefix))
    if (!removedFiles.length) return
    const warning = localProjectDirectory
      ? `‘${folderPath}’ 폴더와 안의 프로젝트 파일 ${removedFiles.length}개를 WebLink 초안 및 연결된 컴퓨터 폴더에서 삭제할까요? 폴더 안의 WebLink가 관리하지 않는 파일은 보존됩니다.`
      : `‘${folderPath}’ 폴더와 안의 프로젝트 파일 ${removedFiles.length}개를 WebLink 초안에서 삭제할까요?`
    if (!window.confirm(warning)) return
    setProjectBusy(true)
    setProjectError('')
    try {
      if (localProjectDirectory) {
        for (const file of removedFiles) await removeProjectFileFromDirectory(localProjectDirectory, file.path)
        const directories = new Set([folderPath])
        for (const file of removedFiles) {
          const segments = file.path.split('/')
          while (segments.length > 1) {
            segments.pop()
            const parentPath = segments.join('/')
            if (parentPath === folderPath || parentPath.startsWith(prefix)) directories.add(parentPath)
          }
        }
        for (const path of [...directories].sort((left, right) => right.split('/').length - left.split('/').length)) {
          await removeEmptyProjectDirectoryFromDirectory(localProjectDirectory, path)
        }
      }
      const removedPaths = new Set(removedFiles.map((file) => file.path))
      const files = workspace.files.filter((file) => !removedPaths.has(file.path))
      const tabs = openFilePaths.filter((path) => !removedPaths.has(path))
      const nextTabs = tabs.length ? tabs : files[0] ? [files[0].path] : []
      setWorkspace({ ...workspace, files })
      setOpenFilePaths(nextTabs)
      setSelectedPath((current) => removedPaths.has(current) ? nextTabs[0] ?? '' : current)
      setProjectDirty(true)
      setProjectNotice(`‘${folderPath}’ 폴더의 프로젝트 파일 ${removedFiles.length}개를 삭제했습니다. 초안을 저장하면 WebLink에도 적용됩니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '폴더를 삭제하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function renameProjectFolder(oldPath: string) {
    if (!workspace) return
    const entered = window.prompt('새 폴더 경로를 입력하세요.', oldPath)
    if (entered === null) return
    const requestedPath = entered.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
    if (!requestedPath || requestedPath.length > 230 || requestedPath.startsWith('/') || requestedPath.includes('\0')
      || requestedPath.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
      setProjectError('폴더 경로는 230자 이내의 안전한 상대 경로여야 합니다.')
      return
    }
    const oldPrefix = `${oldPath}/`
    if (requestedPath === oldPath || requestedPath.toLocaleLowerCase() === oldPath.toLocaleLowerCase()) return
    if (requestedPath.toLocaleLowerCase().startsWith(oldPrefix.toLocaleLowerCase())) {
      setProjectError('폴더를 자기 자신 안으로 옮길 수 없습니다.')
      return
    }
    const folderFiles = workspace.files.filter((file) => file.path.startsWith(oldPrefix))
    if (!folderFiles.length) return
    let newPath: string
    try {
      newPath = uniqueProjectPath(requestedPath, workspace.files.filter((file) => !file.path.startsWith(oldPrefix)), 'folder')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '폴더 이름을 정하지 못했습니다.')
      return
    }
    const newPrefix = `${newPath}/`
    const renamedFiles = folderFiles.map((file) => ({ ...file, path: `${newPrefix}${file.path.slice(oldPrefix.length)}` }))
    if (renamedFiles.some((file) => file.path.length > 240)) {
      setProjectError('폴더 안 파일 경로가 240자를 넘어 이름을 바꾸지 못했습니다.')
      return
    }
    setProjectBusy(true)
    setProjectError('')
    try {
      if (localProjectDirectory) {
        await moveProjectFilesInDirectory(localProjectDirectory, folderFiles.map((file, index) => ({
          oldPath: file.path,
          newPath: renamedFiles[index]!.path,
          content: file.content,
        })))
        const oldDirectories = new Set([oldPath])
        for (const file of folderFiles) {
          const segments = file.path.split('/')
          while (segments.length > 1) {
            segments.pop()
            const parentPath = segments.join('/')
            if (parentPath === oldPath || parentPath.startsWith(oldPrefix)) oldDirectories.add(parentPath)
          }
        }
        for (const path of [...oldDirectories].sort((left, right) => right.split('/').length - left.split('/').length)) {
          await removeEmptyProjectDirectoryFromDirectory(localProjectDirectory, path)
        }
      }
      const renamedByPath = new Map<string, ProjectWorkspace['files'][number]>()
      folderFiles.forEach((file, index) => renamedByPath.set(file.path, renamedFiles[index]!))
      const files = workspace.files
        .filter((file) => !file.path.startsWith(oldPrefix))
        .concat(folderFiles.map((file) => renamedByPath.get(file.path)!))
        .sort((left, right) => left.path.localeCompare(right.path))
      const renamePath = (path: string) => path.startsWith(oldPrefix) ? `${newPrefix}${path.slice(oldPrefix.length)}` : path
      setWorkspace({ ...workspace, files })
      setSelectedPath((current) => renamePath(current))
      setOpenFilePaths((current) => current.map(renamePath))
      setProjectDirty(true)
      setProjectNotice(newPath === requestedPath
        ? localProjectDirectory
          ? `‘${oldPath}’ 폴더 이름을 ‘${newPath}’(으)로 바꾸고 연결된 컴퓨터 폴더에도 반영했습니다. 초안을 저장하면 WebLink에도 적용됩니다.`
          : `‘${oldPath}’ 폴더를 ‘${newPath}’(으)로 바꿨습니다. 초안을 저장하면 WebLink에도 적용됩니다.`
        : `같은 이름이 있어 ‘${newPath}’ 폴더로 변경했습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '폴더 이름을 바꾸지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function addProjectMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace || !canManageProject || !memberEmail.trim()) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const member = await projectService.addMember(workspace.id, memberEmail, memberRole)
      setProjectMembers((current) => [...current, member].sort((left, right) => left.created_at.localeCompare(right.created_at)))
      setMemberEmail('')
      setProjectNotice(`${member.display_name}님을 ${member.role === 'EDITOR' ? '편집자' : '보기 전용'}로 추가했습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '팀원을 추가하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function createProjectInviteLink(email = memberEmail, role = memberRole) {
    if (!workspace || !canManageProject || !email.trim()) return
    setProjectBusy(true)
    setProjectError('')
    setProjectInviteLink('')
    try {
      const invitation = await projectService.createInvitation(workspace.id, email, role)
      setProjectInvitations(await projectService.listInvitations(workspace.id))
      const link = new URL(window.location.href)
      link.search = ''
      link.hash = ''
      link.searchParams.set('project_invite', invitation.token)
      setProjectInviteLink(link.toString())
      setProjectNotice(invitation.email_status === 'sent'
        ? `${invitation.email}님에게 초대 이메일을 보냈습니다. 링크는 7일 동안 유효합니다.`
        : invitation.email_status === 'failed'
          ? `초대 링크는 만들었지만 이메일 전송에 실패했습니다. 링크를 복사해 ${invitation.email}님에게 전달해 주세요.`
          : `초대 링크를 만들었습니다. 메일 전송 설정이 없어 링크를 복사해 ${invitation.email}님에게 전달해 주세요.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '초대 링크를 만들지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function revokeProjectInvitation(invitation: ManagedProjectInvitation) {
    if (!workspace || !canManageProject) return
    const isExpired = invitation.status === 'EXPIRED'
    const confirmation = isExpired
      ? `${invitation.email}님의 만료된 초대 기록을 목록에서 삭제할까요?`
      : `${invitation.email}님에게 전달한 초대 링크를 취소할까요? 취소 후에는 링크를 사용할 수 없습니다.`
    if (!window.confirm(confirmation)) return
    setProjectBusy(true)
    setProjectError('')
    try {
      await projectService.revokeInvitation(workspace.id, invitation.id)
      setProjectInvitations((current) => current.filter((item) => item.id !== invitation.id))
      setProjectNotice(isExpired ? `${invitation.email}님의 만료 기록을 삭제했습니다.` : `${invitation.email} 초대를 취소했습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '초대를 취소하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function acceptProjectInvite() {
    if (!projectInviteToken || !user) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const accepted = await projectService.acceptInvitation(projectInviteToken)
      setProjectInviteToken('')
      window.sessionStorage.removeItem('weblink.project-invite')
      const url = new URL(window.location.href)
      url.searchParams.delete('project_invite')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
      await showProjects()
      await openProject(accepted.project_id)
      setProjectNotice(`‘${accepted.project_name}’ 프로젝트 초대를 수락했습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '초대를 수락하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function removeProjectMember(member: ProjectMember) {
    if (!workspace || !canManageProject || member.role === 'OWNER') return
    if (!window.confirm(`${member.display_name} (${member.email})님을 프로젝트에서 제외할까요?`)) return
    setProjectBusy(true)
    setProjectError('')
    try {
      await projectService.removeMember(workspace.id, member.user_id)
      setProjectMembers((current) => current.filter((item) => item.user_id !== member.user_id))
      setProjectNotice(`${member.display_name}님을 프로젝트에서 제외했습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '팀원을 제외하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function changeProjectMemberRole(member: ProjectMember, role: 'EDITOR' | 'VIEWER') {
    if (!workspace || !canManageProject || member.role === 'OWNER' || member.role === role) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const updated = await projectService.updateMemberRole(workspace.id, member.user_id, role)
      setProjectMembers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item))
      setProjectNotice(`${updated.display_name}님의 권한을 ${role === 'EDITOR' ? '편집자' : '보기 전용'}으로 바꿨습니다.`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '팀원 권한을 바꾸지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function createProjectTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace || isProjectReadOnly || !taskTitle.trim()) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const task = await projectService.createTask(workspace.id, {
        title: taskTitle,
        description: taskDescription,
        assignee_id: taskAssigneeId || null,
        priority: taskPriority,
        due_date: taskDueDate || null,
      })
      setProjectTasks((current) => [task, ...current])
      setTaskTitle('')
      setTaskDescription('')
      setTaskAssigneeId('')
      setTaskPriority('NORMAL')
      setTaskDueDate('')
      setProjectNotice('작업을 추가했습니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '작업을 추가하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function updateProjectTask(task: ProjectTask, changes: Partial<Pick<ProjectTask, 'title' | 'description' | 'status' | 'assignee_id' | 'priority' | 'due_date'>>) {
    if (!workspace || isProjectReadOnly) return false
    setProjectBusy(true)
    setProjectError('')
    try {
      const updated = await projectService.updateTask(workspace.id, task, changes)
      setProjectTasks((current) => current.map((item) => item.id === updated.id ? updated : item))
      return true
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '작업을 수정하지 못했습니다.')
      return false
    } finally {
      setProjectBusy(false)
    }
  }

  function beginTaskEdit(task: ProjectTask) {
    if (isProjectReadOnly) return
    setEditingTaskId(task.id)
    setEditingTaskTitle(task.title)
    setEditingTaskDescription(task.description)
    setEditingTaskPriority(task.priority)
    setEditingTaskDueDate(task.due_date ?? '')
    setProjectError('')
  }

  async function saveTaskEdit(task: ProjectTask, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingTaskTitle.trim()) {
      setProjectError('작업 이름은 비워 둘 수 없습니다.')
      return
    }
    const saved = await updateProjectTask(task, {
      title: editingTaskTitle,
      description: editingTaskDescription,
      priority: editingTaskPriority,
      due_date: editingTaskDueDate || null,
    })
    if (saved) setEditingTaskId(null)
  }

  async function deleteProjectTask(task: ProjectTask) {
    if (!workspace || isProjectReadOnly || !window.confirm(`‘${task.title}’ 작업을 삭제할까요?`)) return
    setProjectBusy(true)
    setProjectError('')
    try {
      await projectService.deleteTask(workspace.id, task.id)
      setProjectTasks((current) => current.filter((item) => item.id !== task.id))
      if (openTaskDiscussionId === task.id) setOpenTaskDiscussionId(null)
      setTaskDiscussions((current) => {
        const next = { ...current }
        delete next[task.id]
        return next
      })
      setTaskChecklists((current) => {
        const next = { ...current }
        delete next[task.id]
        return next
      })
      setProjectNotice('작업을 삭제했습니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '작업을 삭제하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function submitTaskComment(task: ProjectTask, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const commentDraft = taskCommentDrafts[task.id] ?? ''
    if (!workspace || isProjectReadOnly || !commentDraft.trim()) return
    setTaskCommentBusy(true)
    setProjectError('')
    try {
      await projectService.addTaskComment(workspace.id, task.id, commentDraft)
      setTaskCommentDrafts((current) => ({ ...current, [task.id]: '' }))
      const [discussion, checklist] = await Promise.all([
        projectService.getTaskDiscussion(workspace.id, task.id),
        projectService.listTaskChecklist(workspace.id, task.id),
      ])
      setTaskDiscussions((current) => ({ ...current, [task.id]: discussion }))
      setTaskChecklists((current) => ({ ...current, [task.id]: checklist }))
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '댓글을 등록하지 못했습니다.')
    } finally {
      setTaskCommentBusy(false)
    }
  }

  async function refreshTaskChecklist(task: ProjectTask) {
    if (!workspace) return
    const checklist = await projectService.listTaskChecklist(workspace.id, task.id)
    setTaskChecklists((current) => ({ ...current, [task.id]: checklist }))
  }

  async function addTaskChecklistItem(task: ProjectTask, event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = taskChecklistDrafts[task.id]?.trim() ?? ''
    if (!workspace || isProjectReadOnly || !text) return
    setTaskChecklistBusyId(task.id)
    setProjectError('')
    try {
      await projectService.addTaskChecklistItem(workspace.id, task.id, text)
      setTaskChecklistDrafts((current) => ({ ...current, [task.id]: '' }))
      await refreshTaskChecklist(task)
      setProjectNotice('체크 항목을 추가했습니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '체크 항목을 추가하지 못했습니다.')
    } finally {
      setTaskChecklistBusyId(null)
    }
  }

  async function toggleTaskChecklistItem(task: ProjectTask, item: TaskChecklistItem) {
    if (!workspace || isProjectReadOnly) return
    setTaskChecklistBusyId(item.id)
    setProjectError('')
    try {
      await projectService.updateTaskChecklistItem(workspace.id, task.id, item.id, !item.completed)
      await refreshTaskChecklist(task)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '체크 항목 상태를 바꾸지 못했습니다.')
    } finally {
      setTaskChecklistBusyId(null)
    }
  }

  async function deleteTaskChecklistItem(task: ProjectTask, item: TaskChecklistItem) {
    if (!workspace || isProjectReadOnly) return
    setTaskChecklistBusyId(item.id)
    setProjectError('')
    try {
      await projectService.deleteTaskChecklistItem(workspace.id, task.id, item.id)
      await refreshTaskChecklist(task)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '체크 항목을 삭제하지 못했습니다.')
    } finally {
      setTaskChecklistBusyId(null)
    }
  }

  function markTaskActivityRead() {
    const seenNow = [...new Set([...seenTaskActivityIds, ...projectTaskActivity.map((item) => item.id)])].slice(-200)
    setSeenTaskActivityIds(seenNow)
    if (workspace && user) {
      try { window.localStorage.setItem(`weblink.task-activity-seen:${user.id}:${workspace.id}`, JSON.stringify(seenNow)) } catch { /* Browser storage may be unavailable. */ }
    }
  }

  function toggleTaskActivityInbox() {
    const nextOpen = !taskActivityOpen
    setTaskActivityOpen(nextOpen)
    if (nextOpen) markTaskActivityRead()
  }

  async function openTaskInBoard(taskId: string) {
    if (!workspace) return
    setWorkspaceSection('tasks')
    markTaskActivityRead()
    setTaskSearch('')
    setTaskAssigneeFilter('ALL')
    setTaskPriorityFilter('ALL')
    setTaskDeadlineFilter('ALL')
    setTaskActivityOpen(false)
    setOpenTaskDiscussionId(taskId)
    try {
      const [discussion, checklist] = await Promise.all([
        projectService.getTaskDiscussion(workspace.id, taskId),
        projectService.listTaskChecklist(workspace.id, taskId),
      ])
      setTaskDiscussions((current) => ({ ...current, [taskId]: discussion }))
      setTaskChecklists((current) => ({ ...current, [taskId]: checklist }))
      window.setTimeout(() => document.getElementById(`project-task-${taskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '작업 기록을 불러오지 못했습니다.')
    }
  }

  async function openTaskFromActivity(activity: ProjectTaskActivity) {
    await openTaskInBoard(activity.task_id)
  }

  async function toggleTaskDiscussion(task: ProjectTask) {
    if (openTaskDiscussionId === task.id) {
      setOpenTaskDiscussionId(null)
      return
    }
    setOpenTaskDiscussionId(task.id)
    if (!workspace) return
    try {
      const [discussion, checklist] = await Promise.all([
        projectService.getTaskDiscussion(workspace.id, task.id),
        projectService.listTaskChecklist(workspace.id, task.id),
      ])
      setTaskDiscussions((current) => ({ ...current, [task.id]: discussion }))
      setTaskChecklists((current) => ({ ...current, [task.id]: checklist }))
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '작업 기록을 불러오지 못했습니다.')
    }
  }

  function beginProjectDetailsEdit() {
    if (!workspace || !canManageProject || projectBusy || projectDirty) return
    setProjectNameDraft(workspace.name)
    setProjectDescriptionDraft(workspace.description)
    setEditingProjectDetails(true)
    setProjectError('')
  }

  async function saveProjectDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace || !canManageProject || projectDirty || !projectNameDraft.trim()) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const updated = await projectService.update(workspace.id, {
        name: projectNameDraft,
        description: projectDescriptionDraft,
      })
      setWorkspace(updated)
      setProjects((current) => current.map((item) => item.id === updated.id
        ? { ...item, name: updated.name, description: updated.description, updated_at: updated.updated_at }
        : item))
      setEditingProjectDetails(false)
      setProjectNotice('프로젝트 이름과 설명을 저장했습니다.')
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : '프로젝트 정보를 저장하지 못했습니다.')
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
    void reloadWorkspace(true)
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

  async function refreshGitHubSource() {
    if (!workspace || !githubSource?.connected) return
    setProjectBusy(true)
    setProjectError('')
    try {
      setGithubSource(await projectService.githubSource(workspace.id))
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'GitHub 변경을 확인하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function pullGitHubSourceUpdates() {
    if (!workspace || !githubSource?.connected || projectDirty || projectNeedsReload || isProjectReadOnly) return
    const repositoryLabel = githubSource.repository_url?.replace('https://github.com/', '') ?? 'GitHub 저장소'
    if (!window.confirm(`${repositoryLabel}의 ${githubSource.branch ?? '기본 브랜치'} 파일로 현재 WebLink 초안을 교체할까요? 바꾸기 전에 현재 초안을 저장 버전으로 백업합니다. 연결된 컴퓨터 폴더는 자동으로 수정하지 않습니다.`)) return
    setProjectBusy(true)
    setProjectError('')
    try {
      const result = await projectService.pullGithubUpdates(workspace.id, workspace.draft_version)
      const nextWorkspace = result.workspace
      setWorkspace(nextWorkspace)
      setProjects((items) => items.map((item) => item.id === nextWorkspace.id
        ? { ...item, draft_version: nextWorkspace.draft_version, updated_at: nextWorkspace.updated_at }
        : item))
      setProjectVersions(await projectService.listVersions(nextWorkspace.id))
      const availablePaths = new Set(nextWorkspace.files.map((file) => file.path))
      setOpenFilePaths((paths) => {
        const retained = paths.filter((path) => availablePaths.has(path))
        return retained.length ? retained : nextWorkspace.files[0] ? [nextWorkspace.files[0].path] : []
      })
      setSelectedPath((path) => availablePaths.has(path) ? path : nextWorkspace.files[0]?.path ?? '')
      setGithubSource((current) => current ? { ...current, imported_sha: result.imported_sha, latest_sha: result.imported_sha, update_available: false } : current)
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setProjectError('')
      setProjectNotice(result.backup_version_name
        ? `GitHub 변경을 초안 v${nextWorkspace.draft_version}에 반영했습니다. 이전 내용은 ‘${result.backup_version_name}’ 저장 버전에서 복원할 수 있어요.${localProjectDirectory ? ' 연결된 컴퓨터 폴더에는 자동 반영되지 않았습니다.' : ''}`
        : `GitHub 저장소와 파일이 같아 최신 커밋만 확인했습니다.${localProjectDirectory ? ' 연결된 컴퓨터 폴더는 별도로 갱신해야 합니다.' : ''}`)
    } catch (cause) {
      setProjectError(cause instanceof Error ? cause.message : 'GitHub 변경을 반영하지 못했습니다.')
    } finally {
      setProjectBusy(false)
    }
  }

  async function reloadWorkspace(skipDiscardConfirmation = false) {
    if (!workspace) return
    if (projectDirty && !skipDiscardConfirmation
      && !window.confirm('저장되지 않은 내 수정 내용을 버리고 팀원이 저장한 최신 초안을 불러올까요? 필요한 코드는 먼저 복사해 보관하세요.')) return
    setProjectBusy(true)
    try {
      const [loaded, versions] = await Promise.all([projectService.get(workspace.id), projectService.listVersions(workspace.id)])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setVersionPreview(null)
      const availablePaths = new Set(loaded.files.map((file) => file.path))
      setOpenFilePaths((currentPaths) => {
        const retained = currentPaths.filter((path) => availablePaths.has(path))
        return retained.length ? retained : loaded.files[0] ? [loaded.files[0].path] : []
      })
      setSelectedPath((currentPath) => availablePaths.has(currentPath) ? currentPath : loaded.files[0]?.path ?? '')
      setProjectDirty(false)
      setProjectNeedsReload(false)
      setRunResult(null)
      setDebugSaved(false)
      setDebugHint(null)
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
      const restored = await projectService.restoreVersion(current.id, versionId, current.draft_version)
      const [loaded, versions] = await Promise.all([projectService.get(current.id), projectService.listVersions(current.id)])
      setWorkspace(loaded)
      setProjectVersions(versions)
      setVersionPreview(null)
      const availablePaths = new Set(loaded.files.map((file) => file.path))
      setOpenFilePaths((currentPaths) => {
        const retained = currentPaths.filter((path) => availablePaths.has(path))
        return retained.length ? retained : loaded.files[0] ? [loaded.files[0].path] : []
      })
      setSelectedPath((currentPath) => availablePaths.has(currentPath) ? currentPath : loaded.files[0]?.path ?? '')
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
    setWorkspaceSection('code')
    if (isProjectReadOnly) {
      setProjectError('보기 전용 권한으로는 프로젝트를 실행할 수 없습니다.')
      return
    }
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

  const todayForTasks = localToday()
  const nextWeek = new Date()
  nextWeek.setDate(nextWeek.getDate() + 7)
  nextWeek.setMinutes(nextWeek.getMinutes() - nextWeek.getTimezoneOffset())
  const weekCutoffForTasks = nextWeek.toISOString().slice(0, 10)
  const normalizedTaskSearch = taskSearch.trim().toLocaleLowerCase()
  const filteredProjectTasks = projectTasks.filter((task) => {
    const assignee = projectMembers.find((member) => member.user_id === task.assignee_id)
    const searchMatches = !normalizedTaskSearch
      || `${task.title} ${task.description} ${assignee?.display_name ?? ''} ${assignee?.email ?? ''}`.toLocaleLowerCase().includes(normalizedTaskSearch)
    const assigneeMatches = taskAssigneeFilter === 'ALL'
      || (taskAssigneeFilter === 'MINE' && task.assignee_id === user?.id)
      || (taskAssigneeFilter === 'UNASSIGNED' && task.assignee_id === null)
      || task.assignee_id === taskAssigneeFilter
    const priorityMatches = taskPriorityFilter === 'ALL' || task.priority === taskPriorityFilter
    const dueMatches = taskDeadlineFilter === 'ALL'
      || (taskDeadlineFilter === 'OVERDUE' && task.status !== 'DONE' && !!task.due_date && task.due_date < todayForTasks)
      || (taskDeadlineFilter === 'TODAY' && task.due_date === todayForTasks)
      || (taskDeadlineFilter === 'WEEK' && !!task.due_date && task.due_date > todayForTasks && task.due_date <= weekCutoffForTasks)
      || (taskDeadlineFilter === 'NO_DATE' && !task.due_date)
    return searchMatches && assigneeMatches && priorityMatches && dueMatches
  })
  const completedTaskCount = projectTasks.filter((task) => task.status === 'DONE').length
  const overdueTaskCount = projectTasks.filter((task) => task.status !== 'DONE' && !!task.due_date && task.due_date < todayForTasks).length
  const taskCompletionPercent = projectTasks.length ? Math.round(completedTaskCount / projectTasks.length * 100) : 0
  const dashboardDueTasks = projectTasks
    .filter((task) => task.status !== 'DONE' && task.due_date)
    .sort((left, right) => (left.due_date ?? '').localeCompare(right.due_date ?? ''))
    .slice(0, 4)
  const projectSetupSteps = [
    { id: 'intro', icon: '✎', title: '프로젝트 소개 작성', detail: '팀원이 목표와 방향을 이해하도록 설명을 적어요.', done: Boolean(workspace?.description.trim()), action: () => beginProjectDetailsEdit() },
    { id: 'readme', icon: '▤', title: 'README 준비', detail: '실행 방법과 파일 구조를 문서로 남겨요.', done: Boolean(projectReadmeFile), action: () => { if (projectReadmeFile) { openProjectFile(projectReadmeFile.path); setWorkspaceSection('code') } else void openOrCreateProjectReadme() } },
    { id: 'task', icon: '✓', title: '첫 작업 등록', detail: '할 일을 나눠 팀의 진행 상황을 기록해요.', done: projectTasks.length > 0, action: () => setWorkspaceSection('tasks') },
    { id: 'team', icon: '♧', title: '팀원과 공유', detail: 'WebLink 계정으로 편집 권한을 나눠요.', done: projectMembers.length > 1, action: () => setWorkspaceSection('team') },
    { id: 'folder', icon: '⌂', title: '이 컴퓨터 폴더 연결', detail: 'GitHub Desktop 저장소와 파일을 이어 쓸 수 있어요.', done: Boolean(localProjectDirectory), action: () => setWorkspaceSection('storage') },
  ]
  const unreadTaskActivityCount = projectTaskActivity.filter((activity) => !seenTaskActivityIds.includes(activity.id)).length
  const myOverdueTaskCount = projectTasks.filter((task) => task.assignee_id === user?.id && task.status !== 'DONE' && !!task.due_date && task.due_date < todayForTasks).length
  const myDueSoonTaskCount = projectTasks.filter((task) => task.assignee_id === user?.id && task.status !== 'DONE' && !!task.due_date && task.due_date >= todayForTasks && task.due_date <= weekCutoffForTasks).length

  if (loading) return <main className="welcome"><p className="status">WebLink를 준비하고 있어요…</p></main>

  if (!user && showLanding) return <LandingPage onEnter={(nextMode) => { setMode(nextMode); setError(''); setShowLanding(false) }} />

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
        {projectInviteToken && <aside className="project-invite-banner" role="status"><div><strong>프로젝트 초대를 받았어요</strong><span>{user.email} 계정으로 로그인되어 있습니다. 초대받은 이메일과 다르면 해당 계정으로 다시 로그인해 주세요.</span></div><button className="primary-button" type="button" onClick={() => void acceptProjectInvite()} disabled={projectBusy}>{projectBusy ? '초대 확인 중…' : '초대 수락'}</button><button className="secondary-button" type="button" onClick={() => { setProjectInviteToken(''); window.sessionStorage.removeItem('weblink.project-invite'); const url = new URL(window.location.href); url.searchParams.delete('project_invite'); window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`) }}>닫기</button></aside>}
        {view === 'connections' ? (
          <main className="connections-main">
            <div className="connections-heading"><p className="eyebrow">프로젝트와 외부 서비스</p><h1>연결 앱</h1><p>외부 앱 연결을 안전하게 관리하고, 프로젝트에서 필요한 데이터만 읽어 올 수 있어요.</p></div>
            {new URLSearchParams(window.location.search).get('connection') === 'google_connected' && <p className="project-notice connection-message">Google 계정을 연결했어요. 이제 스프레드시트 데이터를 확인할 수 있어요.</p>}
            {new URLSearchParams(window.location.search).get('connection')?.startsWith('google_') && new URLSearchParams(window.location.search).get('connection') !== 'google_connected' && <p className="form-error connection-message" role="alert">Google 연결이 완료되지 않았어요. 설정과 계정 권한을 확인한 뒤 다시 시도해 주세요.</p>}
            {connectionsError && <p className="form-error connection-message" role="alert">{connectionsError}</p>}
            {connectionsBusy && (!googleConnection || !githubConnection) ? <p className="connection-loading">연결 상태를 확인하고 있어요…</p> : (
              <>
              <section className="connection-card github-connection-card">
                <div className="connection-title"><span className="github-mark" aria-hidden="true">GH</span><div><h2>GitHub 저장소</h2><p>비공개 저장소에서 프로젝트 가져오기</p></div><span className={`connection-badge ${githubConnection?.connected ? 'connected' : ''}`}>{githubConnection?.connected ? '연결됨' : '연결 안 됨'}</span></div>
                {!githubConnection ? <div className="connection-setup"><strong>GitHub 연결 상태를 확인하지 못했어요</strong><p>API 연결 상태를 확인한 다음 다시 시도해 주세요.</p><button className="secondary-button" type="button" onClick={() => void showConnections()} disabled={connectionsBusy}>다시 확인</button></div> : githubConnection.connected ? <>
                  <p className="connected-account">연결 계정 <strong>{githubConnection.account_name}</strong></p>
                  <p className="connection-description">저장한 토큰은 암호화해 보관하며, 저장소 파일을 새 프로젝트로 한 번 가져오는 데 사용해요. GitHub에 변경 사항을 올리거나 자동 동기화하지 않습니다.</p>
                  <button className="disconnect-button" type="button" onClick={disconnectGitHub} disabled={connectionsBusy}>{connectionsBusy ? '처리 중…' : 'WebLink 연결 해제'}</button>
                  <p className="connection-footnote">연결 해제는 WebLink에 저장된 토큰을 지웁니다. GitHub 토큰 자체를 폐기하려면 GitHub 설정에서도 삭제해 주세요.</p>
                </> : githubConnection?.configured ? <>
                  <p className="connection-description">GitHub 세분화된 개인용 액세스 토큰(Fine-grained token)을 연결하면 선택한 비공개 저장소를 가져올 수 있어요. 토큰은 연결을 확인한 뒤 암호화해 저장하고 화면에는 다시 표시하지 않습니다.</p>
                  <ol className="github-token-steps"><li>GitHub에서 세분화된 토큰을 만들고 사용할 저장소만 선택하세요.</li><li>저장소 권한의 Contents를 Read-only로 설정하세요. Metadata는 기본 읽기 권한으로 둡니다.</li><li>아래 입력란에 토큰을 붙여넣고 연결하세요.</li></ol>
                  <label className="github-token-field">GitHub 토큰<input type="password" autoComplete="new-password" spellCheck={false} value={githubToken} onChange={(event) => setGithubToken(event.target.value)} maxLength={500} placeholder="github_pat_…" /></label>
                  <button className="primary-button" type="button" onClick={() => void connectGitHub()} disabled={connectionsBusy || githubToken.trim().length < 20}>{connectionsBusy ? '토큰 확인 중…' : 'GitHub 연결'}</button>
                  <p className="connection-footnote">토큰은 저장소 파일 읽기 권한만 주세요. 연결 암호화 키가 서버에 설정되어 있어야 연결을 저장할 수 있어요. 토큰은 비밀번호처럼 취급하고 다른 사람과 공유하지 마세요.</p>
                </> : <div className="connection-setup"><strong>서버 암호화 설정이 필요해요</strong><p>개인 GitHub 토큰을 안전하게 저장하려면 `.env`에 `CONNECTION_ENCRYPTION_KEY`를 설정하고 API를 다시 시작해야 합니다. Google 연결에서 이미 같은 키를 사용한다면 추가 설정은 필요하지 않아요.</p><code>CONNECTION_ENCRYPTION_KEY</code></div>}
              </section>
              <section className="connection-card">
                <div className="connection-title"><span className="google-mark" aria-hidden="true">G</span><div><h2>Google Sheets</h2><p>스프레드시트 읽기·쓰기 연결</p></div><span className={`connection-badge ${googleConnection?.connected ? 'connected' : ''}`}>{googleConnection?.connected ? '연결됨' : '연결 안 됨'}</span></div>
                {googleConnection?.connected ? <>
                  <p className="connected-account">연결 계정 <strong>{googleConnection.account_email ?? 'Google 계정'}</strong></p>
                  <p className="connection-description">연결한 계정이 접근할 수 있는 스프레드시트에서 필요한 범위를 읽고, 편집 권한이 있는 범위에 값을 기록할 수 있어요. Google 토큰은 암호화해 보관하고 실행 코드에는 전달하지 않아요.</p>
                  {!googleConnection.scopes.includes('https://www.googleapis.com/auth/spreadsheets') && <div className="connection-scope-notice"><p>현재 연결은 Sheets 읽기 권한만 포함해요. 프로젝트 코드에서 시트에 쓰려면 권한을 추가해야 합니다.</p><button className="secondary-button" type="button" onClick={startGoogleConnection} disabled={connectionsBusy}>{connectionsBusy ? '준비 중…' : 'Sheets 쓰기 권한 추가'}</button></div>}
                  <details className="drive-connection-setup"><summary>Google Drive 파일 가져오기 설정</summary>{googleConnection.scopes.includes('https://www.googleapis.com/auth/drive.file') ? googleConnection.drive_picker_configured ? <p>Drive에서 사용자가 직접 선택한 파일만 가져올 수 있어요.</p> : <div className="connection-setup"><strong>Picker 설정이 필요해요</strong><p>API 설정에 Picker API 키와 Google Cloud 프로젝트 번호를 추가해 주세요. API key는 사용할 도메인으로 제한해야 합니다.</p><code>GOOGLE_PICKER_API_KEY</code><code>GOOGLE_CLOUD_PROJECT_NUMBER</code></div> : <div><p>현재 연결에는 시트 읽기 권한만 있어요. 파일 선택 권한을 추가해도 Picker에서 직접 선택한 파일만 읽습니다.</p><button className="secondary-button" type="button" onClick={startGoogleConnection} disabled={connectionsBusy}>{connectionsBusy ? '준비 중…' : 'Drive 파일 선택 권한 추가'}</button></div>}</details>
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
                  <p className="connection-description">Google Sheets 데이터를 확인하거나, 권한을 추가하면 Google Drive에서 선택한 텍스트 파일을 프로젝트로 가져올 수 있어요. OAuth 비밀값은 서버에 암호화해 보관합니다.</p>
                  {googleConnection?.configured ? <button className="primary-button" type="button" onClick={startGoogleConnection} disabled={connectionsBusy}>{connectionsBusy ? '준비 중…' : 'Google 계정 연결하기'}</button> : <div className="connection-setup"><strong>서버 설정이 필요해요</strong><p>`.env`에 Google OAuth 웹 클라이언트 정보와 연결 암호화 키를 넣고 Docker 서비스를 다시 시작하면 연결 버튼이 활성화돼요.</p><code>GOOGLE_OAUTH_CLIENT_ID</code><code>GOOGLE_OAUTH_CLIENT_SECRET</code><code>CONNECTION_ENCRYPTION_KEY</code><small>리디렉션 주소: http://localhost:8000/api/v1/connections/google/oauth/callback</small></div>}
                </>}
              </section>
              </>
            )}
          </main>
        ) : view === 'projects' ? (
          <main className="project-list-main">
                  <div className="project-heading-row"><div className="project-heading"><p className="eyebrow">내 저장소에서 만들고, 함께 작업하기</p><h1>프로젝트 작업 공간</h1><p>프로젝트를 열어 팀원과 작업하거나, 내 컴퓨터·GitHub 저장소에 연결해 계속 개발하세요.</p></div><div className="project-list-actions"><button className="secondary-button" type="button" onClick={() => { setProjectListPanel(projectListPanel === 'import' ? null : 'import'); setArchiveToImport(null); setArchiveProjectName('') }}>가져오기</button><button className="primary-button" type="button" onClick={() => { setProjectListPanel(projectListPanel === 'create' ? null : 'create'); setArchiveToImport(null); setArchiveProjectName('') }}>＋ 새 프로젝트</button></div></div>
            <details className="project-storage-disclosure">
              <summary><span>프로젝트 저장·공유 방법</span><small>WebLink · 내 컴퓨터/GitHub Desktop · Google Drive</small></summary>
              <section className="project-storage-hub" aria-label="프로젝트 저장 방식">
              <div className="storage-hub-heading"><div><p className="eyebrow">저장 위치와 협업</p><h2>내 코드, 내가 선택한 저장소</h2></div><span>연결 가능한 저장소 3개</span></div>
              <div className="storage-provider-grid">
                <article className="storage-provider-card local-provider"><span className="storage-provider-icon" aria-hidden="true">⌂</span><div><h3>내 컴퓨터 · GitHub Desktop</h3><p>프로젝트를 연 뒤 내 컴퓨터 폴더와 연결하세요. 공유 저장소를 GitHub Desktop으로 복제해 두면 WebLink에서 편집한 파일을 그 폴더에 저장하고, 친구와는 GitHub에서 커밋·동기화할 수 있어요.</p><small>Chrome·Edge 지원 · ZIP 내보내기는 다른 브라우저에서도 사용 가능</small></div></article>
              <article className="storage-provider-card weblink-provider"><span className="storage-provider-icon" aria-hidden="true">W</span><div><h3>WebLink 실행 공간</h3><p>코드를 실행하고 DB·외부 앱 연결을 시험할 때 사용하는 작업용 공간입니다. 현재 이 앱은 직접 운영하는 Docker/PostgreSQL에 사본을 저장해요.</p><small>프로젝트 실행과 저장에 사용</small></div></article>
              <article className="storage-provider-card drive-provider"><span className="storage-provider-icon" aria-hidden="true">↗</span><div><h3>Google Drive</h3><p>Picker에서 선택한 텍스트 파일 여러 개를 새 프로젝트나 현재 프로젝트로 가져올 수 있어요.</p><small>파일당 200KB · 프로젝트 전체 1MB</small></div></article>
              </div>
              <p className="storage-hub-note">WebLink 안에서 함께 편집하려면 프로젝트를 연 뒤 팀원 이메일과 권한을 추가하세요. GitHub 저장소를 공유하려면 GitHub Desktop에서 친구가 초대한 저장소를 복제해 프로젝트 폴더로 연결한 다음, 변경 파일을 커밋하고 푸시하면 됩니다.</p>
              </section>
            </details>
            {projectNotice && <p className="project-notice project-list-notice" role="status">{projectNotice}</p>}
            <div className="project-list-layout">
              {projectListPanel && <div className="project-side-actions">
                {projectListPanel === 'create' && <form className="project-create-form" onSubmit={handleCreateProject}>
                  <div className="project-form-heading"><div><p className="eyebrow">새 출발</p><h2>프로젝트 만들기</h2></div><button className="panel-close-button" type="button" aria-label="프로젝트 만들기 닫기" onClick={() => setProjectListPanel(null)}>×</button></div>
                  <label>프로젝트 이름<input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} required maxLength={120} placeholder="예: 나만의 인사말 앱" /></label>
                  <label>한 줄 설명<textarea value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} maxLength={1000} rows={3} placeholder="무엇을 만들고 싶나요?" /></label>
                  <button className="primary-button" type="submit" disabled={projectBusy}>{projectBusy ? '처리 중…' : '프로젝트 시작하기'}</button>
                  <div className="sample-project-start"><p>먼저 기능을 살펴보고 싶다면</p><button className="secondary-button" type="button" onClick={createSampleProject} disabled={projectBusy}>{projectBusy ? '예제 준비 중…' : 'SQLite 예제 열기'}</button><small>실행해 볼 수 있는 독서 기록 앱과 여러 파일을 만들어요.</small></div>
                </form>}
                {projectListPanel === 'import' && <form className="project-create-form project-import-form" onSubmit={handleImportProject}>
                  <div className="project-form-heading"><div><p className="eyebrow">다른 저장소에서 가져오기</p><h2>프로젝트 가져오기</h2></div><button className="panel-close-button" type="button" aria-label="가져오기 닫기" onClick={() => { setProjectListPanel(null); setArchiveToImport(null); setArchiveProjectName('') }}>×</button></div>
                  <p className="import-project-note">WebLink에서 내려받은 ZIP을 선택하세요. `.env`와 개인 키 파일은 가져오지 않습니다. ZIP은 1.5MB 이하, 압축을 푼 UTF-8 텍스트 파일은 전체 1MB 이하여야 해요.</p>
                  <label>ZIP 파일<input type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    setArchiveToImport(file)
                    if (file) setArchiveProjectName(file.name.replace(/\.zip$/i, '').slice(0, 120))
                  }} required /></label>
                  <label>새 프로젝트 이름<input value={archiveProjectName} onChange={(event) => setArchiveProjectName(event.target.value)} required maxLength={120} placeholder="가져온 프로젝트 이름" /></label>
                  <button className="primary-button" type="submit" disabled={projectBusy || !archiveToImport}>{projectBusy ? '가져오는 중…' : 'ZIP 가져오기'}</button>
                  <details className="github-import-disclosure"><summary>GitHub 저장소에서 가져오기</summary><p>공개 저장소는 바로 가져오고, 비공개 저장소는 연결 앱에서 세분화된 토큰을 연결한 뒤 가져옵니다. 저장소의 기본 브랜치 파일을 새 프로젝트로 복사하며 ZIP은 1.5MB 이하만 지원합니다. 가져온 뒤 GitHub에 자동으로 올라가거나 동기화되지는 않습니다.</p><label>GitHub 저장소 주소<input type="url" value={githubRepositoryUrl} onChange={(event) => { const value = event.target.value; setGithubRepositoryUrl(value); const candidate = value.trim().replace(/\/+$/, '').split('/').pop()?.replace(/\.git$/i, '') ?? ''; if (candidate) setGithubProjectName((current) => current.trim() ? current : candidate.slice(0, 120)) }} maxLength={600} placeholder="https://github.com/owner/repository" /></label><label>프로젝트 이름<input value={githubProjectName} onChange={(event) => setGithubProjectName(event.target.value)} maxLength={120} placeholder="가져온 프로젝트 이름" /></label><button className="secondary-button" type="button" onClick={() => void handleImportGithubRepository()} disabled={projectBusy || !githubRepositoryUrl.trim() || !githubProjectName.trim()}>{projectBusy ? '저장소 확인 중…' : 'GitHub 저장소 가져오기'}</button><button className="plain-link-button" type="button" onClick={showConnections}>GitHub 권한 연결·관리</button></details>
                  <details className="google-drive-import-disclosure"><summary>Google Drive 파일에서 새 프로젝트 만들기</summary><p>Google 계정을 연결하고 WebLink Picker 설정이 필요해요. 텍스트·Markdown·CSV·JSON·HTML·CSS 파일과 Google Docs·Sheets를 최대 50개 골라 가져옵니다. 파일당 200KB, 전체 1MB까지 지원해요. 같은 이름의 파일은 자동으로 번호를 붙입니다.</p><button className="secondary-button" type="button" onClick={() => void handleImportGoogleDriveFile()} disabled={projectBusy}>{projectBusy ? 'Drive 파일 가져오는 중…' : 'Google Drive 파일 선택'}</button><button className="secondary-button" type="button" onClick={() => void createDriveDataImportProject()} disabled={projectBusy}>{projectBusy ? 'DB 프로젝트 준비 중…' : 'CSV·JSON으로 SQLite DB 프로젝트 만들기'}</button><small>최대 49개 파일을 골라 가져오기 코드를 생성해요. 실행하면 DB에 저장되고, 다시 실행하면 같은 테이블의 기존 행을 파일 내용으로 교체합니다.</small><button className="plain-link-button" type="button" onClick={showConnections}>연결 앱 설정 열기</button></details>
                </form>}
              </div>}
              <section className="project-cards">
                <div className="project-cards-heading"><h2>내 프로젝트 <span className="project-count">{filteredProjects.length}</span></h2><div className="project-list-controls"><label className="project-search"><span className="sr-only">프로젝트 검색</span><input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="프로젝트 검색" /></label><label className="project-select-label"><span className="sr-only">참여 유형</span><select value={projectRoleFilter} onChange={(event) => setProjectRoleFilter(event.target.value as typeof projectRoleFilter)}><option value="ALL">전체 프로젝트</option><option value="OWNER">내가 소유</option><option value="MEMBER">참여 중</option></select></label><label className="project-select-label"><span className="sr-only">정렬 순서</span><select value={projectSort} onChange={(event) => setProjectSort(event.target.value as typeof projectSort)}><option value="UPDATED">최근 수정순</option><option value="NAME">이름순</option></select></label></div></div>
                {projectError && <p className="form-error" role="alert">{projectError}</p>}
                {projectBusy && projects.length === 0 ? <p className="empty-projects">프로젝트를 불러오고 있어요…</p> : filteredProjects.length ? <div className="project-card-grid">{filteredProjects.map((project) => (
                  <div className="project-card-entry" key={project.id}>
                    <button className="project-card" type="button" onClick={() => openProject(project.id)} disabled={projectBusy}>
                      <span className="project-card-icon">↗</span>
                      <span className="project-card-copy"><strong>{project.name}</strong><small>{project.description || '설명이 아직 없습니다.'}</small><small>초안 v{project.draft_version} · {new Date(project.updated_at).toLocaleDateString('ko-KR')}</small><span className={`project-member-role project-member-role-${project.role.toLocaleLowerCase()}`}>{project.role === 'OWNER' ? '소유자' : project.role === 'EDITOR' ? '편집자로 참여' : '보기 전용으로 참여'}</span><span className="project-storage-badge">{projectFolders[project.id] ? `폴더 · ${projectFolders[project.id]}` : 'WebLink 작업 사본'}</span></span>
                    </button>
                    {project.role === 'OWNER' && <button className="plain-danger-button project-list-delete" type="button" onClick={() => deleteProjectById(project.id, project.name)} disabled={projectBusy} aria-label={`${project.name} 프로젝트 삭제`}>삭제</button>}
                  </div>
                ))}</div> : projects.length || projectSearch || projectRoleFilter !== 'ALL' ? <div className="empty-projects"><strong>조건에 맞는 프로젝트가 없어요.</strong><p>검색어와 참여 유형을 바꾸거나 필터를 초기화해 보세요.</p><button className="secondary-button" type="button" onClick={() => { setProjectSearch(''); setProjectRoleFilter('ALL') }}>검색·필터 초기화</button></div> : <div className="empty-projects"><strong>첫 프로젝트를 시작해 보세요</strong><p>프로젝트를 만들거나 ZIP 파일을 가져오면 이곳에서 이어서 작업할 수 있어요.</p><button className="primary-button" type="button" onClick={() => setProjectListPanel('create')}>프로젝트 만들기</button></div>}
              </section>
            </div>
          </main>
        ) : view === 'workspace' ? workspace ? (
          <main className="workspace-main">
            <div className="workspace-heading">
              <div><button className="back-link" type="button" onClick={showProjects}>← 프로젝트 목록</button><div className="workspace-title-row"><h1>{workspace.name}</h1>{canManageProject && <button type="button" className="project-details-edit-button" onClick={beginProjectDetailsEdit} disabled={projectBusy || projectDirty} title={projectDirty ? '초안을 먼저 저장해 주세요.' : '프로젝트 이름과 설명 수정'} aria-label="프로젝트 이름과 설명 수정">✎</button>}</div><p>초안 버전 {workspace.draft_version}{projectBusy && projectDirty ? ' · 저장 중' : projectDirty && projectNeedsReload ? ' · 최신 초안 확인 필요' : projectDirty && projectError ? ' · 저장 문제 확인' : projectDirty ? ' · 1.5초 후 자동 저장' : ' · 저장됨'}</p></div>
              <div className="workspace-actions">
                {projectDirty ? <button className="secondary-button" type="button" onClick={saveProjectDraft} disabled={projectBusy || isProjectReadOnly}>{projectBusy ? '저장 중…' : '초안 저장'}</button> : <span className="workspace-save-state">{isProjectReadOnly ? '보기 전용' : '✓ 저장됨'}</span>}
                <button className="primary-button" type="button" onClick={runProject} disabled={projectBusy || isProjectReadOnly || !workspace.files.some((file) => file.path === 'main.py')} title={isProjectReadOnly ? '보기 전용 권한으로는 실행할 수 없습니다.' : !workspace.files.some((file) => file.path === 'main.py') ? '루트에 main.py 파일이 있어야 실행할 수 있습니다.' : undefined}>{projectBusy ? '실행 중…' : '실행'}</button>
                <details className="workspace-more-menu"><summary>더 보기</summary><div>
                  {projectDirty && <button type="button" onClick={discardProjectChanges} disabled={projectBusy || isProjectReadOnly}>변경 취소</button>}
                  <button type="button" onClick={saveProjectVersion} disabled={projectBusy || isProjectReadOnly}>{projectBusy ? '처리 중…' : '버전 저장'}</button>
                  <button type="button" onClick={downloadProjectArchive} disabled={projectBusy || projectAccessLost}>{projectBusy ? '처리 중…' : 'ZIP 다운로드'}</button>
                  {canManageProject && <button className="is-danger" type="button" onClick={deleteCurrentProject} disabled={projectBusy}>프로젝트 삭제</button>}
                </div></details>
              </div>
            </div>
            {editingProjectDetails && <form className="project-details-editor" onSubmit={saveProjectDetails}>
              <label>프로젝트 이름<input value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} required maxLength={120} autoFocus disabled={projectBusy} /></label>
              <label>설명<textarea value={projectDescriptionDraft} onChange={(event) => setProjectDescriptionDraft(event.target.value)} rows={2} maxLength={1000} disabled={projectBusy} /></label>
              <div><button type="submit" className="primary-button" disabled={projectBusy || projectDirty || !projectNameDraft.trim()}>{projectBusy ? '저장 중…' : '정보 저장'}</button><button type="button" className="secondary-button" onClick={() => setEditingProjectDetails(false)} disabled={projectBusy}>취소</button></div>
            </form>}
            {projectNotice && <p className="project-notice" role="status">{projectNotice}</p>}
            {projectError && <p className="form-error project-message" role="alert">{projectError}</p>}
            {workspaceSection === 'code' && !workspace.files.some((file) => file.path === 'main.py') && <p className="form-error project-message" role="status">루트 main.py가 없어 실행할 수 없어요. 왼쪽 + 버튼에서 파일 종류를 선택하고 <code>main.py</code>를 만들면 다시 실행할 수 있습니다.</p>}
            {projectNeedsReload && <button className="reload-draft-button" type="button" onClick={() => void reloadWorkspace()} disabled={projectBusy || isProjectReadOnly}>서버의 최신 초안 불러오기</button>}
            <nav className="workspace-section-nav" aria-label="프로젝트 작업 영역">
              <button type="button" className={workspaceSection === 'overview' ? 'is-active' : ''} aria-pressed={workspaceSection === 'overview'} onClick={() => setWorkspaceSection('overview')}><strong>개요</strong><span>프로젝트 소개와 진행 상황</span></button>
              <button type="button" className={workspaceSection === 'code' ? 'is-active' : ''} aria-pressed={workspaceSection === 'code'} onClick={() => setWorkspaceSection('code')}><strong>코드 편집</strong><span>파일 {workspace.files.length}개{projectDirty ? ' · 저장 안 됨' : ''}</span></button>
              <button type="button" className={workspaceSection === 'tasks' ? 'is-active' : ''} aria-pressed={workspaceSection === 'tasks'} onClick={() => setWorkspaceSection('tasks')}><strong>작업 보드</strong><span>{projectTasks.length}개 · {completedTaskCount}개 완료{unreadTaskActivityCount > 0 ? ` · 알림 ${unreadTaskActivityCount}` : ''}</span></button>
              <button type="button" className={workspaceSection === 'team' ? 'is-active' : ''} aria-pressed={workspaceSection === 'team'} onClick={() => setWorkspaceSection('team')}><strong>팀 관리</strong><span>팀원 {projectMembers.length}명</span></button>
              <button type="button" className={workspaceSection === 'storage' ? 'is-active' : ''} aria-pressed={workspaceSection === 'storage'} onClick={() => setWorkspaceSection('storage')}><strong>저장 위치</strong><span>{localProjectDirectory ? `연결됨 · ${localProjectDirectory.name}` : 'WebLink 저장'}</span></button>
            </nav>
            <section className="project-overview" aria-labelledby="project-overview-title" hidden={workspaceSection !== 'overview'}>
              <div className="project-overview-hero">
                <div className="project-overview-intro">
                  <span className="project-overview-mark" aria-hidden="true">{workspace.name.trim().slice(0, 1).toLocaleUpperCase() || 'W'}</span>
                  <div><p className="eyebrow">프로젝트 개요</p><h2 id="project-overview-title">프로젝트 소개</h2><p>{workspace.description || '아직 프로젝트 소개가 없습니다. 무엇을 만들고, 어떤 문제를 해결하는지 적어 두면 팀원과 다음 작업을 시작하기 쉬워요.'}</p></div>
                  {canManageProject && <button className="secondary-button project-overview-edit" type="button" onClick={beginProjectDetailsEdit} disabled={projectBusy || projectDirty}>소개 수정</button>}
                </div>
                <aside className="project-overview-meta"><span className="project-overview-live"><i /> {projectDirty ? '저장되지 않은 변경 사항' : '최신 초안'}</span><strong>초안 v{workspace.draft_version}</strong><span>마지막 업데이트 {new Date(workspace.updated_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</span><span>{localProjectDirectory ? `컴퓨터 폴더 · ${localProjectDirectory.name}` : 'WebLink 작업 공간에 저장 중'}</span></aside>
              </div>
              <div className="project-overview-stats" aria-label="프로젝트 요약">
                <button type="button" onClick={() => setWorkspaceSection('code')} aria-label={`파일 ${workspace.files.length}개, 코드 편집 열기`}><span>파일</span><strong>{workspace.files.length}</strong><small>프로젝트 코드와 문서 <b>열기 →</b></small></button>
                <button type="button" onClick={() => setWorkspaceSection('tasks')} aria-label={`작업 ${projectTasks.length}개, 작업 보드 열기`}><span>작업</span><strong>{projectTasks.length}</strong><small>{projectTasks.filter((task) => task.status === 'IN_PROGRESS').length}개 진행 중 · {completedTaskCount}개 완료 <b>열기 →</b></small></button>
                <button type="button" onClick={() => setWorkspaceSection('team')} aria-label={`팀원 ${projectMembers.length}명, 팀 관리 열기`}><span>팀원</span><strong>{projectMembers.length}</strong><small>공유 작업 공간 참여자 <b>열기 →</b></small></button>
                <button type="button" onClick={() => setWorkspaceSection('storage')} aria-label={`저장 버전 ${projectVersions.length}개, 저장 위치 열기`}><span>저장 버전</span><strong>{projectVersions.length}</strong><small>{projectVersions.length ? `최근 v${projectVersions[0].version_number}` : '아직 저장한 버전 없음'} <b>열기 →</b></small></button>
              </div>
              <div className="project-overview-content">
              <section className="project-overview-progress" aria-label="작업 진행 상황">
                <div className="project-overview-progress-summary"><div><p className="eyebrow">팀 진행 상황</p><strong>{projectTasks.length ? `${taskCompletionPercent}% 완료` : '작업 없음'}</strong><span>{projectTasks.length ? `${completedTaskCount} / ${projectTasks.length}개 작업` : '작업 보드에서 할 일을 추가할 수 있어요.'}</span></div><div className="project-overview-progress-track" role="progressbar" aria-label="작업 완료율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={taskCompletionPercent}><span style={{ width: `${taskCompletionPercent}%` }} /></div><button type="button" onClick={() => setWorkspaceSection('tasks')}>{overdueTaskCount ? `기한 초과 ${overdueTaskCount}개` : projectTasks.length ? '작업 보드 열기' : '첫 작업 추가'} <b>→</b></button></div>
                <div className="project-overview-deadlines"><div className="project-overview-panel-heading"><div><p className="eyebrow">가까운 일정</p><h3>마감 예정 작업</h3></div><button type="button" onClick={() => setWorkspaceSection('tasks')}>전체 보기 →</button></div>{dashboardDueTasks.length ? <ul>{dashboardDueTasks.map((task) => <li key={task.id}><button type="button" onClick={() => void openTaskInBoard(task.id)}><span className={task.due_date && task.due_date < todayForTasks ? 'is-overdue' : ''}>{task.due_date && task.due_date < todayForTasks ? '지남' : task.due_date && task.due_date === todayForTasks ? '오늘' : task.due_date ? new Date(`${task.due_date}T00:00:00`).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '마감 없음'}</span><strong>{task.title}</strong><small>{task.status === 'IN_PROGRESS' ? '진행 중' : '할 일'}</small></button></li>)}</ul> : <div className="project-overview-deadline-empty"><p className="project-overview-empty">{projectTasks.length && projectTasks.every((task) => task.status === 'DONE') ? '모든 작업을 완료했습니다.' : projectTasks.some((task) => task.status !== 'DONE') ? '미완료 작업에 아직 마감일이 설정되지 않았습니다.' : '작업 보드에 첫 할 일을 추가해 보세요.'}</p><button type="button" onClick={() => setWorkspaceSection('tasks')}>{projectTasks.some((task) => task.status !== 'DONE') ? '작업 보드에서 확인 →' : '작업 보드 열기 →'}</button></div>}</div>
              </section>
              <section className="project-overview-readme" aria-labelledby="project-readme-title">
                <div className="project-overview-panel-heading"><div><p className="eyebrow">프로젝트 문서</p><h3 id="project-readme-title">{projectReadmeFile ? 'README.md' : '프로젝트 소개 문서'}</h3></div>{projectReadmeFile ? <button type="button" onClick={() => { openProjectFile(projectReadmeFile.path); setWorkspaceSection('code') }}>README 편집 →</button> : !isProjectReadOnly && <button type="button" onClick={() => void openOrCreateProjectReadme()} disabled={projectBusy}>README 만들기 →</button>}</div>
                {projectReadmeFile ? <ProjectReadmePreview content={projectReadmeFile.content} /> : <p className="project-overview-empty">README.md가 아직 없습니다. 프로젝트 목표, 실행 방법, 주요 파일을 적어 두면 처음 참여하는 팀원도 바로 흐름을 파악할 수 있어요. 만들기를 누르면 설명과 파일 목록을 넣은 초안이 준비됩니다.</p>}
              </section>
              </div>
              <div className="project-overview-lower">
                <section className="project-overview-panel project-overview-recent"><div className="project-overview-panel-heading"><div><p className="eyebrow">팀 진행 상황</p><h3>최근 활동</h3></div><button type="button" onClick={() => { setWorkspaceSection('tasks'); setTaskActivityOpen(true); markTaskActivityRead() }}>활동 모두 보기 →</button></div>
                  {projectTaskActivity.length ? <ol className="project-overview-activity">{projectTaskActivity.slice(0, 5).map((activity) => <li key={activity.id}><button type="button" onClick={() => void openTaskFromActivity(activity)}><span className={`project-overview-activity-dot${seenTaskActivityIds.includes(activity.id) ? '' : ' is-unread'}`} aria-hidden="true" /><span className="project-overview-activity-copy"><span><strong>{activity.actor_name}</strong> {activity.message}</span><b>{activity.task_title}</b></span><time>{new Date(activity.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></button></li>)}</ol> : <p className="project-overview-empty">아직 팀 활동이 없어요. 작업을 추가하거나 진행 상태를 바꾸면 이곳에서 확인할 수 있습니다.</p>}
                </section>
                <section className="project-overview-panel project-overview-start">
                  {canManageProject ? <details className="project-setup-details">
                    <summary className="project-setup-heading"><div><p className="eyebrow">프로젝트 준비</p><h3>팀과 시작하기</h3></div><span>{projectSetupSteps.filter((step) => step.done).length}/{projectSetupSteps.length} 완료</span></summary>
                    <div className="project-setup-progress" role="progressbar" aria-label="프로젝트 시작 준비율" aria-valuemin={0} aria-valuemax={projectSetupSteps.length} aria-valuenow={projectSetupSteps.filter((step) => step.done).length}><span style={{ width: `${projectSetupSteps.filter((step) => step.done).length / projectSetupSteps.length * 100}%` }} /></div>
                    <div className="project-setup-list">{projectSetupSteps.map((step) => <button key={step.id} type="button" className={step.done ? 'is-complete' : ''} onClick={step.action} disabled={projectBusy || (step.id === 'intro' && projectDirty)}><span className="project-setup-icon" aria-hidden="true">{step.done ? '✓' : step.icon}</span><span className="project-setup-copy"><strong>{step.title}</strong><small>{step.detail}</small></span><b>{step.done ? '완료' : '열기 →'}</b></button>)}</div>
                  </details> : <><p className="eyebrow">바로 시작하기</p><h3>다음 작업을 골라 보세요</h3><button type="button" onClick={() => setWorkspaceSection('code')}><span className="project-overview-action-icon">⌘</span><span><strong>코드 편집 열기</strong><small>프로젝트 파일을 확인하고 수정해요.</small></span><b>→</b></button><button type="button" onClick={() => setWorkspaceSection('tasks')}><span className="project-overview-action-icon">✓</span><span><strong>할 일 확인하기</strong><small>팀원과 작업의 진행 상황을 확인해요.</small></span><b>→</b></button><button type="button" onClick={() => setWorkspaceSection('storage')}><span className="project-overview-action-icon">⌂</span><span><strong>저장 위치 확인하기</strong><small>{localProjectDirectory ? '컴퓨터 폴더 연결 상태를 확인해요.' : '저장된 프로젝트 파일을 확인해요.'}</small></span><b>→</b></button></>}
                </section>
              </div>
            </section>
            <section className="project-collaborators-card" hidden={workspaceSection !== 'team'}>
              <div className="project-collaborators-heading"><div><p className="eyebrow">함께 작업</p><h2>프로젝트 팀원</h2><p>팀원은 각자 WebLink 계정으로 같은 초안을 열어 이어서 작업할 수 있어요.</p></div><span>{projectEventsConnected ? `현재 ${onlineProjectMemberIds.length}명 접속 · 팀원 ${projectMembers.length}명` : `팀원 ${projectMembers.length}명`}</span></div>
              {canManageProject && <form className="project-member-form" onSubmit={addProjectMember}>
                <label>WebLink 계정 이메일<input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="친구의 가입 이메일" required maxLength={320} disabled={projectBusy} /></label>
                <label>권한<select value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'EDITOR' | 'VIEWER')} disabled={projectBusy}><option value="EDITOR">편집 가능</option><option value="VIEWER">보기 전용</option></select></label>
                <button className="primary-button" type="submit" disabled={projectBusy || !memberEmail.trim()}>{projectBusy ? '처리 중…' : '팀원 추가'}</button>
                <small>팀원이 되려면 먼저 WebLink에 가입해야 합니다. 이메일을 보내지는 않아요.</small>
              </form>}
              {canManageProject && <div className="project-invite-tools"><button className="secondary-button" type="button" onClick={() => void createProjectInviteLink()} disabled={projectBusy || !memberEmail.trim()}>{projectBusy ? '처리 중…' : '초대 링크 만들기'}</button><small>이메일을 입력하면 해당 계정에 연결된 7일 유효 링크를 만들어요. 링크를 직접 전달하세요.</small>{projectInviteLink && <div className="project-invite-link"><input aria-label="프로젝트 초대 링크" readOnly value={projectInviteLink} onFocus={(event) => event.currentTarget.select()} /><button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(projectInviteLink).then(() => setProjectNotice('초대 링크를 클립보드에 복사했습니다.')).catch(() => setProjectError('클립보드 접근이 막혔습니다. 링크 입력란을 선택해 복사해 주세요.'))}>링크 복사</button></div>}</div>}
              {canManageProject && <section className="project-invitation-list" aria-label="보낸 초대">
                <div className="project-invitation-heading"><div><h3>보낸 초대</h3><p>초대 링크는 만든 뒤 7일 동안 사용할 수 있어요.</p></div><span>{projectInvitations.filter((item) => item.status === 'PENDING').length}개 대기 중</span></div>
                {projectInvitations.length ? <ul>{projectInvitations.map((invitation) => {
                  const expiry = new Date(invitation.expires_at)
                  const daysLeft = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86_400_000))
                  return <li key={invitation.id} className={invitation.status === 'EXPIRED' ? 'is-expired' : ''}>
                    <span className="project-invitation-identity"><strong>{invitation.email}</strong><small>{invitation.role === 'EDITOR' ? '편집 권한' : '보기 전용'} · {invitation.status === 'EXPIRED' ? '만료됨' : `${daysLeft}일 후 만료`}</small></span>
                    <time dateTime={invitation.expires_at}>만료 {expiry.toLocaleDateString('ko-KR')}</time>
                    {invitation.status === 'EXPIRED' && <button type="button" className="secondary-button" onClick={() => void createProjectInviteLink(invitation.email, invitation.role)} disabled={projectBusy}>다시 초대</button>}
                    <button type="button" className="plain-danger-button" onClick={() => void revokeProjectInvitation(invitation)} disabled={projectBusy}>{invitation.status === 'EXPIRED' ? '기록 삭제' : '초대 취소'}</button>
                  </li>
                })}</ul> : <p className="project-invitation-empty">아직 보낸 초대가 없어요.</p>}
              </section>}
              {isProjectReadOnly && <p className="member-readonly-note">{projectAccessLost ? '이 계정은 현재 프로젝트에 접근할 수 없어 서버 변경을 확인하거나 저장할 수 없습니다. 저장되지 않은 코드는 복사해 보관하세요.' : '보기 전용 권한입니다. 파일을 내려받아 확인할 수 있지만 프로젝트를 수정하거나 실행할 수는 없어요.'}</p>}
              <div className="project-member-list">
                {projectMembers.map((member) => <div className="project-member-row" key={member.user_id}>
                  <span className="project-member-avatar" aria-hidden="true">{(member.display_name || member.email).slice(0, 1).toLocaleUpperCase()}</span>
                  <span className="project-member-identity"><strong>{member.display_name || member.email}{member.user_id === user?.id ? ' · 나' : ''}</strong><small>{member.email}</small></span>
                  {canManageProject && member.role !== 'OWNER'
                    ? <select className={`project-member-role-select project-member-role-${member.role.toLocaleLowerCase()}`} value={member.role} onChange={(event) => void changeProjectMemberRole(member, event.target.value as 'EDITOR' | 'VIEWER')} disabled={projectBusy} aria-label={`${member.display_name}님의 권한 변경`}><option value="EDITOR">편집자</option><option value="VIEWER">보기 전용</option></select>
                    : <span className={`project-member-role project-member-role-${member.role.toLocaleLowerCase()}`}>{member.role === 'OWNER' ? '소유자' : member.role === 'EDITOR' ? '편집자' : '보기 전용'}</span>}
                  {onlineProjectMemberIds.includes(member.user_id) && <span className="project-member-online"><i aria-hidden="true" />접속 중</span>}
                  {canManageProject && member.role !== 'OWNER' && <button type="button" className="plain-danger-button" onClick={() => void removeProjectMember(member)} disabled={projectBusy}>제외</button>}
                </div>)}
              </div>
              <section className="project-team-activity" aria-label="팀 변경 기록">
                <div className="project-team-activity-heading"><div><h3>팀 변경 기록</h3><p>초대와 팀원 권한 변경 이력입니다.</p></div><span>최근 {projectTeamActivity.length}건</span></div>
                {projectTeamActivity.length ? <ol>{projectTeamActivity.map((entry) => <li key={entry.id}><span><strong>{entry.actor_name}</strong>{entry.message}</span><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol> : <p className="project-team-activity-empty">아직 팀 변경 기록이 없습니다.</p>}
              </section>
            </section>
            <section className="workspace-storage-card" hidden={workspaceSection !== 'storage'}>
              <div className="workspace-storage-summary"><div><p className="eyebrow">프로젝트 파일 저장 위치</p><h2>{localProjectDirectory ? `내 컴퓨터 · ${localProjectDirectory.name}` : 'WebLink 작업 공간'}</h2><p>{localProjectDirectory ? '초안을 저장하면 선택한 폴더에도 파일이 기록됩니다. GitHub Desktop에서 커밋·푸시해 친구와 공유할 수 있어요.' : '파일은 WebLink 작업 공간에 저장 중입니다. 내 컴퓨터나 GitHub Desktop 폴더를 연결해 코드 사본을 직접 관리할 수 있어요.'}</p></div><span className={`storage-state ${localProjectDirectory ? 'storage-state-local' : ''}`}>{localProjectDirectory ? '폴더 연결됨' : 'WebLink 저장'}</span></div>
              {githubSource?.connected && <div className="github-source-panel"><div><p className="eyebrow">가져온 GitHub 원본</p><h3><a href={githubSource.repository_url ?? '#'} target="_blank" rel="noreferrer">{githubSource.repository_url?.replace('https://github.com/', '')}</a></h3><p>브랜치 <strong>{githubSource.branch}</strong>{githubSource.is_private ? ' · 비공개 저장소' : ' · 공개 저장소'} · 가져온 커밋 <code>{githubSource.imported_sha?.slice(0, 7)}</code></p></div><div className="github-source-actions"><span className={`github-source-state${githubSource.update_available ? ' is-ahead' : ''}`}>{githubSource.status_message ?? (githubSource.latest_sha === null ? 'GitHub 연결 필요' : githubSource.update_available ? '새 변경 있음' : '최신 상태')}</span><button className="secondary-button" type="button" onClick={() => void refreshGitHubSource()} disabled={projectBusy}>{projectBusy ? '확인 중…' : 'GitHub 변경 확인'}</button>{githubSource.update_available && <button className="primary-button" type="button" onClick={() => void pullGitHubSourceUpdates()} disabled={projectBusy || projectDirty || projectNeedsReload || isProjectReadOnly}>{isProjectReadOnly ? '보기 전용' : projectDirty ? '먼저 초안 저장' : projectNeedsReload ? '최신 초안 먼저 확인' : '변경 가져오기'}</button>}{(githubSource.status_message || (githubSource.is_private && !githubSource.token_connected)) && <button className="plain-link-button" type="button" onClick={showConnections} disabled={projectBusy}>GitHub 권한 연결</button>}</div><small>변경을 받으면 현재 초안은 저장 버전으로 백업합니다. 이 컴퓨터 폴더는 자동으로 변경하지 않습니다.</small></div>}
              {!localProjectDirectory ? <button className="secondary-button" type="button" onClick={chooseLocalProjectDirectory} disabled={projectBusy}>내 컴퓨터 / GitHub Desktop 폴더 연결</button> : <div className="workspace-storage-actions"><button className="secondary-button" type="button" onClick={refreshProjectFromLocalDirectory} disabled={projectBusy || projectDirty || isProjectReadOnly}>폴더에서 최신 파일 가져오기</button><button className="secondary-button" type="button" onClick={syncWorkspaceToLocalDirectory} disabled={projectBusy || projectDirty}>WebLink 파일을 폴더에 저장</button><button className="plain-danger-button" type="button" onClick={disconnectLocalProjectDirectory} disabled={projectBusy}>연결 해제</button></div>}
              {pendingProjectDirectory && <div className="folder-connection-choice"><strong>선택한 폴더: {pendingProjectDirectory.name}</strong><p>전용 프로젝트 폴더를 선택한 뒤 한 방향을 고르세요. 가져오기는 현재 WebLink 초안을 교체하고, 폴더에 복사하기는 같은 경로의 파일을 덮어씁니다. 비밀 파일은 제외됩니다.</p><div><button className="secondary-button" type="button" onClick={importLocalProjectDirectory} disabled={projectBusy || isProjectReadOnly}>폴더에서 WebLink로 가져오기</button><button className="primary-button" type="button" onClick={exportProjectToLocalDirectory} disabled={projectBusy}>WebLink 파일을 폴더에 복사</button><button className="plain-danger-button" type="button" onClick={() => setPendingProjectDirectory(null)} disabled={projectBusy}>취소</button></div></div>}
              <small className="workspace-storage-footnote">이 브라우저는 폴더 연결을 이 컴퓨터에만 기억합니다. 친구는 저장소를 자신의 컴퓨터에 복제한 다음 같은 방식으로 폴더를 연결해야 해요. 동기화는 자동으로 GitHub에 올리지 않으므로 GitHub Desktop에서 커밋하고 푸시하세요.</small>
            </section>
            <section className="project-task-board" hidden={workspaceSection !== 'tasks'}>
              <div className="project-task-board-heading"><div><p className="eyebrow">함께 진행하기</p><h2>작업 보드</h2><p>코드 작업을 나누고 담당자와 진행 상태를 맞춰 보세요.</p></div><div className="task-board-heading-actions"><span>{completedTaskCount}/{projectTasks.length} 완료</span><button type="button" className="task-activity-button" aria-expanded={taskActivityOpen} onClick={toggleTaskActivityInbox}>활동 알림{unreadTaskActivityCount > 0 && <b>{unreadTaskActivityCount > 99 ? '99+' : unreadTaskActivityCount}</b>}</button></div></div>
              {taskActivityOpen && <aside className="task-activity-inbox" aria-label="최근 작업 활동">
                <div className="task-activity-inbox-heading"><strong>최근 작업 활동</strong><button type="button" onClick={() => setTaskActivityOpen(false)} aria-label="활동 알림 닫기">×</button></div>
                {projectTaskActivity.length ? <ol>{projectTaskActivity.slice(0, 30).map((activity) => <li key={activity.id} className={seenTaskActivityIds.includes(activity.id) ? '' : 'task-activity-unread'}><button type="button" onClick={() => void openTaskFromActivity(activity)}><span><strong>{activity.actor_name}</strong> {activity.message}</span><b>{activity.task_title}</b><time>{new Date(activity.created_at).toLocaleString('ko-KR')}</time></button></li>)}</ol> : <p>아직 작업 활동이 없습니다.</p>}
              </aside>}
              <div className="task-board-summary">
                <div><strong>{projectTasks.length}</strong><span>전체 작업</span></div><div><strong>{projectTasks.filter((task) => task.status === 'IN_PROGRESS').length}</strong><span>진행 중</span></div><div><strong className={overdueTaskCount ? 'task-overdue-count' : ''}>{overdueTaskCount}</strong><span>기한 초과</span></div><div><strong>{taskCompletionPercent}%</strong><span>완료율</span></div>
                <div className="task-board-progress" role="progressbar" aria-label="프로젝트 작업 완료율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={taskCompletionPercent}><span style={{ width: `${taskCompletionPercent}%` }} /></div>
                {(myOverdueTaskCount > 0 || myDueSoonTaskCount > 0) && <div className="task-deadline-reminders">{myOverdueTaskCount > 0 && <button type="button" onClick={() => { setTaskSearch(''); setTaskPriorityFilter('ALL'); setTaskAssigneeFilter('MINE'); setTaskDeadlineFilter('OVERDUE') }}>내 작업 기한 초과 <strong>{myOverdueTaskCount}</strong></button>}{myDueSoonTaskCount > 0 && <button type="button" onClick={() => { setTaskSearch(''); setTaskPriorityFilter('ALL'); setTaskAssigneeFilter('MINE'); setTaskDeadlineFilter('WEEK') }}>7일 안에 마감 <strong>{myDueSoonTaskCount}</strong></button>}</div>}
              </div>
              <div className="task-board-filters" aria-label="작업 검색 및 필터">
                <label className="task-search-field"><span>작업 검색</span><input type="search" value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="제목, 설명, 담당자" /></label>
                <label><span>담당자</span><select value={taskAssigneeFilter} onChange={(event) => setTaskAssigneeFilter(event.target.value)}><option value="ALL">전체 팀원</option><option value="MINE">내 작업</option><option value="UNASSIGNED">담당자 없음</option>{projectMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email}</option>)}</select></label>
                <label><span>우선순위</span><select value={taskPriorityFilter} onChange={(event) => setTaskPriorityFilter(event.target.value as 'ALL' | ProjectTaskPriority)}><option value="ALL">모든 우선순위</option><option value="URGENT">긴급</option><option value="HIGH">높음</option><option value="NORMAL">보통</option><option value="LOW">낮음</option></select></label>
                <label><span>마감일</span><select value={taskDeadlineFilter} onChange={(event) => setTaskDeadlineFilter(event.target.value as typeof taskDeadlineFilter)}><option value="ALL">모든 마감일</option><option value="OVERDUE">기한 초과</option><option value="TODAY">오늘 마감</option><option value="WEEK">7일 이내</option><option value="NO_DATE">마감일 없음</option></select></label>
                <span className="task-filter-count">{filteredProjectTasks.length}/{projectTasks.length}개 표시</span>
                <button type="button" className="task-filter-reset" onClick={() => { setTaskSearch(''); setTaskAssigneeFilter('ALL'); setTaskPriorityFilter('ALL'); setTaskDeadlineFilter('ALL') }} disabled={!taskSearch && taskAssigneeFilter === 'ALL' && taskPriorityFilter === 'ALL' && taskDeadlineFilter === 'ALL'}>필터 초기화</button>
              </div>
              {!isProjectReadOnly && <form className="project-task-form" onSubmit={createProjectTask}>
                <label>할 일<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} required maxLength={160} placeholder="예: Google Sheets에서 데이터를 읽기" disabled={projectBusy || projectTasks.length >= 200} /></label>
                <label>설명<textarea value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} maxLength={2000} rows={2} placeholder="필요한 내용을 간단히 적어 주세요." disabled={projectBusy || projectTasks.length >= 200} /></label>
                <label>담당자<select value={taskAssigneeId} onChange={(event) => setTaskAssigneeId(event.target.value)} disabled={projectBusy}><option value="">담당자 없음</option>{projectMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email}</option>)}</select></label>
                <label>우선순위<select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as ProjectTaskPriority)} disabled={projectBusy}><option value="LOW">낮음</option><option value="NORMAL">보통</option><option value="HIGH">높음</option><option value="URGENT">긴급</option></select></label>
                <label>마감일<input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} disabled={projectBusy} /></label>
                <button type="submit" className="primary-button" disabled={projectBusy || !taskTitle.trim() || projectTasks.length >= 200}>{projectBusy ? '저장 중…' : '작업 추가'}</button>
              </form>}
              {projectTasks.length >= 200 && <p className="task-limit-note">작업은 프로젝트당 200개까지 만들 수 있습니다.</p>}
              <div className="project-task-columns">
                {taskColumns.map((column) => {
                  const columnTasks = filteredProjectTasks
                    .filter((task) => task.status === column.status)
                    .sort((left, right) => taskPriorityOrder[left.priority] - taskPriorityOrder[right.priority]
                      || (left.due_date ?? '9999-12-31').localeCompare(right.due_date ?? '9999-12-31')
                      || right.updated_at.localeCompare(left.updated_at))
                  return <section className={`project-task-column project-task-column-${column.status.toLocaleLowerCase()}`} key={column.status}>
                    <h3>{column.label}<span>{columnTasks.length}</span></h3>
                    {columnTasks.length ? columnTasks.map((task) => {
                      const assignee = projectMembers.find((member) => member.user_id === task.assignee_id)
                      const editor = projectMembers.find((member) => member.user_id === task.updated_by)
                      return <article className="project-task-card" id={`project-task-${task.id}`} key={task.id}>
                        <div className="project-task-card-title"><strong>{task.title}</strong>{!isProjectReadOnly && <div className="project-task-card-actions"><button type="button" onClick={() => beginTaskEdit(task)} disabled={projectBusy} aria-label={`${task.title} 작업 수정`} title="작업 수정">✎</button><button type="button" className="project-task-delete" onClick={() => void deleteProjectTask(task)} disabled={projectBusy} aria-label={`${task.title} 작업 삭제`} title="작업 삭제">×</button></div>}</div>
                        <div className={`project-task-priority project-task-priority-${task.priority.toLowerCase()}`}>{({ LOW: '낮은 우선순위', NORMAL: '보통 우선순위', HIGH: '높은 우선순위', URGENT: '긴급' } as const)[task.priority]}</div>
                        {task.due_date && <small className={task.status !== 'DONE' && task.due_date < localToday() ? 'project-task-overdue' : 'project-task-due'}>마감 {new Date(`${task.due_date}T00:00:00`).toLocaleDateString('ko-KR')}</small>}
                        {task.description && <p>{task.description}</p>}
                        {editingTaskId === task.id && !isProjectReadOnly && <form className="project-task-edit-form" onSubmit={(event) => void saveTaskEdit(task, event)}>
                          <label>작업 이름<input value={editingTaskTitle} onChange={(event) => setEditingTaskTitle(event.target.value)} required maxLength={160} disabled={projectBusy} /></label>
                          <label>설명<textarea value={editingTaskDescription} onChange={(event) => setEditingTaskDescription(event.target.value)} maxLength={2000} rows={3} disabled={projectBusy} /></label>
                          <label>우선순위<select value={editingTaskPriority} onChange={(event) => setEditingTaskPriority(event.target.value as ProjectTaskPriority)} disabled={projectBusy}><option value="LOW">낮음</option><option value="NORMAL">보통</option><option value="HIGH">높음</option><option value="URGENT">긴급</option></select></label>
                          <label>마감일<input type="date" value={editingTaskDueDate} onChange={(event) => setEditingTaskDueDate(event.target.value)} disabled={projectBusy} /></label>
                          <div><button type="submit" className="primary-button" disabled={projectBusy || !editingTaskTitle.trim()}>변경 저장</button><button type="button" className="secondary-button" onClick={() => setEditingTaskId(null)} disabled={projectBusy}>취소</button></div>
                        </form>}
                        <small>{assignee ? `담당: ${assignee.display_name || assignee.email}` : '담당자 없음'}</small>
                        <small>{editor ? `${editor.display_name || editor.email} 수정 · ` : ''}{new Date(task.updated_at).toLocaleDateString('ko-KR')}</small>
                        <div className="project-task-card-controls">
                          <select aria-label={`${task.title} 진행 상태`} value={task.status} onChange={(event) => void updateProjectTask(task, { status: event.target.value as ProjectTaskStatus })} disabled={projectBusy || isProjectReadOnly}>{taskColumns.map((item) => <option key={item.status} value={item.status}>{item.label}</option>)}</select>
                          <select aria-label={`${task.title} 담당자`} value={task.assignee_id ?? ''} onChange={(event) => void updateProjectTask(task, { assignee_id: event.target.value || null })} disabled={projectBusy || isProjectReadOnly}><option value="">담당자 없음</option>{projectMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email}</option>)}</select>
                        </div>
                        <button type="button" className="task-discussion-toggle" aria-expanded={openTaskDiscussionId === task.id} onClick={() => void toggleTaskDiscussion(task)}>
                          {openTaskDiscussionId === task.id ? '세부 항목·댓글·기록 접기' : `세부 항목·댓글·기록 보기${taskChecklists[task.id]?.length ? ` · 체크 ${taskChecklists[task.id].filter((item) => item.completed).length}/${taskChecklists[task.id].length}` : ''}${taskDiscussions[task.id]?.comments.length ? ` · 댓글 ${taskDiscussions[task.id].comments.length}` : ''}`}
                        </button>
                        {openTaskDiscussionId === task.id && <div className="task-discussion-panel">
                          <section className="task-checklist-section">
                            <div className="task-checklist-heading"><h4>체크리스트</h4><span>{taskChecklists[task.id]?.filter((item) => item.completed).length ?? 0}/{taskChecklists[task.id]?.length ?? 0} 완료</span></div>
                            {taskChecklists[task.id]?.length ? <ul className="task-checklist-list">{taskChecklists[task.id].map((item) => <li key={item.id} className={item.completed ? 'task-checklist-completed' : ''}><label><input type="checkbox" checked={item.completed} onChange={() => void toggleTaskChecklistItem(task, item)} disabled={isProjectReadOnly || taskChecklistBusyId === item.id || taskChecklistBusyId === task.id} /><span>{item.text}</span></label>{!isProjectReadOnly && <button type="button" aria-label={`체크 항목 삭제: ${item.text}`} title="체크 항목 삭제" onClick={() => void deleteTaskChecklistItem(task, item)} disabled={taskChecklistBusyId === item.id}>×</button>}</li>)}</ul> : <p className="task-discussion-empty">큰 작업을 작은 단계로 나눠 적어 보세요.</p>}
                            {!isProjectReadOnly && <form className="task-checklist-form" onSubmit={(event) => void addTaskChecklistItem(task, event)}><input aria-label="새 체크 항목" value={taskChecklistDrafts[task.id] ?? ''} onChange={(event) => setTaskChecklistDrafts((current) => ({ ...current, [task.id]: event.target.value }))} maxLength={240} placeholder="예: API 요청 흐름 확인" disabled={taskChecklistBusyId === task.id || (taskChecklists[task.id]?.length ?? 0) >= 30} /><button type="submit" disabled={taskChecklistBusyId === task.id || !(taskChecklistDrafts[task.id] ?? '').trim() || (taskChecklists[task.id]?.length ?? 0) >= 30}>항목 추가</button></form>}
                            {(taskChecklists[task.id]?.length ?? 0) >= 30 && <small className="task-checklist-limit">체크 항목은 작업마다 최대 30개입니다.</small>}
                          </section>
                          {!isProjectReadOnly ? <form className="task-comment-form" onSubmit={(event) => void submitTaskComment(task, event)}><label htmlFor={`task-comment-${task.id}`}>팀원에게 남길 댓글</label><textarea id={`task-comment-${task.id}`} value={taskCommentDrafts[task.id] ?? ''} onChange={(event) => setTaskCommentDrafts((current) => ({ ...current, [task.id]: event.target.value }))} maxLength={2000} rows={2} placeholder="진행 상황, 질문, 결정 사항을 적어 주세요." disabled={taskCommentBusy} /><button type="submit" disabled={taskCommentBusy || !(taskCommentDrafts[task.id] ?? '').trim()}>{taskCommentBusy ? '등록 중…' : '댓글 등록'}</button></form> : <p className="task-discussion-empty">보기 전용 권한은 댓글을 읽을 수만 있습니다.</p>}
                          <div className="task-discussion-columns">
                            <section><h4>댓글</h4>{taskDiscussions[task.id]?.comments.length ? <ol className="task-comment-list">{taskDiscussions[task.id].comments.map((comment) => <li key={comment.id}><div><strong>{comment.author_name}</strong><time>{new Date(comment.created_at).toLocaleString('ko-KR')}</time></div><p>{comment.body}</p></li>)}</ol> : <p className="task-discussion-empty">아직 댓글이 없습니다.</p>}</section>
                            <section><h4>활동 기록</h4>{taskDiscussions[task.id]?.activities.length ? <ol className="task-activity-list">{taskDiscussions[task.id].activities.map((activity) => <li key={activity.id}><strong>{activity.actor_name}</strong> {activity.message}<time>{new Date(activity.created_at).toLocaleString('ko-KR')}</time></li>)}</ol> : <p className="task-discussion-empty">아직 기록이 없습니다.</p>}</section>
                          </div>
                        </div>}
                      </article>
                    }) : <p className="project-task-empty">{projectTasks.length && filteredProjectTasks.length === 0 ? '검색 조건에 맞는 작업이 없습니다.' : '작업 없음'}</p>}
                  </section>
                })}
              </div>
            </section>
            {runResult && <section className="run-output" aria-live="polite" hidden={workspaceSection !== 'code'}>
              <div className="run-output-heading"><strong>실행 결과 · {runResult.status}</strong><button type="button" className="run-output-close" onClick={() => setRunResult(null)} disabled={projectBusy} aria-label="실행 결과 닫기" title="닫기">×</button></div>
              <p><b>예상</b> 코드를 실행하면 의도한 결과가 나와야 합니다.</p><p><b>실제 출력</b></p><pre>{runResult.stdout || '(출력 없음)'}</pre><p><b>오류</b></p><pre>{runResult.stderr || (runResult.failure_category ? `실패 유형: ${runResult.failure_category}` : '(오류 없음)')}</pre><p><b>종료 코드</b> {runResult.exit_code ?? '실행 중'}</p>
              {runResult.status === 'FAILED' && <form className="debug-notes" onSubmit={saveDebugNotes}><h3>오류를 되짚어 보기</h3><p className="debug-explainer">실행 오류를 보고 예상 결과와 원인에 대한 생각을 적어 두면, 이 실행에 연결해 저장하고 나중에 이어서 볼 수 있어요.</p><label>어떤 결과를 예상했나요?<textarea value={expectedOutput} onChange={(event) => setExpectedOutput(event.target.value)} rows={2} maxLength={16384} /></label><label>왜 이런 결과가 나왔다고 생각하나요?<textarea value={debugHypothesis} onChange={(event) => setDebugHypothesis(event.target.value)} rows={3} required maxLength={4000} placeholder="오류가 난 이유를 추측해서 적어 보세요." /></label><p className="ai-privacy-note">AI 힌트를 요청하면 main.py 일부, 실행 오류, 예상 결과와 가설이 AI 제공자에게 전달됩니다. 코드는 대신 고치지 않아요.</p><div className="debug-actions"><button className="secondary-button" type="submit" disabled={projectBusy || aiBusy || !debugHypothesis.trim()}>{debugSaved ? '디버깅 기록 업데이트' : '디버깅 기록 저장'}</button><button className="primary-button" type="button" onClick={requestDebugHint} disabled={projectBusy || aiBusy || !debugHypothesis.trim()}>{aiBusy ? '힌트를 생각하고 있어요…' : 'AI 디버깅 힌트'}</button></div>{debugSaved && <span role="status">이 실행에 대한 디버깅 기록을 저장했어요.</span>}{debugHint && <div className="ai-hint" role="status"><strong>{debugHint.summary}</strong><p>{debugHint.hint}</p><em>{debugHint.next_question}</em></div>}</form>}
            </section>}
            <div className="workspace-grid" hidden={workspaceSection !== 'code'}>
              <aside className="file-panel">
                <div className="file-panel-heading"><p className="panel-label">파일 탐색기</p><button type="button" className="file-drive-import-button" onClick={() => void addGoogleDriveFilesToProject()} disabled={projectBusy || isProjectReadOnly}>Drive에서 추가</button><button type="button" className="file-add-button" onClick={() => { setNewEntryPath(''); setNewEntryKind('auto'); setShowNewEntryForm((current) => !current) }} disabled={projectBusy || isProjectReadOnly} aria-label="새 파일 또는 폴더 만들기" title="새 파일 또는 폴더 만들기">＋</button></div>
                <ProjectFileTree tree={projectFileTree} selectedPath={selectedPath} busy={projectBusy || isProjectReadOnly} onOpen={openProjectFile} onRename={(path) => void renameProjectFile(path)} onDelete={(path) => void deleteProjectFile(path)} onRenameFolder={(path) => void renameProjectFolder(path)} onDeleteFolder={(path) => void deleteProjectFolder(path)} onMoveFile={(path, folder) => void moveProjectFileToFolder(path, folder)} onImportFiles={(items, folder) => void importDroppedFiles(items, folder)} />
                {showNewEntryForm && <form className="new-entry-form" onSubmit={createProjectEntry}>
                  <label>파일 또는 폴더 경로<input autoFocus value={newEntryPath} onChange={(event) => setNewEntryPath(event.target.value)} placeholder="예: src/main.py 또는 src" required maxLength={240} /></label>
                  <label>항목 종류<select value={newEntryKind} onChange={(event) => setNewEntryKind(event.target.value as NewProjectEntryKind)}><option value="auto">자동 판단{newEntryPath.trim() ? ` · ${inferProjectEntryKind(newEntryPath) === 'file' ? '파일' : '폴더'}` : ''}</option><option value="file">파일</option><option value="folder">폴더</option></select></label>
                  <p>이름에 확장자가 있으면 파일, 없으면 폴더로 추정합니다. 이름만으로 판단하기 어려우면 종류를 직접 선택하세요.</p>
                  <button type="submit" className="primary-button" disabled={projectBusy || isProjectReadOnly}>{projectBusy ? '만드는 중…' : '만들기'}</button>
                </form>}
                <p className="panel-label revision-label">저장한 버전</p>
                {projectVersions.length ? projectVersions.map((version) => {
                  const creator = projectMembers.find((member) => member.user_id === version.created_by)
                  const creatorName = version.created_by === user?.id ? '나' : creator?.display_name || creator?.email || '이전 팀원'
                  return <div className="saved-version-row" key={version.id}><strong>v{version.version_number} · {version.name}</strong><small>{creatorName} 저장 · Python {version.runtime_spec.version} · {new Date(version.created_at).toLocaleDateString('ko-KR')}</small><div><button type="button" onClick={() => viewProjectVersion(version.id)} disabled={projectBusy}>보기</button><button type="button" onClick={() => restoreProjectVersion(version.id)} disabled={projectBusy || isProjectReadOnly}>복원</button><button className="delete-version-button" type="button" onClick={() => deleteSavedVersion(version)} disabled={projectBusy || isProjectReadOnly}>삭제</button></div></div>
                }) : <p className="revision-empty">저장한 버전이 없습니다.</p>}
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
                  {selectedPath ? <Suspense fallback={<div className="editor-empty">VS Code 편집기를 불러오는 중…</div>}><MonacoCodeEditor path={selectedPath} value={workspace.files.find((file) => file.path === selectedPath)?.content ?? ''} readOnly={projectBusy || isProjectReadOnly} onChange={(value) => updateProjectFile(value)} /></Suspense> : <div className="editor-empty">왼쪽에서 파일을 선택하거나 새 파일을 추가하세요.</div>}
                </div>
                <div className="editor-statusbar"><span>WebLink 편집기</span><span>{selectedPath ? editorLanguage(selectedPath) : '일반 텍스트'}</span><span>Ctrl+S 저장 · Ctrl+Enter 실행 · Ctrl+F 찾기 · Ctrl+W 탭 닫기</span></div>
              </section>
            </div>
            {versionPreview && <section className="version-preview" hidden={workspaceSection !== 'code'}><div><strong>v{versionPreview.version_number} · {versionPreview.name}</strong><button className="back-link" type="button" onClick={() => setVersionPreview(null)}>닫기</button></div><p>{versionPreview.description || `리비전 ${workspace.revisions.find((item) => item.id === versionPreview.source_revision_id)?.revision_number ?? ''}에서 저장한 읽기 전용 버전`}</p>{versionPreview.files.map((file) => <details key={file.path}><summary>{file.path}</summary><pre>{file.content}</pre></details>)}</section>}
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
      <button className="auth-home-link" type="button" onClick={() => setShowLanding(true)}>← WebLink 홈</button>
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
