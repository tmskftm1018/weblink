import { Suspense, lazy, useMemo, useState } from 'react'

const Editor = lazy(() => import('./MonacoCodeEditor'))
const tags = new Set(['form', 'label', 'input', 'textarea', 'button', 'h1', 'h2', 'p', 'div', 'section', 'main', 'fieldset', 'legend', 'small', 'span', 'br', 'ul', 'li', 'strong'])
const attributes = new Set(['id', 'name', 'for', 'type', 'placeholder', 'required', 'maxlength', 'minlength', 'rows', 'cols', 'disabled', 'class', 'aria-describedby'])

function previewDocument(source: string): { html: string; removed: boolean } {
  // A detached template keeps resource-bearing input inert before copying only
  // allowed nodes into a fresh fragment. The iframe adds a separate boundary.
  const template = document.createElement('template')
  template.innerHTML = source
  const output = document.createElement('div')
  let removed = false
  let count = 0
  function copy(node: Node, parent: Node, depth: number) {
    if (++count > 1000 || depth > 32) { removed = true; return }
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''))
      return
    }
    if (!(node instanceof HTMLElement)) return
    const tag = node.tagName.toLowerCase()
    if (!tags.has(tag)) { removed = true; return }
    const clean = document.createElement(tag)
    for (const attribute of Array.from(node.attributes)) {
      if (!attributes.has(attribute.name)) { removed = true; continue }
      let value = attribute.value
      if (['rows', 'cols', 'maxlength', 'minlength'].includes(attribute.name)) {
        const limit = attribute.name === 'rows' ? 12 : attribute.name === 'cols' ? 80 : 32000
        const normalized = String(Math.min(limit, Math.max(1, Number(value) || 1)))
        if (normalized !== value) removed = true
        value = normalized
      }
      if (attribute.name === 'type' && !['text', 'submit', 'button', 'reset'].includes(value.toLowerCase())) { removed = true; continue }
      clean.setAttribute(attribute.name, value)
    }
    parent.appendChild(clean)
    Array.from(node.childNodes).forEach((child) => copy(child, clean, depth + 1))
  }
  Array.from(template.content.childNodes).forEach((node) => copy(node, output, 0))
  return {
    removed,
    html: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>body{margin:0;padding:24px;background:#fafafa;color:#222;font:15px/1.7 system-ui,sans-serif}*{box-sizing:border-box}form{max-width:540px;margin:auto}label{display:block;margin:16px 0 6px;font-weight:600}input,textarea{display:block;width:100%;border:1px solid #888;padding:10px;border-radius:6px;font:inherit}button{padding:10px 20px;margin-top:16px;font:inherit;cursor:pointer}input:focus,textarea:focus,button:focus{outline:3px solid #287b5b;outline-offset:3px}fieldset{min-width:0}h1,h2{line-height:1.4}p{overflow-wrap:anywhere}</style></head><body>${output.innerHTML}</body></html>`,
  }
}

export default function HtmlFormExercise({ value, starter, path, disabled, onChange }: { value: string; starter: string; path: string; disabled: boolean; onChange: (value: string) => void }) {
  const [previewSource, setPreviewSource] = useState(value)
  const preview = useMemo(() => previewDocument(previewSource), [previewSource])
  return <div className="learning-html-exercise">
    <p>이 연습에는 <code>&lt;form&gt;</code> 부분만 작성하세요. 제목은 <code>name="title"</code>인 텍스트 input, 내용은 <code>name="content"</code>인 textarea로 만듭니다. 각각 고유한 id와 label의 for를 연결하고 제출 버튼을 추가하세요.</p>
    <div className="learning-html-exercise__editor"><Suspense fallback={<p>코드 편집기를 불러오는 중…</p>}><Editor path={path} value={value} readOnly={disabled} onChange={onChange} /></Suspense></div>
    <div className="learning-html-exercise__toolbar"><span>{value.length.toLocaleString()} / 32,000자</span><button type="button" disabled={disabled || value.length > 32000} onClick={() => setPreviewSource(value)}>미리보기 갱신</button><button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([value], { type: 'text/html;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = 'WebLink-M03-index.html'; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>HTML 파일 내려받기</button></div>
    {value !== previewSource && <p role="status">코드가 바뀌었어요. 미리보기를 갱신하면 반영됩니다. 서버 저장·제출은 아래 버튼에서 따로 진행해요.</p>}
    {preview.removed && <p role="status">허용하지 않는 요소·속성이나 크기 제한을 적용한 미리보기입니다. 원본 코드는 바꾸지 않았어요. 서버 구조 검사와 미리보기가 다를 수 있어요.</p>}
    <iframe title="내 게시글 폼 미리보기" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} />
    <p>제목 label 클릭 → 제목 입력에 초점이 가는지 확인 → Tab으로 내용과 버튼까지 이동해 보세요. 스크립트·외부 통신·실제 폼 제출은 이 미리보기에서 차단됩니다.</p>
    <details><summary>막혔을 때 · label 연결 예시</summary><pre>{'<label for="nickname">닉네임</label>\n<input id="nickname" name="nickname" type="text">'}</pre><p>for와 id는 연결을 나타내고, name은 제출할 값의 이름입니다. 위 예시를 제목·내용에 맞게 바꿔 보세요.</p></details>
    <details><summary>처음 제공한 코드 보기</summary><pre>{starter}</pre></details>
  </div>
}
