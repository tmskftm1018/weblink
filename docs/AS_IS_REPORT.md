# WebLink 현재 상태 감사 (G0)

이 문서는 구현 전 조사 기준선이다. 이후 cryptography 잠금파일/설치를 복구했고 API 테스트 44개와 웹 빌드가 통과했다. 최신 구현·검증 결과는 `VERIFY_REPORT.md`, 남은 범위는 `NEXT_STEPS.md`를 기준으로 본다.

감사일: 2026-10-19
대상: 현재 체크아웃 `master` (`9bb2fdd`), 작업 폴더와 저장소 코드
기준 설계: `WebLink_통합학습시스템_최종설계서_v1.1.pdf` 및 구현 마스터 프롬프트 v1.1

## 확인한 실행·저장 구조

- 웹: React 18, TypeScript, Vite, Monaco Editor. 화면 진입점은 `apps/web/src/app/App.tsx`, API 호출은 `apps/web/src/services/`에 있다.
- 플랫폼 API: FastAPI, SQLAlchemy, PostgreSQL, Alembic. API 라우터는 `/api/v1` 아래에 연결된다.
- 학습 콘텐츠: `Course`, `Lesson`, `Concept`, `LearningProgress`, `LearningEvidence` 모델을 사용한다. 학습 콘텐츠는 마이그레이션에서 JSON으로 시드된다.
- 프로젝트 코드 실행: API와 분리된 worker가 Docker를 통해 별도 컨테이너에서 실행한다. 실행 환경은 제한된 자원·읽기 전용 파일시스템·권한 제거·기본 네트워크 차단 옵션을 사용한다. 프로젝트 데이터베이스는 플랫폼 PostgreSQL과 별도로 프로젝트 단위 SQLite 볼륨을 사용한다.
- 프로젝트 협업·파일 관리·외부 앱 연결은 이미 넓게 구현되어 있다. 이 감사의 목표는 이 제품 기능을 다시 만드는 것이 아니라 그 위에 별도 학습 경로를 안전하게 붙이는 것이다.
- 실제 `.env`는 `.gitignore` 대상이며 감사 중 내용을 출력하거나 사용하지 않았다. 추적 중인 파일에서 API 키·GitHub 토큰·개인 키로 보이는 일반 패턴은 발견되지 않았다. 이는 자동 패턴 검사 결과이지 포괄적인 보안 감사는 아니다.

## 학습 기능에서 확인한 사실

- 현재 API는 코스 목록, 코스·수업 상세, 수업 답안 제출을 제공한다. 대표 파일은 `apps/api/app/api/v1/learning.py`, `apps/api/app/services/learning.py`, `apps/api/app/repositories/learning.py`다.
- 기존 제품 현황 문서 `docs/PROJECT_STATUS_KO.md`는 5개 코스, 37개 수업을 기록한다. 이 수업들은 Python 기초와 API·DB·Google Sheets·외부 앱 연결 과정을 포함한다. 실제 운영 DB의 현재 공개 수는 이번 실행 환경에 Docker CLI가 없어 조회하지 못했다.
- 현재 수업 본문은 마이그레이션에 들어 있고, 제출 판정의 일부는 `learning.py`의 수업별 하드코딩 정답/문자열 판정에 의존한다. 학습 사양(JSON)·테스트 코드·루브릭이 독립적으로 연결된 구조는 아직 확인되지 않았다.
- 진도 상태는 `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED` 중심이다. 진도는 사용자와 수업 단위로 격리된다.
- `LearningEvidence`는 이벤트 JSON을 보관하지만, 확인한 모델에는 코드 개정 해시나 루브릭 버전에 고정된 실행 결과 모델이 없다. 기존 `attempts_count`와 답안 판정만으로 M01~M12 완주 증거를 표현하기는 부족하다.
- 현재 화면은 코스 목록, 블록 조립, 입력·처리·출력 질문, 힌트 및 프로젝트 이어 만들기를 제공한다. 목표 진단, C00~C05 공통 사고 기초, 필요 시점의 B 브리지, M01~M12 누적 풀스택 미션과 원래 지점 복귀 흐름은 아직 제품 구조로 확인되지 않았다.
- AI 디버깅 힌트는 기존 별도 기능으로 Gemini API 서버 호출을 제공한다. 새 학습 과정은 이 API를 튜터나 판정자로 사용하지 않는다. 기존 기능을 없애지 않고 학습 경로와 명확히 분리하는 것이 안전하다.

## 현재 테스트·빌드 기준선

- 웹 `pnpm build`: 통과 (TypeScript 검사 및 Vite 프로덕션 빌드). Monaco가 포함된 자산이 크다는 Vite 청크 경고가 있다.
- API `apps/api/.venv/Scripts/python.exe -m pytest`: 수집 단계에서 중단. 해당 가상환경에 `cryptography`가 없어 앱 import가 실패했다. 기능 테스트 실패로 해석할 수 없다.
- `uv run pytest`: 격리된 실행 환경이 uv 인터프리터 캐시에 쓰지 못해 실패했다.
- `uv sync --locked --group dev`: 추적된 `uv.lock`이 현재 `pyproject.toml`과 동기화되지 않았다고 보고해 잠금 모드가 중단했다. 잠금 파일은 변경하지 않았다.
- 오프라인 uv 해석: 캐시에 필요한 패키지 일부(예: Alembic)가 없어 해결하지 못했다. 네트워크 인덱스 접근도 이 실행 환경에서 DNS 실패로 차단됐다.
- `ruff check app tests migrations`: 48개 기존 린트 진단을 보고했다. 이번 감사에서는 자동 수정하지 않았다.
- `docker compose config --quiet`: 이 Codex 실행 환경에서 `docker` 명령을 찾지 못해 실행하지 못했다. 사용자의 Docker Desktop 상태를 의미하지 않는다.
- 추적 파일의 일반 자격 증명 패턴 검색: 일치 파일 없음. `git diff --check`: 통과.

정확한 실행 명령과 관측 결과는 `docs/VERIFY_REPORT.md`에 기록한다.

## 보존해야 할 것과 변경 경계

- 보존: 기존 사용자·프로젝트·진도, 운영 PostgreSQL, 프로젝트별 SQLite, 실행 worker, 기존 연결 앱, 현재 5개 코스의 원문과 ID.
- 변경: 새 웹 풀스택 코스를 기존의 서로 다른 연결 실습 코스와 구분하고, 버전이 있는 콘텐츠·검사·개념 확인·전이 증거를 추가한다.
- 보류: 기존 코스·수업·학습 증거의 물리 삭제 또는 destructive migration. 새 과정의 사용자 데이터 복구와 마이그레이션 증거가 확인되기 전 삭제하지 않는다.
- 안전 조사 필요: worker는 Docker 소켓에 접근하며 일부 연결 앱 실행에서 네트워크를 켤 수 있다. 새로운 학습 코드 실행이 기존 권한 경계를 넓히지 않도록 G5에서 별도 보안 회귀 검사를 둔다.
- 작업 시작 시 `.env.example`과 `docker-compose.yml`에는 이전 네트워크 공유 시도에서 남은 로컬 미커밋 변경이 있었다. 이를 유지했으며 새 감사 문서에서는 이 설정을 승인된 배포·공개 설정으로 간주하지 않는다.

## 신뢰도와 미확인 항목

- 코드 구조와 정적 설정: 높음.
- 현재 사용자 데이터가 있는 운영 DB의 코스·진도 수: 미확인.
- 앱의 Docker 기동·Alembic upgrade·worker 종단 실행: 미확인.
- 학습자가 실제로 수업을 끝까지 수행할 수 있는지: 코드와 단위 테스트만으로 입증되지 않음; 브라우저 E2E 및 학습자 사용성 검증 필요.
- 임의 프로젝트 코드 실행의 전반적 안전성: 이 감사는 보안 인증이 아니며 독립 검증 전에는 보증하지 않음.
