(() => {
  const stringify = JSON.stringify.bind(JSON), parse = JSON.parse.bind(JSON);
  const React = Object.freeze({...__weblinkReact.React}), Renderer = __weblinkReact.Renderer;
  const queue = [], pending = new Map(); let next = 0, view, prevented = false;
  const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node.children || []).map(text).join('');
  Object.defineProperty(globalThis, 'React', {value: React});
  Object.defineProperty(globalThis, 'fetch', {value: (path, options = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    queue.push({id, path, method: options.method || 'GET', body: options.body ?? null});
    pending.set(id, {resolve, reject});
  })});
  return {
    mount(App) {Renderer.act(() => {view = Renderer.create(React.createElement(App));});},
    unmount() {Renderer.act(() => view.unmount());},
    submit(value, name) {
      prevented = false;
      Renderer.act(() => view.root.findByProps({name}).props.onChange({target: {value}}));
      Renderer.act(() => {view.root.findByType('form').props.onSubmit({preventDefault() {prevented = true;}});});
    },
    queue() {return stringify(queue.splice(0));},
    deliver(raw) {
      const data = parse(raw), entry = pending.get(data.id); pending.delete(data.id);
      Renderer.act(() => {
        if (data.error) entry.reject(new Error(data.error));
        else entry.resolve(Object.freeze({status: data.status, ok: data.status >= 200 && data.status < 300,
          json: () => Promise.resolve(parse(data.body))}));
      });
    },
    observe(name) {return stringify({items: view.root.findAllByType('li').map(text),
      value: view.root.findByProps({name}).props.value, prevented,
      error: view.root.findAllByProps({role: 'alert'}).map(text).join(''), tree: view.toJSON()});},
  };
})()
