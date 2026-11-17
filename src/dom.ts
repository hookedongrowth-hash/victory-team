// A tiny element builder. User text only ever goes in as text, never as HTML.
type Child = Node | string | null | undefined | false;
type Props = Record<string, any>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Props | null = null, ...kids: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') (el as any).value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}

export function clear(el: Element) { while (el.firstChild) el.removeChild(el.firstChild); }

export function mount(root: Element, ...nodes: Node[]) { clear(root); root.append(...nodes); }

/** Like mount, but a redraw behind the scenes does not take the cursor from someone typing. */
export function remount(root: Element, ...nodes: Node[]) {
  const a = document.activeElement as (HTMLInputElement | HTMLTextAreaElement | null);
  const id = a && a.id && root.contains(a) ? a.id : '';
  const from = id ? a!.selectionStart : null, to = id ? a!.selectionEnd : null;
  mount(root, ...nodes);
  if (!id) return;
  const again = document.getElementById(id) as (HTMLInputElement | HTMLTextAreaElement | null);
  if (!again) return;
  again.focus();
  try { if (from != null && to != null) again.setSelectionRange(from, to); } catch { /* not a text field */ }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
