import { useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { ProjectFile } from '../services/projects'

export type ProjectFileTreeNode = {
  name: string
  path: string
  folders: Map<string, ProjectFileTreeNode>
  files: ProjectFile[]
}

export function buildProjectFileTree(files: ProjectFile[]): ProjectFileTreeNode {
  const root: ProjectFileTreeNode = { name: '', path: '', folders: new Map(), files: [] }
  for (const file of files) {
    const segments = file.path.split('/')
    const filename = segments.pop()
    if (!filename) continue
    let current = root
    for (const segment of segments) {
      let folder = current.folders.get(segment)
      if (!folder) {
        folder = { name: segment, path: current.path ? `${current.path}/${segment}` : segment, folders: new Map(), files: [] }
        current.folders.set(segment, folder)
      }
      current = folder
    }
    current.files.push(file)
  }
  return root
}

type Props = {
  tree: ProjectFileTreeNode
  selectedPath: string
  busy: boolean
  onOpen: (path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onRenameFolder: (path: string) => void
  onDeleteFolder: (path: string) => void
  onMoveFile: (filePath: string, folderPath: string) => void
  onImportFiles: (items: DataTransferItem[], folderPath: string) => void
}

function ProjectFileTree({ tree, selectedPath, busy, onOpen, onRename, onDelete, onRenameFolder, onDeleteFolder, onMoveFile, onImportFiles }: Props) {
  const folders = [...tree.folders.values()].sort((left, right) => left.name.localeCompare(right.name))
  const files = [...tree.files].sort((left, right) => left.path.localeCompare(right.path))
  const contents = <>
    {folders.map((folder) => <FolderRow key={folder.path} folder={folder} selectedPath={selectedPath} busy={busy} onOpen={onOpen} onRename={onRename} onDelete={onDelete} onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} onMoveFile={onMoveFile} onImportFiles={onImportFiles} />)}
    {files.filter((file) => !file.path.endsWith('/.gitkeep') && file.path !== '.gitkeep').map((file) => <div className="file-entry" key={file.path}>
      <button className={`file-row ${selectedPath === file.path ? 'active' : ''}`} type="button" draggable={!busy} onDragStart={(event) => {
        event.dataTransfer.setData('application/x-weblink-project-file', file.path)
        event.dataTransfer.effectAllowed = 'move'
      }} onClick={() => onOpen(file.path)} title={`${file.path} · 폴더나 프로젝트 루트로 끌어 이동`}>
        <span aria-hidden="true">{file.path.endsWith('.py') ? '🐍' : '▤'}</span><span className="file-row-path">{file.path.split('/').pop()}</span>
      </button>
      <div className="file-entry-actions">
        <button type="button" onClick={() => onRename(file.path)} disabled={busy} aria-label={`${file.path} 이름 바꾸기`} title="이름 바꾸기">✎</button>
        <button type="button" onClick={() => onDelete(file.path)} disabled={busy} aria-label={`${file.path} 삭제`} title="파일 삭제">×</button>
      </div>
    </div>)}
  </>
  if (tree.path) return contents
  return <RootDropZone busy={busy} onMoveFile={onMoveFile} onImportFiles={onImportFiles}>{contents}</RootDropZone>
}

function RootDropZone({ busy, onMoveFile, onImportFiles, children }: { busy: boolean; onMoveFile: Props['onMoveFile']; onImportFiles: Props['onImportFiles']; children: ReactNode }) {
  const [dragOver, setDragOver] = useState(false)
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (busy || (!event.dataTransfer.types.includes('application/x-weblink-project-file') && !event.dataTransfer.types.includes('Files'))) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (busy) return
    const internalFile = event.dataTransfer.types.includes('application/x-weblink-project-file')
    if (!internalFile && !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragOver(false)
    const path = internalFile ? event.dataTransfer.getData('application/x-weblink-project-file') : ''
    if (path) onMoveFile(path, '')
    else if (event.dataTransfer.items.length) onImportFiles([...event.dataTransfer.items], '')
  }
  return <div className={`project-file-root-drop${dragOver ? ' project-file-root-drop-active' : ''}`} onDragOver={handleDragOver} onDragLeave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false)
  }} onDrop={handleDrop}>
    <div className="project-file-root-label"><span>프로젝트 루트</span><small>폴더에서 꺼내거나 PC 파일·폴더를 가져오려면 여기로 끌어요</small></div>
    {children}
  </div>
}

function FolderRow({ folder, selectedPath, busy, onOpen, onRename, onDelete, onRenameFolder, onDeleteFolder, onMoveFile, onImportFiles }: Omit<Props, 'tree'> & { folder: ProjectFileTreeNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [dragOver, setDragOver] = useState(false)
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (busy || (!event.dataTransfer.types.includes('application/x-weblink-project-file') && !event.dataTransfer.types.includes('Files'))) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (busy) return
    const internalFile = event.dataTransfer.types.includes('application/x-weblink-project-file')
    if (!internalFile && !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
    const path = internalFile ? event.dataTransfer.getData('application/x-weblink-project-file') : ''
    if (path) {
      if (detailsRef.current) detailsRef.current.open = true
      onMoveFile(path, folder.path)
    } else if (event.dataTransfer.items.length) {
      if (detailsRef.current) detailsRef.current.open = true
      onImportFiles([...event.dataTransfer.items], folder.path)
    }
  }
  return <div className={`file-folder${dragOver ? ' file-folder-drop-target' : ''}`} onDragOver={handleDragOver} onDragLeave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false)
  }} onDrop={handleDrop}>
    <div className="file-folder-heading">
      <details ref={detailsRef}>
        <summary className="file-folder-summary" title={folder.path}>
          <span className="file-folder-caret" aria-hidden="true">›</span><span className="file-folder-icon" aria-hidden="true">▰</span><span className="file-folder-name">{folder.name}</span>
        </summary>
        <div className="file-folder-children"><ProjectFileTree tree={folder} selectedPath={selectedPath} busy={busy} onOpen={onOpen} onRename={onRename} onDelete={onDelete} onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} onMoveFile={onMoveFile} onImportFiles={onImportFiles} /></div>
      </details>
      <button type="button" className="folder-action-button" onClick={() => onRenameFolder(folder.path)} disabled={busy} aria-label={`${folder.path} 폴더 이름 변경`} title="폴더 이름 변경">✎</button>
      <button type="button" className="folder-delete-button" onClick={() => onDeleteFolder(folder.path)} disabled={busy} aria-label={`${folder.path} 폴더와 내용 삭제`} title="폴더와 안의 파일 삭제">×</button>
    </div>
  </div>
}

export default ProjectFileTree
