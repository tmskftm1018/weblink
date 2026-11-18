export const learningGoals: Record<string, { title: string; learn: string }> = {
  M01: { title: '내 학습 설정을 저장하고 다시 열기', learn: '선택한 내용을 저장해야 다시 접속해도 이어갈 수 있어요.' },
  M02: { title: '등록 버튼 뒤에서 누가 무슨 일을 할까?', learn: '화면은 입력, API는 검사, DB는 보관을 맡는다는 것을 배워요.' },
  M03: { title: '글쓰기 화면 만들기', learn: '입력칸의 이름과 실제 입력칸을 연결하는 방법을 배워요.' },
  M04: { title: '빈 글은 등록되지 않게 만들기', learn: '저장 요청을 보내기 전에 입력을 검사하는 방법을 배워요.' },
  M05: { title: '등록한 글이 화면 목록에 쌓이게 만들기', learn: 'React의 state를 바꾸면 화면도 바뀐다는 것을 배워요.' },
  M06: { title: '서버에서 글 목록 받아오기', learn: '화면이 데이터를 요청하면 API가 JSON 목록으로 답하는 방법을 배워요.' },
  M07: { title: '잘못된 글은 서버에서도 막기', learn: '화면을 거치지 않은 요청도 API에서 검사해야 해요.' },
  M08: { title: '글을 DB에 넣고 다시 꺼내 보기', learn: 'SQLite의 INSERT는 저장, SELECT는 조회라는 것을 직접 확인해요.' },
  M09: { title: '서버를 껐다 켜도 글이 남게 만들기', learn: '메모리 대신 DB 파일에 저장하고 API에서 읽는 방법을 배워요.' },
  M10: { title: '등록 버튼을 서버에 연결하기', learn: '등록 → API 검사 → DB 저장 → 목록 조회를 하나로 연결해요.' },
  M11: { title: '저장은 됐는데 화면에 안 보이는 오류 고치기', learn: '같은 입력으로 오류를 재현하고 수정 전후를 비교하는 방법을 배워요.' },
  M12: { title: '게시판에서 배운 방법으로 메모장과 할 일 만들기', learn: '같은 화면·API·DB 연결을 다른 데이터에도 적용해요.' },
}

export function missionTitle(id: string, fallback: string) {
  return learningGoals[id]?.title ?? fallback
}

export const learningEdits: Record<string, string> = {
  M03: 'label의 for와 입력칸의 id를 같은 값으로 맞추고, 버튼이 폼을 제출하게 만드세요.',
  M04: 'submit 처리 안에서 빈 제목은 return으로 멈추고, 정상 제목과 본문만 savePost에 보내세요.',
  M05: '등록 처리에서 기존 목록을 보존한 새 배열에 글을 추가하고, 성공하면 입력칸을 비우세요.',
  M06: 'GET /api/posts를 처리하는 함수에서 객체 {} 대신 글 목록 배열을 반환하세요.',
  M07: 'API에서 제목이 문자열인지 확인하고, 앞뒤 공백을 지운 길이가 1~80자인 경우에만 저장하세요.',
  M08: '반복문에서 ? 매개변수로 INSERT하고 commit한 뒤, SELECT로 두 제목을 다시 읽으세요.',
  M09: 'GET은 DB에서 읽고 POST는 DB에 저장하게 연결하세요. 시작할 때 기존 데이터를 지우지 마세요.',
  M10: '화면의 등록 처리에서 POST 성공 후 GET으로 목록을 다시 읽으세요. 앞 수업의 DB 저장 코드를 함께 사용해요.',
  M11: '실패 재현본과 수정본을 따로 편집하세요. 같은 입력으로 목록 갱신 오류와 수정 후 동작을 비교해요.',
  M12: '메모와 할 일의 입력 이름·API 경로·DB를 각각 맞추세요. 두 앱 실행 후 연결 역할을 한 번 설명해요.',
}

export function unitTitle(missionIds: string[], fallback: string) {
  if (missionIds.includes('M01')) return '1. 입력 화면 만들기'
  if (missionIds.includes('M06')) return '2. 화면과 서버의 역할 배우기'
  if (missionIds.includes('M08')) return '3. 데이터를 저장하고 연결하기'
  if (missionIds.includes('M11')) return '4. 오류를 고치고 다른 앱 만들기'
  return fallback
}

export function connectionAreas(id?: string): string[] {
  if (id === 'M02' || ['M10', 'M11', 'M12'].includes(id ?? '')) return ['screen', 'server', 'database']
  if (['M03', 'M04', 'M05'].includes(id ?? '')) return ['screen']
  if (['M06', 'M07'].includes(id ?? '')) return ['server']
  if (id === 'M08') return ['database']
  if (id === 'M09') return ['server', 'database']
  return []
}
