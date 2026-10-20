(() => {
  // This intentionally implements only the documented synchronous form contract.
  // No Python callback, host filesystem, network API or browser objects are exposed.
  const stringify = JSON.stringify.bind(JSON);
  const handlers = [];
  const calls = [];
  let prevented = false;
  const title = { value: INITIAL_TITLE };
  const content = { value: "관찰용 본문" };
  const error = { textContent: "이전 오류" };
  const selectors = Object.create(null);
  const form = {
    addEventListener(type, callback) {
      if (type !== "submit" || typeof callback !== "function") throw Error("submit 이벤트 함수를 등록하세요.");
      if (handlers.length >= 4) throw Error("submit 이벤트는 한 번만 등록해 보세요.");
      handlers[handlers.length] = callback;
    },
    querySelector(selector) { return selectors[selector] || null; }
  };
  for (const key of ["#post-form", "form"]) selectors[key] = form;
  for (const key of ["#title", '[name="title"]']) selectors[key] = title;
  for (const key of ["#content", '[name="content"]']) selectors[key] = content;
  for (const key of ["#error"]) selectors[key] = error;
  const document = Object.freeze({
    querySelector(selector) { return selectors[selector] || null; },
    getElementById(id) { return selectors["#" + id] || null; }
  });
  function savePost(post) {
    if (!post || typeof post.title !== "string" || typeof post.content !== "string") throw Error("savePost({ title, content }) 형태로 호출하세요.");
    if (calls.length >= 4) throw Error("저장 호출이 너무 많아요.");
    calls[calls.length] = Object.freeze({ title: post.title.slice(0, 300), content: post.content.slice(0, 300) });
  }
  Object.defineProperty(globalThis, "document", { value: document, writable: false, configurable: false });
  Object.defineProperty(globalThis, "savePost", { value: savePost, writable: false, configurable: false });
  Object.freeze(form);
  Object.freeze(Object.prototype);
  Object.freeze(Array.prototype);
  // Return a closure directly to the embedding process; learner code cannot
  // replace this result function or its captured serializer via a global name.
  return () => {
    if (!handlers.length) throw Error("form.addEventListener('submit', ...)로 이벤트를 등록하세요.");
    const event = Object.freeze({ target: form, preventDefault() { prevented = true; } });
    for (let index = 0; index < handlers.length; index++) handlers[index](event);
    const result = Object.create(null);
    result.prevented = prevented;
    result.calls = calls;
    result.error = String(error.textContent).slice(0, 300);
    result.input = String(title.value).slice(0, 300);
    return stringify(result);
  };
})()
