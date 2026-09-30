import { ProjectFile } from './projects'

const DATABASE_NAME = 'weblink-local-projects'
const DATABASE_VERSION = 1
const STORE_NAME = 'directory-bindings'
const MAX_FILES = 50
const MAX_FILE_BYTES = 200_000
const MAX_TOTAL_BYTES = 1_000_000
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build'])

export type ProjectDirectory = FileSystemDirectoryHandle

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}

type DirectoryEntries = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>
}

type DirectoryPermissionHandle = FileSystemDirectoryHandle & {
  queryPermission: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'projectId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('이 브라우저에서 로컬 폴더 연결을 저장하지 못했습니다.'))
  })
}

async function readBinding(projectId: string): Promise<ProjectDirectory | null> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(projectId)
      request.onsuccess = () => resolve((request.result?.directory as FileSystemDirectoryHandle | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('연결된 폴더를 확인하지 못했습니다.'))
    })
  } finally {
    db.close()
  }
}

async function storeBinding(projectId: string, directory: ProjectDirectory): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put({ projectId, directory })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('폴더 연결을 저장하지 못했습니다.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('폴더 연결이 취소되었습니다.'))
    })
  } finally {
    db.close()
  }
}

async function ensurePermission(directory: ProjectDirectory): Promise<void> {
  const descriptor = { mode: 'readwrite' as const }
  const permissionHandle = directory as DirectoryPermissionHandle
  if (await permissionHandle.queryPermission(descriptor) === 'granted') return
  if (await permissionHandle.requestPermission(descriptor) !== 'granted') {
    throw new Error('프로젝트 폴더의 읽기·쓰기 권한이 필요합니다. 폴더 연결을 다시 선택해 주세요.')
  }
}

function isSensitive(path: string): boolean {
  const segments = path.split('/')
  const filename = segments[segments.length - 1]?.toLowerCase() ?? ''
  return filename === '.env'
    || (filename.startsWith('.env.') && filename !== '.env.example')
    || ['id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'].includes(filename)
    || /\.(pem|key|p12|pfx)$/i.test(filename)
}

function validatePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`안전하지 않은 파일 경로입니다: ${path}`)
  }
}

export async function chooseProjectDirectory(): Promise<ProjectDirectory> {
  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker
  if (!picker) throw new Error('로컬 폴더 연결은 최신 Chrome 또는 Edge에서 사용할 수 있어요. ZIP 가져오기·내보내기를 이용해 주세요.')
  return picker({ mode: 'readwrite' })
}

export async function getProjectDirectory(projectId: string): Promise<ProjectDirectory | null> {
  return readBinding(projectId)
}

export async function bindProjectDirectory(projectId: string, directory: ProjectDirectory): Promise<void> {
  await ensurePermission(directory)
  await storeBinding(projectId, directory)
}

export async function unbindProjectDirectory(projectId: string): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(projectId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('폴더 연결을 해제하지 못했습니다.'))
    })
  } finally {
    db.close()
  }
}

export async function readProjectDirectory(directory: ProjectDirectory): Promise<ProjectFile[]> {
  await ensurePermission(directory)
  const files: ProjectFile[] = []
  let totalBytes = 0
  const decoder = new TextDecoder('utf-8', { fatal: true })

  async function visit(current: FileSystemDirectoryHandle, parentPath = ''): Promise<void> {
    for await (const [name, handle] of (current as DirectoryEntries).entries()) {
      if (handle.kind === 'directory') {
        if (IGNORED_DIRECTORIES.has(name.toLowerCase())) continue
        await visit(handle as FileSystemDirectoryHandle, parentPath ? `${parentPath}/${name}` : name)
        continue
      }
      const path = parentPath ? `${parentPath}/${name}` : name
      validatePath(path)
      if (isSensitive(path)) continue
      const file = await (handle as FileSystemFileHandle).getFile()
      if (file.size > MAX_FILE_BYTES || totalBytes + file.size > MAX_TOTAL_BYTES || files.length >= MAX_FILES) {
        throw new Error('폴더에서 가져올 파일은 UTF-8 텍스트 50개, 전체 1MB까지 지원합니다. .git, node_modules, 빌드 폴더와 비밀 파일은 제외됩니다.')
      }
      try {
        files.push({ path, content: decoder.decode(await file.arrayBuffer()) })
      } catch {
        throw new Error(`${path} 파일이 UTF-8 텍스트가 아니어서 가져올 수 없습니다.`)
      }
      totalBytes += file.size
    }
  }

  await visit(directory)
  if (!files.length) throw new Error('폴더에 가져올 UTF-8 텍스트 파일이 없습니다.')
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export async function writeProjectDirectory(directory: ProjectDirectory, files: ProjectFile[]): Promise<number> {
  await ensurePermission(directory)
  for (const file of files) {
    validatePath(file.path)
    if (file.path.split('/').some((segment) => segment.toLowerCase() === '.git')) {
      throw new Error('Git 저장소의 내부 메타데이터(.git)는 덮어쓸 수 없습니다. 프로젝트 전용 하위 폴더를 선택해 주세요.')
    }
  }
  const safeFiles = files.filter((file) => !isSensitive(file.path))
  if (safeFiles.length > MAX_FILES || safeFiles.some((file) => new TextEncoder().encode(file.content).byteLength > MAX_FILE_BYTES)
    || safeFiles.reduce((sum, file) => sum + new TextEncoder().encode(file.content).byteLength, 0) > MAX_TOTAL_BYTES) {
    throw new Error('로컬 폴더에는 UTF-8 텍스트 파일 50개, 전체 1MB까지 저장할 수 있습니다.')
  }

  for (const file of safeFiles) {
    const segments = file.path.split('/')
    let current = directory
    for (const segment of segments.slice(0, -1)) current = await current.getDirectoryHandle(segment, { create: true })
    const target = await current.getFileHandle(segments[segments.length - 1]!, { create: true })
    const writable = await target.createWritable()
    await writable.write(file.content)
    await writable.close()
  }
  return files.length - safeFiles.length
}

export async function removeProjectFileFromDirectory(directory: ProjectDirectory, path: string): Promise<void> {
  await ensurePermission(directory)
  validatePath(path)
  const segments = path.split('/')
  if (segments.some((segment) => segment.toLowerCase() === '.git')) {
    throw new Error('Git 저장소 내부 파일은 WebLink에서 삭제할 수 없습니다.')
  }
  let current = directory
  for (const segment of segments.slice(0, -1)) {
    try {
      current = await current.getDirectoryHandle(segment)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'NotFoundError') return
      throw cause
    }
  }
  try {
    const filename = segments[segments.length - 1]!
    await current.getFileHandle(filename)
    await current.removeEntry(filename)
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'NotFoundError') return
    throw cause
  }
}

export async function removeEmptyProjectDirectoryFromDirectory(directory: ProjectDirectory, path: string): Promise<void> {
  validatePath(path)
  if (path.split('/').some((segment) => segment.toLowerCase() === '.git')) {
    throw new Error('Git 저장소 내부 폴더는 WebLink에서 삭제할 수 없습니다.')
  }
  await ensurePermission(directory)
  const chain: Array<{ parent: FileSystemDirectoryHandle; name: string }> = []
  let current = directory
  for (const name of path.split('/')) {
    const parent = current
    try {
      current = await parent.getDirectoryHandle(name)
    } catch (cause) {
      if (cause instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(cause.name)) return
      throw cause
    }
    chain.push({ parent, name })
  }
  for (const { parent, name } of chain.reverse()) {
    try {
      await parent.removeEntry(name)
    } catch (cause) {
      if (cause instanceof DOMException && ['NotFoundError', 'InvalidModificationError'].includes(cause.name)) continue
      throw cause
    }
  }
}

export async function moveProjectFileInDirectory(
  directory: ProjectDirectory,
  oldPath: string,
  newPath: string,
  content: string,
): Promise<void> {
  validatePath(oldPath)
  validatePath(newPath)
  if (isSensitive(oldPath) || isSensitive(newPath)) {
    throw new Error('비밀 파일 경로는 WebLink에서 이름을 바꿀 수 없습니다.')
  }
  if ([oldPath, newPath].some((path) => path.split('/').some((segment) => segment.toLowerCase() === '.git'))) {
    throw new Error('Git 저장소 내부 파일은 WebLink에서 이름을 바꿀 수 없습니다.')
  }
  await ensurePermission(directory)
  const destinationParts = newPath.split('/')
  let destinationDirectory = directory
  for (const segment of destinationParts.slice(0, -1)) {
    try {
      destinationDirectory = await destinationDirectory.getDirectoryHandle(segment)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'NotFoundError') {
        destinationDirectory = await directory.getDirectoryHandle(destinationParts[0]!, { create: true })
        for (const parent of destinationParts.slice(1, -1)) {
          destinationDirectory = await destinationDirectory.getDirectoryHandle(parent, { create: true })
        }
        break
      }
      throw cause
    }
  }
  try {
    await destinationDirectory.getFileHandle(destinationParts[destinationParts.length - 1]!)
    throw new Error(`연결된 폴더에 ${newPath} 파일이 이미 있어 덮어쓰지 않았습니다.`)
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('연결된 폴더에 ')) throw cause
    if (!(cause instanceof DOMException) || !['NotFoundError', 'TypeMismatchError'].includes(cause.name)) throw cause
    if (cause.name === 'TypeMismatchError') throw new Error(`연결된 폴더에 ${newPath} 경로가 이미 있어 이름을 바꾸지 않았습니다.`)
  }
  const excluded = await writeProjectDirectory(directory, [{ path: newPath, content }])
  if (excluded) throw new Error('비밀 파일 경로는 프로젝트 파일 이름으로 사용할 수 없습니다.')
  await removeProjectFileFromDirectory(directory, oldPath)
}

export async function moveProjectFilesInDirectory(
  directory: ProjectDirectory,
  moves: Array<{ oldPath: string; newPath: string; content: string }>,
): Promise<void> {
  if (!moves.length) return
  await ensurePermission(directory)
  const sourcePaths = new Set(moves.map((move) => move.oldPath.toLocaleLowerCase()))
  const targetPaths = new Set<string>()
  for (const move of moves) {
    validatePath(move.oldPath)
    validatePath(move.newPath)
    if (isSensitive(move.oldPath) || isSensitive(move.newPath)) throw new Error('비밀 파일 경로는 WebLink에서 이름을 바꿀 수 없습니다.')
    if ([move.oldPath, move.newPath].some((path) => path.split('/').some((segment) => segment.toLowerCase() === '.git'))) {
      throw new Error('Git 저장소 내부 파일은 WebLink에서 이름을 바꿀 수 없습니다.')
    }
    const normalizedTarget = move.newPath.toLocaleLowerCase()
    if (targetPaths.has(normalizedTarget)) throw new Error(`이동 후 파일 경로가 겹칩니다: ${move.newPath}`)
    targetPaths.add(normalizedTarget)
    if (normalizedTarget === move.oldPath.toLocaleLowerCase()) throw new Error('대소문자만 바꾸는 이름 변경은 아직 지원하지 않습니다.')
  }
  for (const move of moves) {
    if (sourcePaths.has(move.newPath.toLocaleLowerCase())) throw new Error(`이동 대상이 현재 프로젝트 파일과 겹칩니다: ${move.newPath}`)
    const segments = move.newPath.split('/')
    let current = directory
    let parentMissing = false
    for (const segment of segments.slice(0, -1)) {
      try {
        current = await current.getDirectoryHandle(segment)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'NotFoundError') {
          parentMissing = true
          break
        }
        if (cause instanceof DOMException && cause.name === 'TypeMismatchError') {
          throw new Error(`연결된 폴더에 ${move.newPath} 경로가 이미 있어 이름을 바꾸지 않았습니다.`)
        }
        throw cause
      }
    }
    if (parentMissing) continue
    try {
      await current.getFileHandle(segments[segments.length - 1]!)
      throw new Error(`연결된 폴더에 ${move.newPath} 파일이 이미 있어 덮어쓰지 않았습니다.`)
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('연결된 폴더에 ')) throw cause
      if (!(cause instanceof DOMException) || !['NotFoundError', 'TypeMismatchError'].includes(cause.name)) throw cause
      if (cause.name === 'TypeMismatchError') throw new Error(`연결된 폴더에 ${move.newPath} 경로가 이미 있어 이름을 바꾸지 않았습니다.`)
    }
  }
  await writeProjectDirectory(directory, moves.map((move) => ({ path: move.newPath, content: move.content })))
  for (const move of moves) await removeProjectFileFromDirectory(directory, move.oldPath)
}
