# WebLink

WebLink은 블록을 조립해 코딩을 배우고, 만든 프로젝트를 API·데이터베이스·외부 앱과 연결하는 과정을 익히는 교육용 개발 플랫폼입니다. 단순히 문법을 연습하는 데서 그치지 않고, 프로젝트를 만들고 저장·실행·디버깅하며 실제 서비스의 데이터를 다루는 경험으로 이어지는 것을 목표로 합니다.

현재 구현 상태와 확인된 기능, 보안 범위, 다음 개발 항목은 [한국어 프로젝트 진행 상황](docs/PROJECT_STATUS_KO.md)에서 확인할 수 있습니다.

## 주요 기능

- 무작위로 섞인 코드 블록을 순서에 맞게 조립하는 학습 활동
- 사용한 블록 표시와 오답 단계별 힌트
- 회원가입, 로그인, 사용자별 학습 진도 저장
- 프로젝트 파일 편집, 초안 저장, 리비전 및 이름이 있는 버전 관리
- 네트워크가 차단된 컨테이너에서 Python 프로젝트 실행
- 프로젝트마다 분리된 영구 SQLite 데이터베이스
- API 요청, 데이터 저장·필터링·수정·삭제, 페이지 처리와 재시도 학습
- Gemini 기반 실행 오류 힌트
- Google Sheets 연결 및 프로젝트 코드에서 읽기 전용 데이터 조회

## 구성

- `apps/web`: React, TypeScript, Vite 기반 웹 화면
- `apps/api`: FastAPI 백엔드, PostgreSQL 연동, Alembic 데이터베이스 마이그레이션
- `apps/worker`: 실행 작업을 처리하는 백그라운드 작업자
- `infrastructure/runtime`: 제한된 환경에서 학습 코드를 실행하는 Python 런타임
- `postgres`: 프로젝트 및 학습 정보를 저장하는 PostgreSQL 데이터베이스

## 로컬에서 실행하기

1. `.env.example`을 참고해 프로젝트 루트에 `.env` 파일을 준비하고 환경에 맞게 값을 설정합니다.
2. Docker가 실행 중인지 확인한 뒤 다음 명령을 실행합니다.

```bash
docker compose up --build
```

3. 웹 화면을 엽니다: <http://localhost:5173>

API 상태 확인 주소는 <http://localhost:8000/health>, 준비 상태 확인 주소는 <http://localhost:8000/health/ready>입니다.

API와 작업자는 PostgreSQL이 준비된 뒤 시작합니다. 작업자는 프로젝트 코드를 격리된 일회성 컨테이너에서 실행하기 위해 Docker 소켓에 접근합니다. 실행할 프로젝트에는 저장된 `main.py` 파일이 필요합니다. 실행 결과와 종료 상태는 프로젝트 화면에서 확인할 수 있습니다. 오브젝트 스토리지는 현재 제품 기능에서 사용하지 않으며, Compose의 `storage` 프로필로 선택 실행할 수 있습니다.

## 개발 확인 명령

- 웹 의존성 설치: `make web-install`
- 웹 프로덕션 빌드: `make web-build`
- API 테스트: `make api-test`
- API 코드 검사: `make api-lint`
- 데이터베이스 마이그레이션: `make db-upgrade`
- 작업자 직접 실행: `cd apps/worker && uv run python -m app.main`

## 환경 설정과 비밀값

환경 변수 목록은 `.env.example`에 있습니다. 실제 API 키, OAuth 비밀값, 암호화 키가 들어가는 `.env` 파일은 GitHub에 올리지 마세요.

## 학습 과정

학습 경로는 다음 과정으로 구성됩니다.

1. **소프트웨어의 흐름**: 입력·처리·출력, 변수, 조건, 반복
2. **파이썬 첫걸음**: 무작위 순서의 코드 블록 조립과 실제 프로젝트 실행
3. **프로젝트와 데이터 연결하기**: SQLite 기초와 프로젝트별 데이터 보관
4. **앱과 API 연결하기**: GET·POST·PUT 요청, JSON과 쿼리 매개변수, 오류 처리, 데이터 저장·필터링·수정·가져오기, 페이지 처리, 삭제 동기화와 일시 오류 재시도
5. **외부 앱과 안전하게 연결하기**: 권한 범위를 고려한 연결, 승인된 데이터 읽기, 프로젝트 데이터베이스로 동기화

현재 총 5개 코스, 27개 수업이 있습니다. 블록은 무작위로 제공되며, 이미 사용한 블록은 표시되고 다시 선택할 수 없습니다. 오답에는 먼저 넓은 힌트를 주고, 다시 시도하면 더 구체적인 힌트를 제공합니다. 학습 코드는 Python으로 확인할 수 있고 실제 프로젝트로 옮겨 실행할 수 있습니다.

학습용 외부 앱 연결 과정의 샘플 공급자는 이미 승인된 연결을 흉내 내는 로컬 테스트 데이터입니다. 실제 OAuth 연결이나 외부 서비스 자격 증명을 제공하는 기능은 아닙니다.

## Google Sheets 연결

현재 외부 앱 연결 화면에서 Google Sheets를 읽기 전용으로 연결할 수 있습니다. Google Cloud에서 웹 애플리케이션 유형의 OAuth 클라이언트를 만들고 Google Sheets API를 활성화한 다음, 아래 리디렉션 URI를 등록해야 합니다.

```text
http://localhost:8000/api/v1/connections/google/oauth/callback
```

OAuth 클라이언트 ID와 비밀값은 `.env`의 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`에 설정합니다. Fernet 암호화 키는 `CONNECTION_ENCRYPTION_KEY`에 설정해야 합니다. 값을 바꾼 뒤에는 API와 작업자를 다시 시작하세요. 저장된 Google 토큰은 이 키로 암호화되므로 키를 안전하게 보관해야 합니다.

프로젝트 코드에서는 다음과 같이 연결된 시트의 지정 범위를 읽을 수 있습니다.

```python
from weblink_api import get_google_sheet

sheet = get_google_sheet("SPREADSHEET_ID", "'시트1'!A1:C20")
rows = sheet["values"]
print(rows)
```

Google OAuth는 `spreadsheets.readonly` 권한만 요청합니다. 토큰은 PostgreSQL에 암호화해 저장하고, 프로젝트 코드 실행 컨테이너에는 네트워크 접근이나 OAuth 비밀값을 제공하지 않습니다. 별도의 제한된 연결 서비스가 토큰 갱신과 시트 읽기를 처리하고 셀 값만 실행 환경에 전달합니다. 범위 입력은 해당 읽기 요청에 적용되며, Google 계정의 접근 권한 자체를 특정 셀 범위로 제한하지는 않습니다.

Google 계정으로 WebLink에 가입·로그인하거나 Google Drive에서 파일을 가져오는 기능은 이후 개발 항목입니다.

## 실행 보안 참고

학습용 Python 코드는 네트워크가 차단된 비루트 컨테이너에서 실행됩니다. 파일 시스템은 읽기 전용이며 메모리, CPU, 프로세스 수, 실행 시간과 로그 크기에 제한이 있습니다. 프로젝트별 `/data` 볼륨에는 해당 프로젝트의 SQLite 데이터가 다음 실행까지 보관됩니다.

작업자는 격리 컨테이너를 시작하기 위해 `/var/run/docker.sock`에 접근해야 합니다. Docker 데몬과 작업자 호스트는 신뢰할 수 있는 인프라에서만 운영하세요. 공개 서비스에 배포하기 전에는 Docker 권한과 HTTPS, 허용 웹 출처 등 운영 환경을 별도로 구성해야 합니다.

## 라이선스

현재 저장소에는 라이선스 파일이 포함되어 있지 않습니다. 재사용 및 배포 조건은 라이선스를 정한 뒤 추가할 예정입니다.
