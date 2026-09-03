const base = 'http://localhost:9222';
const targets = await (await fetch(`${base}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (pending.has(msg.id)) pending.get(msg.id)(msg);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return res.result?.result?.value ?? res.result?.exceptionDetails;
};

await send('Page.navigate', { url: 'http://localhost:3000/?city=muenchen&view=map&date=2026-10-07' });
await new Promise((r) => setTimeout(r, 9000));

console.log('vorher:', await evaluate(`(() => ({
  pins: document.querySelectorAll('.map-pin').length,
  einzel: document.querySelectorAll('.map-pin--single').length,
  gruppen: document.querySelectorAll('.map-pin--group').length,
  ortskarte: !!document.querySelector('.map-glass.absolute.bottom-3'),
}))()`));

console.log('Klick auf Einzelpin:', await evaluate(`(async () => {
  const pin = document.querySelector('.map-pin--single');
  pin.closest('.leaflet-marker-icon').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise((r) => setTimeout(r, 600));
  const panel = document.querySelector('aside:last-of-type');
  return {
    ortskarteOffen: !!document.querySelector('.map-glass.rounded-\\\\[20px\\\\]'),
    pinHervorgehoben: document.querySelectorAll('.map-pin--open').length,
    detailTitel: panel?.querySelector('h2, h1')?.textContent?.trim().slice(0, 60) ?? panel?.innerText?.split('\\n').slice(0, 6).join(' | '),
  };
})()`));

console.log('Klick auf Gruppenpin:', await evaluate(`(async () => {
  const pin = document.querySelector('.map-pin--group');
  pin.closest('.leaflet-marker-icon').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  await new Promise((r) => setTimeout(r, 600));
  const card = document.querySelector('.map-glass.rounded-\\\\[20px\\\\]');
  return { ortskarteOffen: !!card, kopf: card?.innerText?.split('\\n').slice(0, 2).join(' · ') };
})()`));

ws.close();
