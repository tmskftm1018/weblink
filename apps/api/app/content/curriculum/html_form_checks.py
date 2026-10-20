"""Parse the restricted M03 HTML exercise. No learner scripts are executed."""

from html.parser import HTMLParser

ALLOWED_TAGS = {"form", "label", "input", "textarea", "button", "h1", "h2", "p", "div", "section", "main", "fieldset", "legend", "small", "span", "br", "ul", "li", "strong"}
ALLOWED_ATTRIBUTES = {"id", "name", "for", "type", "placeholder", "required", "maxlength", "minlength", "rows", "cols", "disabled", "class", "aria-describedby"}
VOID_TAGS = {"input", "br"}
STARTER_CODE = '''<form>
  <h2>새 게시글</h2>
  <!-- 제목 입력: name="title", 고유한 id와 label의 for를 연결하세요. -->
  <label>제목</label>
  <input type="text">

  <!-- 내용 입력: name="content", id와 for를 연결하세요. -->
  <label>내용</label>
  <textarea rows="4"></textarea>

  <!-- 폼 제출용 버튼의 type을 확인하세요. -->
  <button type="button">등록</button>
</form>'''


class FormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.nodes: list[dict] = []
        self.stack: list[dict] = []
        self.errors: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if len(self.nodes) >= 1000 or len(self.stack) >= 32:
            raise ValueError("HTML 중첩 또는 요소 수 제한을 넘었습니다.")
        if tag not in ALLOWED_TAGS:
            self.errors.append(f"<{tag}>는 이 폼 연습에서 사용하지 않습니다.")
        keys = [key for key, _ in attrs]
        if len(keys) != len(set(keys)):
            self.errors.append(f"<{tag}>에 중복 속성이 있습니다.")
        if any(key not in ALLOWED_ATTRIBUTES for key in keys):
            self.errors.append(f"<{tag}>에 허용하지 않는 속성이 있습니다. 스크립트·URL·스타일은 이 연습에서 제외하세요.")
        node = {"tag": tag, "attrs": dict(attrs), "ancestors": list(self.stack), "text": ""}
        self.nodes.append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID_TAGS or not self.stack or self.stack[-1]["tag"] != tag:
            self.errors.append(f"</{tag}>의 여는 태그와 닫는 순서를 확인하세요.")
        else:
            self.stack.pop()

    def handle_data(self, data: str) -> None:
        for node in self.stack:
            node["text"] += data

    def handle_decl(self, decl: str) -> None:
        self.errors.append("이 연습에는 <!DOCTYPE> 없이 <form> 부분만 작성하세요.")


def check_html(source: str) -> list[dict]:
    parser = FormParser()
    try:
        parser.feed(source)
        parser.close()
    except (ValueError, AssertionError):
        parser.errors.append("HTML 형식 또는 중첩 제한을 확인하세요. 요소 1,000개·중첩 32단계까지만 사용할 수 있어요.")
    if parser.stack:
        parser.errors.append("닫지 않은 태그가 있습니다.")
    nodes = parser.nodes
    forms = [node for node in nodes if node["tag"] == "form"]
    form = forms[0] if len(forms) == 1 else None
    # Identity checks avoid recursive equality through ancestry dictionaries.
    inside = [node for node in nodes if form is not None and any(parent is form for parent in node["ancestors"])]
    ids = [node["attrs"]["id"] for node in nodes if node["attrs"].get("id") is not None]
    unique_ids = all(value and not any(char.isspace() for char in value) for value in ids) and len(ids) == len(set(ids))
    def enabled(node: dict) -> bool:
        return "disabled" not in node["attrs"] and not any(parent["tag"] == "fieldset" and "disabled" in parent["attrs"] for parent in node["ancestors"])

    titles = [node for node in inside if node["tag"] == "input" and node["attrs"].get("name") == "title" and (node["attrs"].get("type", "text") or "").lower() == "text" and enabled(node)]
    contents = [node for node in inside if node["tag"] == "textarea" and node["attrs"].get("name") == "content" and enabled(node)]
    labels = [node for node in inside if node["tag"] == "label" and node["text"].strip()]

    def labelled(controls: list[dict]) -> bool:
        return len(controls) == 1 and bool(controls[0]["attrs"].get("id")) and any(label["attrs"].get("for") == controls[0]["attrs"]["id"] for label in labels)

    submits = [node for node in inside if node["tag"] == "button" and (node["attrs"].get("type") or "").lower() == "submit" and enabled(node) and node["text"].strip()]
    definitions = [
        ("WEB-M03-T1", "허용한 HTML과 태그 순서", not parser.errors, " ".join(dict.fromkeys(parser.errors)) or "태그와 속성의 기본 구성을 확인했어요."),
        ("WEB-M03-T2", "하나의 form", form is not None, "form 하나 안에 제목·내용·버튼을 구성하세요."),
        ("WEB-M03-T3", "제목 입력", len(titles) == 1, 'name="title"인 사용 가능한 텍스트 input 하나가 필요해요.'),
        ("WEB-M03-T4", "내용 입력", len(contents) == 1, 'name="content"인 사용 가능한 textarea 하나가 필요해요.'),
        ("WEB-M03-T5", "고유한 id", unique_ids, "id는 비어 있거나 중복되면 안 되고, 공백을 포함하지 않아야 해요."),
        ("WEB-M03-T6", "제목 label 연결", labelled(titles), "제목 label에 문구를 쓰고 for를 제목 input의 id와 맞추세요."),
        ("WEB-M03-T7", "내용 label 연결", labelled(contents), "내용 label에 문구를 쓰고 for를 textarea의 id와 맞추세요."),
        ("WEB-M03-T8", "제출 버튼", bool(submits), 'form 안에 문구가 있는 type="submit" 버튼이 필요해요.'),
    ]
    return [{"id": key, "label": label, "passed": bool(passed), "message": "구조 확인 완료" if passed else explanation} for key, label, passed, explanation in definitions]
