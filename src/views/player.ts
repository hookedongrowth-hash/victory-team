import { h, mount, formatDate, today } from '../dom';
import { sb, say, type Me } from '../api';
import { assignTeammates, OPPONENTS, validateReview, type Person } from '../squad-match';
import { fileCard, KIND_LABEL, KIND_ORDER, type FileRow } from '../files-ui';
import { header } from './signin';

type Tab = 'review' | 'feedback' | 'files';
interface Feedback { id: string; audience: string; topic: string; ref_date: string | null; title: string | null; body: string; created_at: string }
interface Review { id: string; match_date: string; opponent: string | null; rating: number | null; went_well: string | null; work_on: string | null; match_thoughts: string | null }

const TOPIC: Record<string, string> = { match: 'About a match', training: 'About training', general: 'About you' };

export function showPlayer(root: HTMLElement, me: Me, onSignOut: () => void) {
  let tab: Tab = 'review';
  let squad: Person[] = [];
  let feedback: Feedback[] = [];
  let reads = new Set<string>();
  let unreadAtLoad = new Set<string>();
  let files: FileRow[] = [];
  let reviews: Review[] = [];
  let form = { date: today(), opponent: '', rating: 0, wentWell: '', workOn: '', thoughts: '', note: '', coachNothing: false, coachBody: '' };
  let sent: 'no' | 'yes' = 'no';
  let sending = false;
  let error = '';
  let loadError = '';

  let loadSeq = 0;
  const load = async () => {
    const seq = ++loadSeq;
    const [sq, fb, rd, fl, rv] = await Promise.all([
      sb.rpc('squad'),
      sb.from('feedback').select('id, audience, topic, ref_date, title, body, created_at').order('created_at', { ascending: false }),
      sb.from('feedback_reads').select('feedback_id'),
      sb.from('files').select('*').order('uploaded_at', { ascending: false }),
      sb.from('reflections').select('id, match_date, opponent, rating, went_well, work_on, match_thoughts').order('match_date', { ascending: false }),
    ]);
    if (seq !== loadSeq) return;
    const bad = sq.error || fb.error || rd.error || fl.error || rv.error;
    if (bad) { loadError = 'Could not load your page. Check your connection.'; draw(); return; }
    squad = (sq.data ?? []) as Person[];
    feedback = (fb.data ?? []) as Feedback[];
    reads = new Set((rd.data ?? []).map((r: any) => r.feedback_id));
    unreadAtLoad = new Set(feedback.filter((f) => !reads.has(f.id)).map((f) => f.id));
    files = (fl.data ?? []) as FileRow[];
    reviews = (rv.data ?? []) as Review[];
    loadError = '';
    draw();
  };

  const markRead = async () => {
    for (const id of unreadAtLoad) {
      if (!reads.has(id)) { reads.add(id); sb.rpc('mark_feedback_read', { p_feedback_id: id }).then(() => {}); }
    }
  };

  const tabs = () => {
    const t = (key: Tab, label: string, badge = 0) =>
      h('button', { class: `vic-tab ${tab === key ? 'vic-tab--on' : ''}`, type: 'button', 'data-tab': key,
        onclick: () => { tab = key; if (key === 'feedback') markRead(); draw(); } },
        label, badge > 0 && tab !== key ? h('span', { class: 'vic-dot', 'aria-label': `${badge} new` }, String(badge)) : null);
    return h('nav', { class: 'vic-tabs' }, t('review', 'Match review'), t('feedback', 'Feedback', unreadAtLoad.size - [...unreadAtLoad].filter((i) => reads.has(i)).length), t('files', 'Files'));
  };

  const field = (label: string, node: Node, optional = false) =>
    h('label', { class: 'vic-field' }, h('span', { class: 'vic-label' }, label, optional ? h('em', null, ' optional') : null), node);

  const reviewView = () => {
    if (sent === 'yes') {
      return h('main', { class: 'vic-main vic-main--centred' },
        h('div', { class: 'vic-tick' }, '✓'),
        h('h1', { class: 'vic-h1' }, `Thanks, ${me.name}`),
        h('p', { class: 'vic-lede' }, 'Your match review is in.'),
        h('button', { class: 'vic-send vic-send--ghost', id: 'again', onclick: () => {
          sent = 'no'; form = { ...form, opponent: '', rating: 0, wentWell: '', workOn: '', thoughts: '', note: '', coachNothing: false, coachBody: '' }; draw();
        } }, 'Add another match'));
    }
    const others = squad.filter((p) => p.id !== me.id);
    const mate = assignTeammates(squad, form.date).get(me.id) ?? null;
    const bind = (el: HTMLInputElement | HTMLTextAreaElement, key: keyof typeof form) => {
      el.addEventListener('input', () => { (form as any)[key] = el.value; });
      return el;
    };
    const star = (n: number) => h('button', { class: `vic-star ${form.rating >= n ? 'vic-star--on' : ''}`, type: 'button', 'data-rate': n,
      'aria-label': `${n} out of 5`, onclick: () => { form.rating = n; draw(); } }, form.rating >= n ? '★' : '☆');
    const date = h('input', { type: 'date', id: 'date', value: form.date, max: today() });
    date.addEventListener('change', () => { form.date = date.value; draw(); });
    const existing = reviews.find((r) => r.match_date === form.date);

    return h('main', { class: 'vic-main' },
      h('h1', { class: 'vic-h1' }, 'How did it go?'),
      h('p', { class: 'vic-lede' }, 'Your own read of the match. Only the coach sees this.'),
      existing ? h('p', { class: 'vic-note' }, 'You already sent a review for this date. Sending again replaces it.') : null,
      h('div', { class: 'vic-card' }, h('div', { class: 'vic-card__head' }, h('span', { class: 'vic-step' }, '1'), 'The match'),
        field('Date', date),
        field('Opponent', (() => {
          const i = bind(h('input', { type: 'text', id: 'opponent', list: 'opponents', placeholder: 'Pick or type', value: form.opponent, maxlength: 80 }), 'opponent');
          return h('span', null, i, h('datalist', { id: 'opponents' }, OPPONENTS.map((o) => h('option', { value: o }))));
        })(), true)),
      h('div', { class: 'vic-card' }, h('div', { class: 'vic-card__head' }, h('span', { class: 'vic-step' }, '2'), 'Your own game'),
        h('div', { class: 'vic-stars' }, [1, 2, 3, 4, 5].map(star)),
        h('div', { class: 'vic-scale' }, h('span', null, 'Tough day'), h('span', null, 'Best game yet'))),
      h('div', { class: 'vic-card' }, h('div', { class: 'vic-card__head' }, h('span', { class: 'vic-step' }, '3'), 'In your words'),
        field('What went well', bind(h('textarea', { id: 'well', rows: 2, maxlength: 4000, placeholder: 'One thing you were pleased with' }, form.wentWell), 'wentWell')),
        field('What you want to work on', bind(h('textarea', { id: 'work', rows: 2, maxlength: 4000, placeholder: 'One thing for next week' }, form.workOn), 'workOn')),
        field('The match overall', bind(h('textarea', { id: 'thoughts', rows: 2, maxlength: 4000, placeholder: 'How did the team play?' }, form.thoughts), 'thoughts'), true)),
      mate && others.length ? h('section', { class: 'vic-mate' },
        h('div', { class: 'vic-card__head' }, h('span', { class: 'vic-step' }, '4'), 'Your teammate this week'),
        h('div', { class: 'vic-mate__who' }, h('strong', null, mate.name)),
        h('p', { class: 'vic-mate__ask' }, 'Say one good thing about her. Everyone gets named by somebody. Only the coach reads these.'),
        bind(h('textarea', { id: 'note', rows: 3, maxlength: 2000, placeholder: 'Something she did well today' }, form.note), 'note')) : null,
      existing ? h('p', { class: 'vic-note' }, 'Your anonymous note for this match was already sent, so it is not asked again.') : h('section', { class: 'vic-coach' },
        h('div', { class: 'vic-card__head' }, h('span', { class: 'vic-step' }, '5'), 'Anything for the coach?'),
        h('p', { class: 'vic-coach__ask' }, 'This one is anonymous. The coach sees the words, not who wrote them. Happy as things are is a real answer, so say that rather than skipping.'),
        h('button', { class: `vic-nothing ${form.coachNothing ? 'vic-nothing--on' : ''}`, id: 'nothing', type: 'button',
          onclick: () => { form.coachNothing = !form.coachNothing; if (form.coachNothing) form.coachBody = ''; draw(); } },
          (form.coachNothing ? '✓ ' : '') + 'Nothing to change'),
        bind(h('textarea', { id: 'coachbody', rows: 3, maxlength: 4000, placeholder: 'Or tell the coach what would help you', disabled: form.coachNothing }, form.coachBody), 'coachBody')),
      h('p', { class: 'vic-error', id: 'error', role: 'alert' }, error),
      h('button', { class: 'vic-send', id: 'send', disabled: sending, onclick: () => send(mate) }, sending ? 'Sending...' : 'Send'),
      reviews.length ? h('section', { class: 'vic-past' }, h('h2', { class: 'vic-h2' }, 'Your past reviews'),
        reviews.map((r) => h('div', { class: 'vic-card' },
          h('div', { class: 'vic-row' }, h('strong', null, `${formatDate(r.match_date)}${r.opponent ? ' vs ' + r.opponent : ''}`),
            h('span', { class: 'vic-chip' }, r.rating ? '★'.repeat(r.rating) : '')),
          r.went_well ? h('p', null, h('b', null, 'Went well: '), r.went_well) : null,
          r.work_on ? h('p', null, h('b', null, 'Work on: '), r.work_on) : null,
          r.match_thoughts ? h('p', null, h('b', null, 'The match: '), r.match_thoughts) : null))) : null);
  };

  const send = async (mate: Person | null) => {
    const check = validateReview({ rating: form.rating, wentWell: form.wentWell, workOn: form.workOn, teammateId: mate?.id, teammateNote: form.note });
    if (!check.ok) {
      const first = check.errors[0];
      error = first === 'rating' ? 'Give your own game a score from 1 to 5.'
        : first === 'wentWell' ? 'Add one thing that went well.'
        : first === 'workOn' ? 'Add one thing you want to work on.'
        : `Add one good thing about ${mate?.name ?? 'your teammate'}.`;
      draw(); return;
    }
    sending = true; error = ''; draw();
    const { error: err } = await sb.rpc('submit_reflection', {
      p_match_date: form.date, p_opponent: form.opponent, p_rating: form.rating,
      p_went_well: form.wentWell, p_work_on: form.workOn, p_match_thoughts: form.thoughts || null,
      p_mate_id: mate?.id ?? null, p_mate_note: mate ? form.note : null,
      p_coach_nothing: reviews.some((r) => r.match_date === form.date) ? false : form.coachNothing,
      p_coach_body: reviews.some((r) => r.match_date === form.date) || form.coachNothing ? null : form.coachBody || null,
    });
    sending = false;
    if (err) { error = say(err); draw(); return; }
    sent = 'yes';
    const rv = await sb.from('reflections').select('id, match_date, opponent, rating, went_well, work_on, match_thoughts').order('match_date', { ascending: false });
    if (rv.data) reviews = rv.data as Review[];
    draw();
  };

  const feedbackView = () => h('main', { class: 'vic-main' },
    h('h1', { class: 'vic-h1' }, 'Feedback'),
    h('p', { class: 'vic-lede' }, 'From your coach, to you or to the whole team.'),
    feedback.length ? feedback.map((f) => h('article', { class: 'vic-card vic-fb', 'data-audience': f.audience },
      h('div', { class: 'vic-row' },
        h('span', { class: 'vic-chip' }, f.audience === 'team' ? 'To the team' : 'Just for you'),
        h('span', { class: 'vic-chip vic-chip--plain' }, TOPIC[f.topic] ?? f.topic),
        unreadAtLoad.has(f.id) ? h('span', { class: 'vic-chip vic-chip--new' }, 'New') : null),
      f.title ? h('h2', { class: 'vic-h2' }, f.title) : null,
      h('p', { class: 'vic-body' }, f.body),
      h('div', { class: 'vic-meta' }, formatDate(f.ref_date ?? f.created_at)))) : h('p', { class: 'vic-empty' }, 'Nothing yet. When your coach writes to you, it appears here.'));

  const filesView = () => {
    const groups = KIND_ORDER.map((k) => ({ k, rows: files.filter((f) => f.kind === k) })).filter((g) => g.rows.length);
    return h('main', { class: 'vic-main' },
      h('h1', { class: 'vic-h1' }, 'Slides and files'),
      groups.length ? groups.map((g) => h('section', null, h('h2', { class: 'vic-h2' }, KIND_LABEL[g.k]), h('div', { class: 'vic-docs' }, g.rows.map((f) => fileCard(f)))))
        : h('p', { class: 'vic-empty' }, 'Nothing posted yet.'));
  };

  const draw = () => {
    const out = h('button', { class: 'vic-whoami', id: 'signout', type: 'button', onclick: onSignOut }, `${me.name} · sign out`);
    const body = loadError ? h('main', { class: 'vic-main' }, h('p', { class: 'vic-error' }, loadError), h('button', { class: 'vic-send vic-send--ghost', onclick: load }, 'Try again'))
      : tab === 'review' ? reviewView() : tab === 'feedback' ? feedbackView() : filesView();
    mount(root, header('', out), tabs(), body);
  };

  draw();
  load();
}
