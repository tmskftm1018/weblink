"""M04 content contract. The main API never evaluates this JavaScript."""

STARTER_CODE = '''const form = document.querySelector("#post-form");
const titleInput = document.querySelector("#title");
const contentInput = document.querySelector("#content");
const errorMessage = document.querySelector("#error");

form.addEventListener("submit", (event) => {
  // 1. 기본 제출을 막으세요.
  const title = titleInput.value;
  // 2. 앞뒤 공백을 정리하고 빈 제목이면 오류를 보여 주세요.
  // 3. 실패 시 입력을 지우지 말고 이 함수를 끝내세요.
  // 4. 유효하면 이전 오류를 지우고 정리한 제목과 본문을 전달하세요.
  savePost({ title, content: contentInput.value });
});'''

CHECK_IDS = [f"WEB-M04-T{index}" for index in range(1, 9)]
SCOPE = "별도 QuickJS 실행기의 제한된 동기 폼 이벤트 환경에서 6가지 입력과 8개 동작을 검사합니다. 실제 브라우저 DOM·네트워크·DB 저장을 실행한 결과는 아닙니다."
