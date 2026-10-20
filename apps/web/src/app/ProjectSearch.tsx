import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ProjectFile } from '../services/projects'
import { ProjectSearchHit, ProjectSearchMode, searchProject } from '../services/projectSearch'

export default function ProjectSearch({ files, mode, focusToken, onMode, onClose, onOpen }: {
  files: ProjectFile[]; mode: ProjectSearchMode; focusToken: number
  onMode: (mode: ProjectSearchMode) => void; onClose: () => void; onOpen: (hit: ProjectSearchHit) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [pathFilter, setPathFilter] = useState('')
  const deferred = useDeferredValue(query)
  const deferredFiles = useDeferredValue(files)
  const searching = query !== deferred || files !== deferredFiles
  const result = useMemo(() => searchProject(deferredFiles, deferred, mode, caseSensitive, pathFilter), [deferredFiles, deferred, mode, caseSensitive, pathFilter])
  useEffect(() => { input.current?.focus(); input.current?.select() }, [focusToken, mode])
  return <section className="project-file-search" aria-label="프로젝트 내부 검색" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <div className="project-file-search__heading"><strong>프로젝트 검색</strong><button type="button" onClick={onClose} aria-label="프로젝트 검색 닫기">×</button></div>
    <div className="project-file-search__modes"><button type="button" aria-pressed={mode === 'files'} onClick={() => onMode('files')}>파일 찾기</button><button type="button" aria-pressed={mode === 'content'} onClick={() => onMode('content')}>내용 찾기</button></div>
    <label>{mode === 'files' ? '파일 경로에 포함된 글자' : '코드·문서에서 찾을 글자'}<input ref={input} type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder={mode === 'files' ? '예: main.py 또는 src/' : '예: fetch 또는 데이터베이스'} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && !searching && result.hits[0]) { event.preventDefault(); onOpen(result.hits[0]) }
    }} /></label>
    <label className="project-file-search__case"><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />대소문자 구분</label>
    {mode === 'content' && <label>파일 경로 필터<input value={pathFilter} maxLength={240} onChange={event => setPathFilter(event.target.value)} placeholder="예: src/ 또는 .py" /></label>}
    <p role="status">{searching ? '검색 중…' : mode === 'content' && !query ? '검색어를 입력하세요.' : `${result.hits.length}${mode === 'content' ? '줄' : '개 파일'}${result.truncated ? ' 초과 · 처음 200줄 표시' : ''}`}</p>
    <ul className="project-file-search__results">{result.hits.map(hit => <li key={`${hit.path}:${hit.line}`}><button type="button" disabled={searching} onClick={() => onOpen(hit)}><strong>{mode === 'content' ? `${hit.path}:${hit.line}` : hit.path}</strong>{mode === 'content' && <code>{hit.preview.slice(0, hit.start)}<mark>{hit.preview.slice(hit.start, hit.start + hit.length)}</mark>{hit.preview.slice(hit.start + hit.length)}</code>}</button></li>)}</ul>
    <small>현재 화면의 초안에서 글자 그대로 찾습니다. 내용 검색은 일치한 줄마다 첫 위치를 표시하며 서버나 외부 서비스로 검색어를 보내지 않습니다.</small>
  </section>
}
