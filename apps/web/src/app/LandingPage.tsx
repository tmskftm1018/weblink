import { useEffect, useRef } from 'react'

type LandingPageProps = { onEnter: (mode: 'login' | 'signup') => void; isAuthenticated?: boolean }

const capabilities = [
  { number: '01', title: '블록으로 배우기', copy: '순서를 맞추고 실행 흐름을 익히며 Python의 기초를 연습해요.', tag: 'LEARN' },
  { number: '02', title: '프로젝트로 만들기', copy: '파일을 편집하고 저장한 코드를 실제로 실행해 결과를 확인해요.', tag: 'BUILD' },
  { number: '03', title: '팀과 함께 정리하기', copy: '프로젝트 파일과 작업 보드를 공유하고 변경 내용을 이어가요.', tag: 'COLLABORATE' },
  { number: '04', title: '데이터와 연결하기', copy: 'API와 SQLite를 다루고 Google Sheets 데이터를 읽는 흐름을 배워요.', tag: 'CONNECT' },
]

const stackGroups = [
  { number: '01', category: '사용 언어', items: ['Python', 'TypeScript'] },
  { number: '02', category: '프런트엔드', items: ['React', 'Monaco Editor'] },
  { number: '03', category: 'API · 외부 연동', items: ['FastAPI', 'Google Sheets API'] },
  { number: '04', category: '데이터베이스', items: ['SQLite', 'PostgreSQL'] },
  { number: '05', category: '실행 환경', items: ['Docker'] },
]

export default function LandingPage({ onEnter, isAuthenticated = false }: LandingPageProps) {
  const moving = useRef(false)
  const unlockTimer = useRef<number | null>(null)
  const lockUntil = useRef(0)
  const animationFrame = useRef<number | null>(null)
  const savedScrollStyles = useRef<{ behavior: string; snap: string } | null>(null)
  const restoreScrollStyles = () => {
    if (!savedScrollStyles.current) return
    document.documentElement.style.scrollBehavior = savedScrollStyles.current.behavior
    document.documentElement.style.scrollSnapType = savedScrollStyles.current.snap
    savedScrollStyles.current = null
  }
  const goTo = (id: string) => {
    const section = document.getElementById(id)
    if (!section) return
    moving.current = true
    if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current)
    if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current)
    if (!savedScrollStyles.current) {
      savedScrollStyles.current = {
        behavior: document.documentElement.style.scrollBehavior,
        snap: document.documentElement.style.scrollSnapType,
      }
    }
    document.documentElement.style.scrollBehavior = 'auto'
    document.documentElement.style.scrollSnapType = 'none'

    const startY = window.scrollY
    const targetY = Math.max(0, window.scrollY + section.getBoundingClientRect().top)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reducedMotion ? 0 : 880
    lockUntil.current = Date.now() + duration
    if (duration === 0) {
      window.scrollTo(0, targetY)
      restoreScrollStyles()
    } else {
      const startTime = performance.now()
      const animate = (time: number) => {
        const progress = Math.min(1, (time - startTime) / duration)
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2
        window.scrollTo(0, startY + (targetY - startY) * eased)
        if (progress < 1) {
          animationFrame.current = window.requestAnimationFrame(animate)
        } else {
          animationFrame.current = null
          restoreScrollStyles()
        }
      }
      animationFrame.current = window.requestAnimationFrame(animate)
    }
    if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current)
    unlockTimer.current = window.setTimeout(() => { moving.current = false }, duration + 100)
  }

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (window.innerWidth <= 760 || Math.abs(event.deltaY) < 3) return
      event.preventDefault()
      if (moving.current) {
        if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current)
        const remaining = Math.max(0, lockUntil.current - Date.now())
        unlockTimer.current = window.setTimeout(() => { moving.current = false }, Math.max(remaining, 180))
        return
      }

      const sections = Array.from(document.querySelectorAll<HTMLElement>('.landing-section'))
      if (!sections.length) return
      const currentIndex = sections.reduce((closestIndex, section, index) => {
        const closestDistance = Math.abs(sections[closestIndex].getBoundingClientRect().top)
        const distance = Math.abs(section.getBoundingClientRect().top)
        return distance < closestDistance ? index : closestIndex
      }, 0)
      const nextSection = sections[currentIndex + (event.deltaY > 0 ? 1 : -1)]
      if (nextSection) goTo(nextSection.id)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
      if (unlockTimer.current !== null) window.clearTimeout(unlockTimer.current)
      if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current)
      restoreScrollStyles()
    }
  }, [])

  return (
    <div className="landing-page">
      <header className="landing-header">
        <a className="landing-brand" href="#home" onClick={(event) => { event.preventDefault(); goTo('home') }} aria-label="WebLink 홈">
          <span className="landing-brand-mark" aria-hidden="true">W</span><span>WebLink</span>
        </a>
        <nav className="landing-nav" aria-label="페이지 메뉴">
          <button type="button" onClick={() => goTo('about')}>소개</button>
          <button type="button" onClick={() => goTo('features')}>기능</button>
          <button type="button" onClick={() => goTo('stack')}>기술 스택</button>
        </nav>
        <button className="landing-login" type="button" onClick={() => onEnter('login')}>{isAuthenticated ? '내 프로젝트' : '로그인'} <span aria-hidden="true">↗</span></button>
      </header>

      <main className="landing-sections">
        <section className="landing-section landing-hero" id="home" aria-labelledby="landing-title">
          <div className="hero-content">
            <h1 id="landing-title">WebLink</h1>
          </div>
        </section>

        <section className="landing-section landing-about" id="about" aria-labelledby="about-title">
          <div className="section-inner about-layout">
            <div className="section-heading">
              <p className="landing-kicker">01 / ABOUT WEBLINK</p>
              <h2 id="about-title">배운 코드를<br /><em>작동하는 경험</em>으로.</h2>
            </div>
            <div className="about-copy">
              <p className="about-lead">문법을 익힌 다음 무엇을 만들 수 있을까요?</p>
              <p>WebLink는 블록 코딩으로 시작해 Python 프로젝트를 직접 만들고 실행하는 교육용 개발 공간입니다. 파일을 편집하고, 팀과 작업을 나누고, API와 데이터베이스를 연결하며 코드가 실제로 쓰이는 과정을 배워요.</p>
              <button className="landing-inline-link" type="button" onClick={() => onEnter(isAuthenticated ? 'login' : 'signup')}>{isAuthenticated ? '내 프로젝트로 돌아가기' : '학습 여정 시작하기'} <span aria-hidden="true">↗</span></button>
            </div>
            <div className="journey-line" aria-label="WebLink의 학습 흐름">
              {['블록 학습', '코드 작성', '프로젝트 실행', '데이터 연결'].map((step, index) => <div className="journey-step" key={step}><span>0{index + 1}</span><strong>{step}</strong>{index < 3 && <i aria-hidden="true">→</i>}</div>)}
            </div>
          </div>
          <div className="section-counter"><span>02</span> / 04</div>
        </section>

        <section className="landing-section landing-features" id="features" aria-labelledby="features-title">
          <div className="section-inner">
            <div className="features-heading">
              <div><p className="landing-kicker">02 / WHAT YOU CAN DO</p><h2 id="features-title">만들며 배우는<br /><em>네 가지 방법.</em></h2></div>
              <p>필요한 기능을 골라 시작하고,<br />하나의 프로젝트에서 차근차근 연결해 보세요.</p>
            </div>
            <div className="feature-grid">
              {capabilities.map((feature) => <button className="feature-card" type="button" key={feature.number} onClick={() => onEnter(isAuthenticated ? 'login' : 'signup')}>
                <span className="feature-top"><span>{feature.number}</span><span className="feature-arrow" aria-hidden="true">↗</span></span>
                <span className="feature-tag">{feature.tag}</span>
                <strong>{feature.title}</strong><span className="feature-copy">{feature.copy}</span>
              </button>)}
            </div>
            <p className="feature-footnote">모든 기능은 프로젝트를 중심으로 이어집니다. <button type="button" onClick={() => onEnter(isAuthenticated ? 'login' : 'signup')}>{isAuthenticated ? '내 프로젝트 열기' : '직접 둘러보기'} ↗</button></p>
          </div>
          <div className="section-counter"><span>03</span> / 04</div>
        </section>

        <section className="landing-section landing-stack" id="stack" aria-labelledby="stack-title">
          <div className="section-inner stack-inner">
            <p className="landing-kicker">03 / BUILT WITH</p>
            <h2 className="stack-title" id="stack-title">WebLink를 만든 기술</h2>
            <div className="stack-list" aria-label="기술 분야별 스택">
              {stackGroups.map((group) => <section className="stack-group" key={group.number}>
                <div className="stack-group-heading"><i aria-hidden="true">{group.number}</i><h3>{group.category}</h3></div>
                <div className="stack-group-items">{group.items.map((name) => <span className="stack-item" key={name}>{name}</span>)}</div>
              </section>)}
            </div>
            <div className="stack-cta"><div><span className="landing-kicker">YOUR NEXT STEP</span><strong>이제 직접 만들어 볼 차례예요.</strong></div><button className="landing-primary" type="button" onClick={() => onEnter(isAuthenticated ? 'login' : 'signup')}>{isAuthenticated ? '내 프로젝트로 돌아가기' : 'WebLink 시작하기'} <span aria-hidden="true">→</span></button></div>
          </div>
          <footer className="landing-footer"><a href="#home" onClick={(event) => { event.preventDefault(); goTo('home') }}>WebLink <span>© 2026</span></a><span>배우고, 만들고, 연결해요.</span></footer>
          <div className="section-counter"><span>04</span> / 04</div>
        </section>
      </main>
    </div>
  )
}
