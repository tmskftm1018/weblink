import { useEffect, useState } from 'react'
import { Course, Curriculum, LearningLevel, LearningPath, LearningWorkspace, learningService } from '../services/learning'
import LearningPathPanel from './LearningPathPanel'

export const learningStatusLabels: Record<string, string> = { NOT_STARTED: '시작 전', DRAFT: '작성 중', PASSED: '확인 완료', NEEDS_WORK: '다시 살펴보기', STALE: '수정 후 재확인 필요' }
export type LearningHomePage = 'home' | 'records'

type Props = {
  page: LearningHomePage
  catalogue: Curriculum
  workspace: LearningWorkspace
  currentId: string
  busy: boolean
  recovery: boolean
  pathProfile: LearningPath | null
  pathError: string
  onPathReload: () => void
  onPathSave: (level: LearningLevel | null) => void
  onPage: (page: LearningHomePage) => void
  onOpen: (id: string) => void
  onLegacy: (courseSlug?: string, lessonSlug?: string) => void
  onDownload: () => void
}

export default function LearningHome({ page, catalogue, workspace, currentId, busy, recovery, pathProfile, pathError, onPathReload, onPathSave, onPage, onOpen, onLegacy, onDownload }: Props) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [archive, setArchive] = useState<Course[] | null>(null)
  const [archiveError, setArchiveError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (page !== 'records') return
    let active = true
    setArchiveError(''); setArchive(null)
    void learningService.courses().then(items => { if (active) setArchive(items) }).catch(cause => {
      if (active) setArchiveError(cause instanceof Error ? cause.message : '이전 수업 기록을 불러오지 못했어요.')
    })
    return () => { active = false }
  }, [page, retry])
  const missions = workspace.missions
  const completed = missions.filter(item => item.status === 'PASSED').length
  const available = missions.filter(item => item.available).length
  const current = [...missions, ...workspace.foundations].find(item => item.id === currentId)
  const recommendedFoundations = (pathProfile?.foundation_ids ?? []).flatMap(id => {
    const item = workspace.foundations.find(foundation => foundation.id === id && foundation.status !== 'PASSED')
    return item ? [item] : []
  })
  const nextMission = missions.find(item => item.available && item.unlocked && item.status !== 'PASSED')
  const visible = missions.filter(item => (!query.trim() || `${item.id} ${item.title}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (filter === 'all' || (filter === 'completed' ? item.status === 'PASSED' : filter === 'review' ? ['NEEDS_WORK', 'STALE'].includes(item.status) : item.status === 'DRAFT')))
  const blocked = (id: string) => busy || (recovery && id !== currentId)
  const missionButton = (item: LearningWorkspace['missions'][number]) => <button key={item.id} className="learning-home__mission" disabled={blocked(item.id) || !item.available || !item.unlocked} onClick={() => onOpen(item.id)}><span><small>{item.id}</small><strong>{item.title}</strong></span><span>{!item.available ? '준비 중' : !item.unlocked ? '앞 미션 확인 후 열림' : learningStatusLabels[item.status] ?? '상태 확인 필요'}</span></button>
  return <>
    <header className="learning-studio__heading"><div><p className="learning-studio__kicker">나의 학습</p><h1>{page === 'home' ? '작은 실습에서 내 프로젝트까지' : '학습 기록'}</h1><p>{page === 'home' ? '화면을 만들고 API와 데이터베이스를 연결하며 배웁니다.' : '현재 과정과 이전 수업의 기록을 이곳에서 찾아보세요.'}</p></div></header>
    <nav className="learning-home__nav" aria-label="학습 공간"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => onPage('home')}>학습 홈</button><button aria-current={page === 'records' ? 'page' : undefined} onClick={() => onPage('records')}>학습 기록</button></nav>
    {recovery && <aside className="learning-studio__notice" role="status"><p>이전에 작성한 복구본이 남아 있어요. 해당 수업에서 내용을 비교한 뒤 다른 수업으로 이동할 수 있어요.</p><button disabled={busy} onClick={() => onOpen(currentId)}>작성 중인 수업의 복구본 확인</button></aside>}
    {page === 'home' ? <>
      <section className="learning-home__continue" aria-labelledby="learning-continue-title"><div><p className="learning-studio__kicker">{completed === available && available > 0 ? '배운 내용 다시 살펴보기' : '이어서 배우기'}</p><h2 id="learning-continue-title">{current ? `${current.id} · ${current.title}` : '작성 중인 기초 연습'}</h2><p>{catalogue.title}</p><button className="learning-studio__primary" disabled={busy} onClick={() => onOpen(currentId)}>{recovery ? '복구본 확인하고 이어 하기' : '수업 이어 하기'}</button></div><div className="learning-home__progress"><strong>{completed}<small> / {available}</small></strong><span>미션 확인 완료</span><progress aria-label="현재 과정 완료 진도" value={completed} max={Math.max(available, 1)} /></div></section>
      {pathProfile && <LearningPathPanel key={`${pathProfile.version}:${pathProfile.diagnostic_version}`} profile={pathProfile} busy={busy || recovery} onSave={onPathSave} onDiagnostic={() => onOpen('M01')} />}
      {pathError && <div className="learning-studio__error" role="alert"><p>{pathError}</p><button disabled={busy} onClick={onPathReload}>서버의 학습 경로 다시 불러오기</button><small>아직 저장하지 않은 경로 선택은 서버 설정으로 바뀝니다. 수업 답안은 유지됩니다.</small></div>}
      {!pathProfile && !pathError && <p role="status">나의 학습 경로를 불러오고 있어요…</p>}
      {pathProfile?.level && <section className="learning-path__recommendation"><h2>지금 추천하는 순서</h2>{recommendedFoundations.length ? <><p>아래 기초 연습을 살펴본 뒤 미션을 진행해 보세요. 이미 확인한 기초는 추천에서 빠집니다.</p><ol>{recommendedFoundations.map(item => <li key={item.id}><button disabled={blocked(item.id)} onClick={() => onOpen(item.id)}>{item.title}</button></li>)}</ol></> : <p>현재 추천된 기초 복습이 없어요. {nextMission ? `${nextMission.id} · ${nextMission.title}부터 이어 가세요.` : '확인한 미션을 다시 보거나 만든 프로젝트에 응용해 보세요.'}</p>}{nextMission && <button disabled={blocked(nextMission.id)} onClick={() => onOpen(nextMission.id)}>다음 미션 · {nextMission.id}</button>}<small>추천 순서이며 기초 연습은 선택입니다. 잠긴 미션은 기존 선수 조건을 완료하면 열려요.</small></section>}
      <section className="learning-home__section"><h2>만들며 배우는 웹 개발</h2><p>{catalogue.description}</p><div className="learning-home__units">{catalogue.units.map(unit => <section key={unit.id}><h3>{unit.title}</h3><div>{missions.filter(item => item.unit_id === unit.id).map(missionButton)}</div></section>)}</div></section>
      <details className="learning-home__section"><summary>필요할 때 꺼내 보는 기초 연습</summary><p>미션 진도와 별도로 연습합니다. 어려운 개념만 골라 복습하세요.</p><div className="learning-home__foundations">{workspace.foundations.map(item => <button key={item.id} disabled={blocked(item.id)} onClick={() => onOpen(item.id)}><strong>{item.title}</strong><small>{learningStatusLabels[item.status] ?? '시작 전'}</small></button>)}</div></details>
      <p className="learning-home__footnote">AI 도움은 선택입니다. 원하는 AI 웹사이트나 CLI를 직접 사용해도 되고, AI 없이 진행해도 됩니다.</p>
    </> : <>
      <section className="learning-home__section"><div className="learning-home__section-heading"><div><h2>현재 과정</h2><p>{catalogue.title} · {completed}/{available}개 확인 완료</p></div><button disabled={busy || recovery} onClick={onDownload}>현재 과정 기록·코드 내려받기</button></div><div className="learning-home__filters"><label>수업 찾기<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="미션 이름 또는 M01" /></label><label>학습 상태<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">전체</option><option value="inprogress">작성 중</option><option value="review">다시 확인할 미션</option><option value="completed">확인 완료</option></select></label></div><div className="learning-home__records">{visible.length ? visible.map(missionButton) : <p role="status">조건에 맞는 미션이 없어요.</p>}</div><small>수정한 답안은 재확인이 필요할 수 있어요. 실행 내역은 각 미션 안에서 확인합니다.</small></section>
      <section className="learning-home__section"><h2>이전 수업 보관함</h2><p>이전에 배운 블록 수업과 완료 기록입니다. 현재 과정의 진도와 별도로 보관하며, 필요한 수업을 다시 열 수 있어요.</p>{archiveError ? <div role="alert"><p>{archiveError}</p><button onClick={() => setRetry(value => value + 1)}>이전 기록 다시 불러오기</button></div> : archive === null ? <p role="status">이전 기록을 불러오고 있어요…</p> : !archive.length ? <p>보관된 이전 수업이 없어요.</p> : archive.map(course => <details className="learning-home__archive" key={course.slug}><summary>{course.title}<span>{course.completed_lessons}/{course.total_lessons}개 완료</span></summary><p>{course.description}</p><ul>{course.lessons.map(lesson => <li key={lesson.id}><button disabled={busy || recovery} onClick={() => onLegacy(course.slug, lesson.slug)}><span>{lesson.title}</span><small>{lesson.status === 'COMPLETED' ? '완료' : lesson.status === 'IN_PROGRESS' ? '학습 중' : '시작 전'}</small></button></li>)}</ul></details>)}</section>
    </>}
  </>
}
