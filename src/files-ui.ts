import { h } from './dom';
import { sb, say } from './api';

export interface FileRow {
  id: string; kind: string; title: string; storage_path: string; mime: string;
  size_bytes: number | null; match_date: string | null; uploaded_at: string; published_at: string | null;
}

export const KIND_LABEL: Record<string, string> = {
  tactics: 'Tactics', briefing: 'Match briefings', schedule: 'Season schedule', other: 'Other',
};
export const KIND_ORDER = ['tactics', 'briefing', 'schedule', 'other'];

export const size = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');

/**
 * The window is opened before the download starts. A browser only allows a new
 * tab straight from a tap, and an installed app blocks it hardest. If the tab
 * is refused, the file is saved instead.
 */
export async function openFile(btn: HTMLButtonElement, f: FileRow) {
  const tab = window.open('', '_blank');
  const saved = [...btn.childNodes];
  btn.disabled = true;
  try {
    const { data, error } = await sb.storage.from('team-files').download(f.storage_path);
    if (error || !data) throw error ?? new Error('missing');
    const url = URL.createObjectURL(new Blob([data], { type: f.mime }));
    if (tab && !tab.closed) tab.location.href = url;
    else {
      const a = h('a', { href: url, download: f.title.replace(/[^\w .-]+/g, '_') });
      document.body.append(a); a.click(); a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    if (tab && !tab.closed) tab.close();
    btn.textContent = 'Could not open that file. Try again.';
    setTimeout(() => { btn.replaceChildren(...saved); btn.disabled = false; }, 2800);
    console.error('open file failed', say(e));
    return;
  }
  btn.disabled = false;
}

export function fileCard(f: FileRow, extra: Node[] = []) {
  const meta = [f.match_date ? new Date(f.match_date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '', size(f.size_bytes)]
    .filter(Boolean).join(' · ');
  const open = h('button', { class: 'vic-doc', type: 'button' },
    h('span', { class: 'vic-doc__icon' }, f.mime.includes('presentation') || f.mime.includes('powerpoint') ? '▣' : '▤'),
    h('span', { class: 'vic-doc__text' }, h('strong', null, f.title), h('span', null, meta)));
  open.addEventListener('click', () => openFile(open, f));
  return h('div', { class: 'vic-docrow' }, open, ...extra);
}
