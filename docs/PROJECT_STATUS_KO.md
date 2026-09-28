# WebLink 진행 상황

마지막 정리: 2026-09-28

## 만들고 있는 제품

WebLink은 코딩 문법을 익히는 데서 멈추지 않고, 프로젝트를 API·데이터베이스·외부 앱과 연결하는 과정을 배우는 교육용 개발 플랫폼이다. 블록 활동으로 시작한 코드를 실제 프로젝트로 옮기고, 저장·실행·디버깅·데이터 연결까지 이어가는 방향으로 개발 중이다.

## 현재 구현된 기능

- 이메일 가입 및 로그인, 세션 관리
- 5개 학습 코스, 총 27개 수업과 사용자별 진행도 저장
- 코드 블록 순서 조립, 사용 블록 표시, 오답 힌트
- 프로젝트 생성, 파일 편집, 초안 저장, 리비전 및 명명된 버전 관리
- 네트워크가 차단된 컨테이너에서 Python 프로젝트 실행
- 프로젝트별 영구 SQLite 저장 공간
- API·페이지 처리·오류 재시도와 외부 앱 연결을 연습하는 학습용 API
- Gemini 기반 실행 오류 힌트
- Google Sheets 계정 연결, 범위 미리보기, 프로젝트 코드에서 시트 값 읽기

## Google Sheets 연결 확인 결과

2026-09-28 로컬 환경에서 사용자의 Google OAuth 계정 연결을 완료했다. 테스트용 Google Sheets에 가상 샘플 표를 입력하고 WebLink의 연결 화면에서 한국어 기본 탭의 `시트1!A1:D4` 범위를 읽어 네 행의 데이터를 확인했다.

프로젝트 코드에서는 다음 함수를 사용할 수 있다.

```python
from weblink_api import get_google_sheet

sheet = get_google_sheet("SPREADSHEET_ID", "'시트1'!A1:D4")
rows = sheet["values"]
print(rows)
```

현재 연결은 읽기 전용이다. 프로젝트가 값을 읽는 기능까지 있으며, 데이터베이스에 자동 저장하거나 계속 동기화하거나 Google Sheets에 다시 쓰는 기능은 아직 없다.

## 보안 및 권한 범위

- Google OAuth는 Sheets 읽기 전용 권한을 요청한다.
- Google refresh token은 Fernet 키로 암호화해 PostgreSQL에 저장한다. `.env`와 암호화 키는 Git에 올리지 않는다.
- 학생 코드 실행 컨테이너는 네트워크가 차단돼 있다. Google 연결이 있는 실행에서만 별도의 고정 목적 연결 서비스가 Google token 및 Sheets API에 접속한다.
- Google Sheets 권한은 특정 셀 범위만으로 제한되지 않는다. 범위 입력은 한 번의 읽기 요청에 사용할 범위이며, 실제 OAuth 권한은 연결한 Google 계정이 접근할 수 있는 스프레드시트에 적용된다.
- 로컬 OAuth 앱은 개발/테스트 용도다. Google Cloud 테스트 사용자와 외부 앱 설정이 필요할 수 있다.

## 로컬 확인 상태

- WebLink web, API, worker, PostgreSQL이 Docker Compose로 실행된다.
- API와 worker 상태 확인에서 정상 상태를 확인했다.
- Alembic 데이터베이스 버전: `20260928_0027` (현재 head)
- 프론트엔드 TypeScript 및 Vite 프로덕션 빌드 성공
- API 연결 코드 Python 구문 검사 성공
- 실제 Google Sheets 범위 읽기 성공
- 자동화 테스트 전체 실행 여부: 이번 연결 작업에서는 실행하지 않음

## 아직 하지 않은 기능

- Google 계정으로 WebLink 가입 및 로그인
- Google Drive 파일 선택창에서 파일 가져오기
- CSV, JSON, 문서 등을 프로젝트 파일이나 DB 테이블로 가져오기
- Google Sheets 자동 재동기화 또는 쓰기/양방향 동기화

Google 로그인과 Drive 파일 가져오기는 사용자 요청에 따라 이후 단계로 보류한다. 구현할 때는 로그인 권한과 Drive 파일 권한을 분리하고, Google Picker에서 사용자가 직접 고른 파일만 가져오는 흐름을 우선 검토한다.

## 시작 및 설정

프로젝트 루트에서 `.env.example`을 참고해 실제 `.env`를 준비한 뒤 실행한다.

```powershell
docker compose up --build
```

- Web: <http://localhost:5173>
- API readiness: <http://localhost:8000/health/ready>
- Google Sheets redirect URI: `http://localhost:8000/api/v1/connections/google/oauth/callback`

실제 비밀값이 든 `.env`는 공유하거나 커밋하지 않는다. OAuth 설정과 암호화 키는 `.env.example`의 빈 항목에 대응하도록 `.env`에 따로 저장한다.

## GitHub 저장소

- 비공개 저장소: <https://github.com/tmskftm1018/weblink>
- 기본 작업 브랜치: `master`
- 첫 프로젝트 스냅샷 커밋을 GitHub에 게시했다.
- `.env`와 실제 자격 증명은 저장소에서 제외하고 `.env.example`만 포함한다.
