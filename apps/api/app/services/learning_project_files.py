"""Package saved learner sources without evaluating or rewriting them."""

import json

from app.schemas.projects import ProjectFileInput


def project_files(frontend: str, api: str, origin: dict) -> list[ProjectFileInput]:
    files = {
        "web/src/App.jsx": "import React from 'react';\n" + frontend + "\nexport default App;\n",
        "api/main.py": api,
        ".weblink/original-App.jsx": frontend,
        ".weblink/learning-origin.json": json.dumps(origin, ensure_ascii=False, indent=2),
        "web/src/main.jsx": "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App />);\n",
        "web/index.html": '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>나의 학습 프로젝트</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
        "web/package.json": json.dumps({"private": True, "type": "module", "scripts": {"dev": "vite --host 0.0.0.0"}, "dependencies": {"react": "18.3.1", "react-dom": "18.3.1", "vite": "5.4.21"}}, indent=2),
        "web/vite.config.js": "export default { server: { proxy: { '/api': 'http://api:8000' } } };\n",
        "web/Dockerfile": "FROM node:22-alpine\nWORKDIR /app\nCOPY package.json ./\nRUN npm install --no-audit --no-fund\nCOPY . .\nCMD [\"npm\", \"run\", \"dev\", \"--\", \"--port\", \"5173\"]\n",
        "api/requirements.txt": "fastapi==0.141.1\npydantic==2.13.5\nuvicorn==0.54.0\n",
        "api/Dockerfile": 'FROM python:3.12-slim\nENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1\nWORKDIR /app\nCOPY requirements.txt ./\nRUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --no-create-home learner && mkdir -p /data && chown 10001:10001 /data\nCOPY main.py ./\nUSER 10001:10001\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]\n',
        "compose.yaml": 'services:\n  api:\n    build: ./api\n    ports: ["127.0.0.1:8081:8000"]\n    volumes: ["app-data:/data"]\n  web:\n    build: ./web\n    ports: ["127.0.0.1:5174:5173"]\n    depends_on: [api]\nvolumes:\n  app-data:\n',
        ".gitignore": "node_modules/\ndist/\n__pycache__/\n*.db\n*.sqlite*\n.env\n",
        "README.md": f'''# 나의 WebLink 학습 프로젝트

{origin['node_id']}의 저장본 v{origin['work_version']}에서 가져온 React와 FastAPI 코드입니다.

## 로컬에서 실행

프로젝트 ZIP을 내려받아 압축을 풀고 해당 폴더에서 실행하세요.

```sh
docker compose up --build -d
```

- 화면: http://localhost:5174
- API: http://localhost:8081
- 종료: `docker compose down`
- SQLite 파일은 이 프로젝트의 Docker 볼륨에 보관됩니다. `down -v`는 데이터를 삭제하므로 보관 중에는 사용하지 마세요.

## 이어서 개발

WebLink의 기존 프로젝트 편집·팀원·버전·ZIP 내려받기를 사용하세요. WebLink의 Python 실행 버튼은 이 React+FastAPI 구성을 실행하는 기능이 아닙니다. 전체 앱 실행은 위 Docker Compose를 사용합니다. 로컬 코드를 바꿨다면 다시 빌드하세요.

학습 원본 React 코드는 `.weblink/original-App.jsx`, 출처는 `.weblink/learning-origin.json`에 보관합니다. 웹용 App.jsx에는 React import와 export만 추가했습니다. API 소스는 그대로 복사했습니다. 학습 실행 판정은 원본 답안의 기록이며 이 프로젝트를 다시 실행해 검증했다는 뜻은 아닙니다. 제공한 로컬 실행 구성의 실제 기동 검증은 아직 남아 있습니다.
''',
    }
    return [ProjectFileInput(path=path, content=content) for path, content in files.items()]
