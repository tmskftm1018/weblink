import type { ProjectFile } from './projects'

const MAX_FILES = 50
const MAX_FILE_BYTES = 200_000
const MAX_TOTAL_BYTES = 1_000_000
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build'])

type DroppedEntry = {
  name: string
  isFile: boolean
  isDirectory: boolean
  file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void
  createReader: () => { readEntries: (success: (entries: DroppedEntry[]) => void, failure?: (error: DOMException) => void) => void }
}

type DataTransferItemWithEntry = {
  webkitGetAsEntry?: () => DroppedEntry | null
}

export type DroppedProjectContents = {
  files: ProjectFile[]
  emptyFolders: string[]
  skippedSensitiveFiles: number
}

function isSensitive(path: string): boolean {
  const filename = path.split('/').pop()?.toLocaleLowerCase() ?? ''
  return filename === '.env'
    || (filename.startsWith('.env.') && filename !== '.env.example')
    || ['id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'].includes(filename)
    || /\.(pem|key|p12|pfx)$/i.test(filename)
}

function readEntryFile(entry: DroppedEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function readDirectoryEntries(entry: DroppedEntry): Promise<DroppedEntry[]> {
  const reader = entry.createReader()
  const children: DroppedEntry[] = []
  while (true) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) return children
    children.push(...batch)
  }
}

export async function readDroppedProjectItems(items: DataTransferItem[]): Promise<DroppedProjectContents> {
  const files: ProjectFile[] = []
  const emptyFolders: string[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let totalBytes = 0
  let skippedSensitiveFiles = 0

  function validatePath(path: string) {
    const parts = path.split('/')
    if (!path || path.length > 240 || path.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..' || part.toLocaleLowerCase() === '.git')) {
      throw new Error(`안전하지 않은 파일 경로입니다: ${path}`)
    }
  }

  async function addFile(file: File, path: string) {
    validatePath(path)
    if (isSensitive(path)) {
      skippedSensitiveFiles += 1
      return
    }
    if (path.split('/').pop()?.toLocaleLowerCase() === '.gitkeep') {
      skippedSensitiveFiles += 1
      return
    }
    if (file.size > MAX_FILE_BYTES || totalBytes + file.size > MAX_TOTAL_BYTES || files.length + emptyFolders.length >= MAX_FILES) {
      throw new Error('가져올 파일은 UTF-8 텍스트 50개, 파일당 200KB, 전체 1MB까지 지원합니다.')
    }
    let content: string
    try {
      content = decoder.decode(await file.arrayBuffer())
    } catch {
      throw new Error(`‘${path}’은 UTF-8 텍스트가 아니어서 가져올 수 없습니다.`)
    }
    files.push({ path, content })
    totalBytes += file.size
  }

  async function walk(entry: DroppedEntry, parentPath = ''): Promise<void> {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name
    if (entry.isFile) {
      await addFile(await readEntryFile(entry), path)
      return
    }
    if (!entry.isDirectory) return
    if (IGNORED_DIRECTORIES.has(entry.name.toLocaleLowerCase())) return
    validatePath(path)
    const startCount = files.length + emptyFolders.length
    const children = await readDirectoryEntries(entry)
    for (const child of children) await walk(child, path)
    if (files.length + emptyFolders.length === startCount) {
      if (files.length + emptyFolders.length >= MAX_FILES) throw new Error('가져올 파일과 빈 폴더는 합쳐 50개까지 지원합니다.')
      emptyFolders.push(path)
    }
  }

  for (const item of items) {
    if (item.kind !== 'file') continue
    const entry = (item as unknown as DataTransferItemWithEntry).webkitGetAsEntry?.()
    if (entry) {
      await walk(entry)
      continue
    }
    const file = item.getAsFile()
    if (file) await addFile(file, file.name)
  }

  if (!files.length && !emptyFolders.length) {
    if (skippedSensitiveFiles) throw new Error('가져올 수 있는 파일이 없어요. 비밀 파일은 가져오지 않습니다.')
    throw new Error('가져올 파일이나 폴더를 읽지 못했습니다. Chrome 또는 Edge에서 다시 끌어 놓아 주세요.')
  }
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), emptyFolders, skippedSensitiveFiles }
}
