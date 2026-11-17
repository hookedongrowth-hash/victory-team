import { h, mount, formatDate } from '../dom';
import { sb, say, type Me } from '../api';
import { fileCard, KIND_LABEL, KIND_ORDER, type FileRow } from '../files-ui';
import { header } from './signin';

type Tab = 'reflections' | 'feedback' | 'files' | 'squad';
const TOPIC: Record<string, string> = { match: 'About a match', training: 'About training', general: 'About a player' };

interface Squad { id: string; name: string; role: string; active: boolean; has_login: boolean; invite_expires_at: string | null; reflections: number; last_match: string | null }

export function showCoach(root: HTMLElement, me: Me, onSignOut: () => void) {
  let tab: Tab = 'reflections';
  let squad: Squad[] = [];
  let reflections: any[] = [];
  let praise: any[] = [];
  let notes: any[] = [];
  let feedback: any[] = [];
  let reads: any[] = [];
  let files: FileRow[] = [];
  let filter = '';
  let message = '';
  let busy = false;
  let newCode: { id: string; name: string; code: string } | null = null;
  let fb = { audience: 'team', topic: 'general', date: '', title: '', body: '' };
  let up = { kind: 'tactics', title: '', date: '' };
  let loadError = '';

  const load = async () => {
    const [s, r, p, n, f, rd, fl] = await Promise.all([
      sb.rpc('coach_squad'),
      sb.from('reflections').select('*, player:members!player_id(name)').order('match_date', { ascending: false }),
      sb.from('teammate_praise').select('id, match_date, note, from:members!from_id(name), about:members!about_id(name)').order('match_date', { ascending: false }),
      sb.from('coach_notes').select('*').order('match_date', { ascending: false }),
      sb.from('feedback').select('*, player:members!player_id(name)').order('created_at', { ascending: false }),
      sb.from('feedback_reads').select('feedback_id, member_id'),
      sb.from('files').select('*').order('uploaded_at', { ascending: false }),
    ]);
    if ([s, r, p, n, f, rd, fl].some((x) => x.error)) { loadError = 'Could not load. Check your connection.'; draw(); return; }
    squad = s.data as Squad[]; reflections = r.data!; praise = p.data!; notes = n.data!;
    feedback = f.data!; reads = rd.data!; files = fl.data as FileRow[];
    loadError = '';
    draw();
  };

  const act = async (fn: () => Promise<void>, ok = '') => {
    if (busy) return;
    busy = true; message = ''; draw();
    try { await fn(); message = ok; await load(); } catch (e) { message = say(e); }
    busy = false; draw();
  };

  const field = (label: string, node: Node) => h('label', { class: 'vic-field' }, h('span', { class: 'vic-label' }, label), node);
  const players = () => squad.filter((m) => m.role === 'player' && m.active);

  // ── Reflections ────────────────────────────────────────────────────────────
  const reflectionsView = () => {
    const rows = reflections.filter((r) => !filter || r.player_id === filter);
    const sel = h('select', { id: 'filter', class: 'field' }, h('option', { value: '' }, 'Everyone'),
      players().map((p) => h('option', { value: p.id, selected: p.id === filter }, p.name)));
    sel.addEventListener('change', () => { filter = sel.value; draw(); });
    return h('main', { class: 'vic-main' },
      h('h1', { class: 'vic-h1' }, 'Match reviews'),
      field('Show', sel),
      rows.length ? rows.map((r) => h('article', { class: 'vic-card vic-ref' },
        h('div', { class: 'vic-row' }, h('strong', null, r.player?.name ?? ''),
          h('span', { class: 'vic-chip' }, r.rating ? '★'.repeat(r.rating) : '')),
        h('div', { class: 'vic-meta' }, `${formatDate(r.match_date)}${r.opponent ? ' vs ' + r.opponent : ''}`),
        r.went_well ? h('p', null, h('b', null, 'Went well: '), r.went_well) : null,
        r.work_on ? h('p', null, h('b', null, 'Work on: '), r.work_on) : null,
        r.match_thoughts ? h('p', null, h('b', null, 'The match: '), r.match_thoughts) : null,
      )) : h('p', { class: 'vic-empty' }, 'No reviews yet.'),
      h('h2', { class: 'vic-h2' }, 'Good words about teammates'),
      praise.length ? praise.map((x) => h('div', { class: 'vic-card' },
        h('div', { class: 'vic-meta' }, `${formatDate(x.match_date)}: ${x.from?.name} about ${x.about?.name}`), h('p', null, x.note)))
        : h('p', { class: 'vic-empty' }, 'None yet.'),
      h('h2', { class: 'vic-h2' }, 'Anonymous notes to you'),
      notes.length ? notes.map((x) => h('div', { class: 'vic-card' },
        h('div', { class: 'vic-meta' }, formatDate(x.match_date)), h('p', null, x.nothing_to_change ? 'Nothing to change.' : x.body)))
        : h('p', { class: 'vic-empty' }, 'None yet.'));
  };

  // ── Feedback ───────────────────────────────────────────────────────────────
  const feedbackView = () => {
    const bind = (el: any, key: keyof typeof fb) => { el.addEventListener('input', () => { (fb as any)[key] = el.value; }); return el; };
    const to = h('select', { id: 'fb-to', class: 'field' }, h('option', { value: 'team' }, 'The whole team'),
      players().map((p) => h('option', { value: p.id, selected: fb.audience === p.id }, p.name)));
    to.addEventListener('change', () => { fb.audience = to.value; });
    const topic = h('select', { id: 'fb-topic', class: 'field' },
      Object.entries(TOPIC).map(([k, v]) => h('option', { value: k, selected: fb.topic === k }, v)));
    topic.addEventListener('change', () => { fb.topic = topic.value; });
    return h('main', { class: 'vic-main' },
      h('h1', { class: 'vic-h1' }, 'Write feedback'),
      h('div', { class: 'vic-card' },
        field('To', to), field('About', topic),
        field('Date it is about (optional)', bind(h('input', { type: 'date', id: 'fb-date', value: fb.date }), 'date')),
        field('Title (optional)', bind(h('input', { type: 'text', id: 'fb-title', maxlength: 120, value: fb.title }), 'title')),
        field('Your feedback', bind(h('textarea', { id: 'fb-body', rows: 6, maxlength: 8000 }, fb.body), 'body')),
        h('button', { class: 'vic-send', id: 'fb-send', disabled: busy, onclick: sendFeedback }, 'Send feedback')),
      h('p', { class: 'vic-note', id: 'msg', role: 'status' }, message),
      h('h2', { class: 'vic-h2' }, 'Sent'),
      feedback.length ? feedback.map((f) => {
        const seen = reads.filter((r) => r.feedback_id === f.id).length;
        return h('article', { class: 'vic-card' },
          h('div', { class: 'vic-row' },
            h('span', { class: 'vic-chip' }, f.audience === 'team' ? 'To the team' : `To ${f.player?.name ?? 'a player'}`),
            h('span', { class: 'vic-chip vic-chip--plain' }, TOPIC[f.topic] ?? f.topic),
            h('span', { class: 'vic-meta' }, f.audience === 'team' ? `${seen} read` : seen ? 'Read' : 'Not read yet')),
          f.title ? h('h3', { class: 'vic-h3' }, f.title) : null,
          h('p', { class: 'vic-body' }, f.body),
          h('div', { class: 'vic-row' }, h('span', { class: 'vic-meta' }, formatDate(f.ref_date ?? f.created_at)),
            h('button', { class: 'vic-link vic-link--danger', type: 'button', onclick: () => {
              if (confirm('Delete this feedback? Players will no longer see it.')) act(async () => { const { error } = await sb.from('feedback').delete().eq('id', f.id); if (error) throw error; }, 'Deleted.');
            } }, 'Delete')));
      }) : h('p', { class: 'vic-empty' }, 'Nothing sent yet.'));
  };

  const sendFeedback = () => {
    if (!fb.body.trim()) { message = 'Write something first.'; draw(); return; }
    act(async () => {
      const { error } = await sb.from('feedback').insert({
        audience: fb.audience === 'team' ? 'team' : 'player',
        player_id: fb.audience === 'team' ? null : fb.audience,
        topic: fb.topic, ref_date: fb.date || null, title: fb.title.trim() || null, body: fb.body.trim(),
      });
      if (error) throw error;
      fb = { ...fb, title: '', body: '', date: '' };
    }, 'Sent.');
  };

  // ── Files ──────────────────────────────────────────────────────────────────
  const filesView = () => {
    const kind = h('select', { id: 'up-kind', class: 'field' }, KIND_ORDER.map((k) => h('option', { value: k, selected: up.kind === k }, KIND_LABEL[k])));
    kind.addEventListener('change', () => { up.kind = kind.value; });
    const title = h('input', { type: 'text', id: 'up-title', maxlength: 160, value: up.title, placeholder: 'Leave empty to use the file name' });
    title.addEventListener('input', () => { up.title = title.value; });
    const date = h('input', { type: 'date', id: 'up-date', value: up.date });
    date.addEventListener('input', () => { up.date = date.value; });
    const file = h('input', { type: 'file', id: 'up-file', accept: '.pdf,.pptx,.ppt,.png,.jpg,.jpeg' });
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) upload(f); });
    return h('main', { class: 'vic-main' },
      h('h1', { class: 'vic-h1' }, 'Files'),
      h('div', { class: 'vic-card' },
        h('p', { class: 'vic-lede' }, 'Upload slides or a PDF. It goes live for the players right away. You can hide it again.'),
        field('Type', kind), field('Title', title), field('Match date (optional)', date),
        h('div', { class: 'vic-field' }, file)),
      h('p', { class: 'vic-note', id: 'msg', role: 'status' }, message),
      KIND_ORDER.map((k) => {
        const rows = files.filter((f) => f.kind === k);
        return rows.length ? h('section', null, h('h2', { class: 'vic-h2' }, KIND_LABEL[k]),
          h('div', { class: 'vic-docs' }, rows.map((f) => fileCard(f, [
            h('button', { class: 'vic-link', type: 'button', 'data-pub': f.id, onclick: () => act(async () => {
              const { error } = await sb.from('files').update({ published_at: f.published_at ? null : new Date().toISOString() }).eq('id', f.id);
              if (error) throw error;
            }) }, f.published_at ? 'Live. Hide' : 'Hidden. Publish'),
            h('button', { class: 'vic-link vic-link--danger', type: 'button', onclick: () => {
              if (confirm(`Delete "${f.title}"? This cannot be undone.`)) act(async () => {
                const { error } = await sb.from('files').delete().eq('id', f.id);
                if (error) throw error;
                await sb.storage.from('team-files').remove([f.storage_path]);
              }, 'Deleted.');
            } }, 'Delete'),
          ])))) : null;
      }));
  };

  const upload = (file: File) => act(async () => {
    if (file.size > 50 * 1024 * 1024) throw new Error('That file is over 50 MB. Make it smaller.');
    const ext = (file.name.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '').toLowerCase();
    const path = `${crypto.randomUUID()}${ext}`;
    const mime = file.type || (ext === '.pdf' ? 'application/pdf' : 'application/octet-stream');
    const put = await sb.storage.from('team-files').upload(path, file, { contentType: mime });
    if (put.error) throw new Error('The upload failed. Check the file type and size.');
    const { error } = await sb.from('files').insert({
      kind: up.kind, title: up.title.trim() || file.name.replace(/\.[^.]+$/, ''), storage_path: path, mime,
      size_bytes: file.size, match_date: up.date || null, published_at: new Date().toISOString(),
    });
    if (error) { await sb.storage.from('team-files').remove([path]); throw error; }
    up = { ...up, title: '', date: '' };
  }, 'Uploaded and live.');

  // ── Squad ──────────────────────────────────────────────────────────────────
  const statusText = (m: Squad) =>
    !m.active ? 'Switched off'
      : m.has_login ? 'Signed up'
      : m.invite_expires_at ? `Code waiting until ${formatDate(m.invite_expires_at)}` : 'No code yet';

  const squadView = () => {
    const name = h('input', { type: 'text', id: 'new-name', maxlength: 60, placeholder: 'First name' });
    return h('main', { class: 'vic-main' },
      h('h1', { class: 'vic-h1' }, 'Squad'),
      newCode ? h('div', { class: 'vic-card vic-code-card', id: 'code-card' },
        h('p', { class: 'vic-lede' }, `One-time code for ${newCode.name}. Send it to her yourself. It works once and lasts 14 days. You will not see it again.`),
        h('div', { class: 'vic-code-big', id: 'code-value' }, newCode.code),
        h('button', { class: 'vic-send vic-send--ghost', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(newCode!.code); message = 'Copied.'; } catch { message = 'Copy it by hand.'; } draw(); } }, 'Copy code'),
        h('button', { class: 'vic-link', type: 'button', onclick: () => { newCode = null; draw(); } }, 'Done')) : null,
      h('p', { class: 'vic-note', id: 'msg', role: 'status' }, message),
      squad.map((m) => h('div', { class: `vic-card vic-member ${m.active ? '' : 'vic-member--off'}`, 'data-member': m.name },
        h('div', { class: 'vic-row' }, h('strong', null, m.name + (m.role === 'coach' ? ' (coach)' : '')), h('span', { class: 'vic-meta' }, statusText(m))),
        m.role === 'player' ? h('div', { class: 'vic-meta' }, `${m.reflections} reviews${m.last_match ? ', last on ' + formatDate(m.last_match) : ''}`) : null,
        h('div', { class: 'vic-row vic-row--left' },
          m.active ? h('button', { class: 'vic-link', type: 'button', 'data-code': m.name, onclick: () => act(async () => {
            const { data, error } = await sb.rpc('issue_invite', { p_member_id: m.id });
            if (error) throw error;
            newCode = { id: m.id, name: m.name, code: data as string };
          }) }, m.has_login ? 'Code for a new phone' : 'Get a code') : null,
          m.id !== me.id ? h('button', { class: 'vic-link vic-link--danger', type: 'button', onclick: () => {
            const next = !m.active;
            if (!next && !confirm(`Switch off ${m.name}? She will no longer be able to sign in or see anything.`)) return;
            act(async () => { const { error } = await sb.rpc('set_member_active', { p_id: m.id, p_active: next }); if (error) throw error; });
          } }, m.active ? 'Switch off' : 'Switch on') : null))),
      h('div', { class: 'vic-card' },
        h('h2', { class: 'vic-h2' }, 'Add a player'), field('Name', name),
        h('button', { class: 'vic-send', id: 'add-player', disabled: busy, onclick: () => act(async () => {
          const { error } = await sb.rpc('add_player', { p_name: name.value }); if (error) throw error;
        }, 'Added. Now get her a code.') }, 'Add player')));
  };

  const tabsNav = () => {
    const t = (key: Tab, label: string) => h('button', { class: `vic-tab ${tab === key ? 'vic-tab--on' : ''}`, type: 'button', 'data-tab': key,
      onclick: () => { tab = key; message = ''; draw(); } }, label);
    return h('nav', { class: 'vic-tabs' }, t('reflections', 'Reviews'), t('feedback', 'Feedback'), t('files', 'Files'), t('squad', 'Squad'));
  };

  const draw = () => {
    const out = h('button', { class: 'vic-whoami', id: 'signout', type: 'button', onclick: onSignOut }, `${me.name} · sign out`);
    const body = loadError ? h('main', { class: 'vic-main' }, h('p', { class: 'vic-error' }, loadError), h('button', { class: 'vic-send vic-send--ghost', onclick: load }, 'Try again'))
      : tab === 'reflections' ? reflectionsView() : tab === 'feedback' ? feedbackView() : tab === 'files' ? filesView() : squadView();
    mount(root, header('coach', out), tabsNav(), body);
  };

  draw();
  load();
}
