(() => {
  const stringify = JSON.stringify.bind(JSON);
  const library = __weblinkReact;
  const React = Object.freeze({ ...library.React, useState(initial) {
    const state = library.React.useState(initial);
    if (Array.isArray(state[0])) Object.freeze(state[0]);
    return state;
  }});
  const Renderer = library.Renderer;
  Object.defineProperty(globalThis, 'React', { value: React, writable: false, configurable: false });
  function text(node) {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return (node.children || []).map(text).join('');
  }
  return (App) => {
    let view;
    const rows = [];
    Renderer.act(() => { view = Renderer.create(React.createElement(App)); });
    const itemName = VARIANT === 'books' ? 'book' : 'title';
    const items = () => view.root.findAllByType('li').map(text);
    const initial = items();
    const cases = ['', '   ', '  첫 항목  ', '둘째 항목'];
    for (const value of cases) {
      let input = view.root.findByProps({ name: itemName });
      Renderer.act(() => input.props.onChange({ target: { value } }));
      let prevented = false;
      Renderer.act(() => view.root.findByType('form').props.onSubmit({ preventDefault() { prevented = true; } }));
      input = view.root.findByProps({ name: itemName });
      const alerts = view.root.findAllByProps({ role: 'alert' });
      rows.push({ input: value, prevented, value: input.props.value, items: items(), error: alerts.map(text).join('') });
    }
    const finalTree = view.toJSON();
    Renderer.act(() => view.unmount());
    Renderer.act(() => { view = Renderer.create(React.createElement(App)); });
    const restarted = items();
    Renderer.act(() => view.unmount());
    return stringify({ initial, cases: rows, tree: finalTree, restarted });
  };
})()
