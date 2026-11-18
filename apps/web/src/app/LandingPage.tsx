type LandingPageProps = {
  onEnter: (mode: 'login' | 'signup', destination?: 'lesson' | 'projects') => void
  isAuthenticated?: boolean
}

export default function LandingPage({ onEnter, isAuthenticated = false }: LandingPageProps) {
  return (
    <div className="landing-page landing-onepage landing-minimal">
      <header className="landing-header">
        <a className="landing-brand" href="#home" aria-label="우리들의 개발일지 홈">우리들의 개발일지</a>
        <button className="landing-login" type="button" onClick={() => onEnter('login')}>
          {isAuthenticated ? '내 프로젝트' : '로그인'} <span aria-hidden="true">↗</span>
        </button>
      </header>
      <main id="home" className="landing-onepage-main">
        <section className="onepage-hero" aria-labelledby="landing-title">
          <div className="onepage-intro">
            <h1 id="landing-title">우리들의 개발일지</h1>
            <p className="onepage-tagline">배운 코드를 작동하는 경험으로.</p>
            <p className="onepage-lead">화면을 만들고 API와 데이터베이스를 연결하며 웹 개발을 배워요.</p>
            <button className="onepage-primary" type="button" onClick={() => onEnter(isAuthenticated ? 'login' : 'signup', isAuthenticated ? 'projects' : undefined)}>
              {isAuthenticated ? '내 프로젝트 열기' : '시작하기'} <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
