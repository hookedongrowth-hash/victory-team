import './quiz.css';
import { clear, h, mount } from '../dom';
import { anon, configured, endsAt, getState, isTimeUp, photoUrl, say, sleep, type BoardRow, type State } from './client';

const root = document.getElementById('app') as HTMLElement;
const TOTAL_PHOTOS = 22;

interface Question { seq: number; photo: string; options: string[] }
interface Session { round: string; id: string; name: string; next: number; score: number; total: number; over: boolean }

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let name = store.get('quiz-name') ?? '';
let sess: Session | null = (() => { try { return JSON.parse(store.get('quiz-session') ?? 'null'); } catch { return null; } })();
let note = '';
let playing = false;
let shown = '';
let prefill = '';
let timer: number | undefined;

const save = () => { if (sess) store.set('quiz-session', JSON.stringify(sess)); };
const stopTimer = () => { if (timer) { clearInterval(timer); timer = undefined; } };

// Warm the photos while everyone waits, so the first question is instant.
let warmed = false;
function warm() {
  if (warmed) return;
  warmed = true;
  for (let i = 1; i <= TOTAL_PHOTOS; i++) new Image().src = photoUrl(`q${String(i).padStart(2, '0')}.jpg`);
}

// ── Screens ──────────────────────────────────────────────────────────────────
function shell(...kids: (Node | null)[]) {
  mount(root, h('main', { class: 'qz-main' }, ...kids.filter(Boolean) as Node[]));
}

const JokerNote = () => h('p', { class: 'qz-prize' },
  h('span', { class: 'qz-joker', 'aria-hidden': 'true' }, 'J'),
  h('span', null, h('strong', null, 'The winner gets 1 Joker.'), ' Skip one training, no explanation needed.'));

function screenName() {
  stopTimer(); shown = 'name';
  const input = h('input', {
    id: 'qz-name', type: 'text', maxlength: '24', autocomplete: 'given-name', autocapitalize: 'words',
    placeholder: 'Your first name', value: prefill || name,
  });
  const go = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    name = v; store.set('quiz-name', v); note = '';
    tick();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  shell(
    h('div', { class: 'qz-badge' }, 'Dames 1'),
    h('h1', { class: 'qz-title' }, 'Name the H1 player'),
    h('p', { class: 'qz-lede' }, 'Photos of the men\'s first team. Pick the right name, as fast as you can. Most right answers wins.'),
    JokerNote(),
    h('label', { class: 'qz-label', for: 'qz-name' }, 'Your name'),
    input,
    h('p', { class: 'qz-error', role: 'alert' }, note),
    h('button', { class: 'qz-go', onclick: go }, 'I\'m ready'),
  );
}

function screenLobby(extra = '') {
  stopTimer(); warm(); shown = 'lobby';
  shell(
    h('div', { class: 'qz-pulse', 'aria-hidden': 'true' }),
    h('h1', { class: 'qz-title' }, `You're in, ${name}.`),
    h('p', { class: 'qz-lede' }, extra || 'Keep this screen open. The quiz starts the moment the coach presses start.'),
    h('p', { class: 'qz-hint' }, 'It lasts about a minute and a half. Be fast.'),
    h('button', { class: 'qz-link', onclick: () => { name = ''; store.set('quiz-name', ''); tick(); } }, 'Not you? Change name'),
  );
}

function screenWaiting(s: Session, finished: boolean) {
  stopTimer(); shown = 'waiting';
  shell(
    h('div', { class: 'qz-badge' }, finished ? 'All done' : 'Time is up'),
    h('h1', { class: 'qz-title' }, `${s.score} of ${s.total} right`),
    h('p', { class: 'qz-lede' }, finished
      ? 'You answered every photo. Waiting for the clock to run out, then the winner shows here.'
      : 'Waiting for the winner. It shows here in a moment.'),
    h('div', { class: 'qz-pulse', 'aria-hidden': 'true' }),
  );
}

function screenResult(s: State, mine: Session | null) {
  stopTimer(); shown = 'result';
  const board = s.board ?? [];
  const winner = board[0];
  const iWon = Boolean(mine && winner && winner.name === mine.name && winner.score > 0);
  const rows = board.map((r: BoardRow, i: number) =>
    h('li', { class: 'qz-row' + (mine && r.name === mine.name ? ' qz-row--me' : '') },
      h('span', { class: 'qz-rank' }, String(i + 1)),
      h('span', { class: 'qz-who' }, r.name),
      h('span', { class: 'qz-pts' }, String(r.score))));
  const mineOut = mine && !board.some((r) => r.name === mine.name)
    ? h('p', { class: 'qz-hint' }, `You scored ${mine.score}.`) : null;
  shell(
    h('div', { class: 'qz-badge' }, 'Final result'),
    winner && winner.score > 0
      ? h('div', { class: 'qz-winner' },
          h('span', { class: 'qz-joker qz-joker--big', 'aria-hidden': 'true' }, 'J'),
          h('p', { class: 'qz-winner__label' }, iWon ? 'That is you!' : 'Winner'),
          h('h1', { class: 'qz-winner__name' }, winner.name),
          h('p', { class: 'qz-winner__sub' }, `${winner.score} right. Wins 1 Joker.`))
      : h('h1', { class: 'qz-title' }, 'No winner this time'),
    iWon ? h('p', { class: 'qz-lede' }, 'Show this screen to the coach to collect your Joker.') : null,
    rows.length ? h('ol', { class: 'qz-board' }, ...rows) : null,
    mineOut,
    h('p', { class: 'qz-hint' }, 'Keep this open. If the coach starts another round it starts here by itself.'),
  );
}

// ── Playing ──────────────────────────────────────────────────────────────────
async function sendAnswer(player: string, seq: number, choice: string):
  Promise<{ correct: boolean; answer: string | null } | 'late' | 'failed'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await anon.rpc('quiz_answer', { p_player: player, p_seq: seq, p_choice: choice });
    if (!error) return data as { correct: boolean; answer: string | null };
    if (isTimeUp(error)) return 'late';
    await sleep(250);
  }
  return 'failed';
}

async function play(s: State, me: Session) {
  playing = true; shown = 'play';
  const { data, error } = await anon.rpc('quiz_questions', { p_player: me.id });
  const qs = (data ?? []) as Question[];
  if (error || !qs.length) { playing = false; note = error ? say(error) : ''; screenLobby(note); return; }
  me.total = qs.length; save();
  const deadline = endsAt(s);

  const bar = h('div', { class: 'qz-timebar__fill' });
  const clock = h('span', { class: 'qz-clock' }, '');
  const score = h('span', { class: 'qz-score' }, '');
  const photo = h('img', { class: 'qz-photo', alt: 'Who is this?', width: '320', height: '320' }) as HTMLImageElement;
  const options = h('div', { class: 'qz-options' });
  const nth = h('span', { class: 'qz-nth' }, '');
  mount(root, h('main', { class: 'qz-play' },
    h('div', { class: 'qz-top' }, clock, nth, score),
    h('div', { class: 'qz-timebar' }, bar),
    h('div', { class: 'qz-stage' }, photo),
    options));

  let release: ((v: string | null) => void) | null = null;
  const total = Math.max(1, deadline - Date.now());
  const paint = () => {
    const left = Math.max(0, deadline - Date.now());
    clock.textContent = String(Math.ceil(left / 1000));
    bar.style.transform = `scaleX(${left / total})`;
    clock.classList.toggle('qz-clock--low', left < 15000);
    if (left <= 0 && release) { const r = release; release = null; r(null); }
  };
  stopTimer(); paint(); timer = window.setInterval(paint, 150);
  const paintScore = () => { score.textContent = `${me.score} right`; };
  paintScore();

  let finished = true;
  for (let i = me.next; i <= qs.length; i++) {
    if (Date.now() >= deadline) { finished = false; break; }
    const q = qs[i - 1];
    photo.src = photoUrl(q.photo);
    nth.textContent = `${i} of ${qs.length}`;
    clear(options);
    const choice = await new Promise<string | null>((resolve) => {
      release = resolve;
      for (const opt of q.options) {
        const b = h('button', { class: 'qz-opt', type: 'button' }, opt);
        b.addEventListener('click', () => { if (release) { const r = release; release = null; r(opt); } });
        options.append(b);
      }
    });
    if (choice === null) { finished = false; break; }
    const buttons = Array.from(options.querySelectorAll<HTMLButtonElement>('.qz-opt'));
    buttons.forEach((b) => { b.disabled = true; if (b.textContent === choice) b.classList.add('qz-opt--picked'); });
    const res = await sendAnswer(me.id, q.seq, choice);
    if (res === 'late') { finished = false; break; }
    if (res !== 'failed') {
      buttons.forEach((b) => {
        if (b.textContent === choice) b.classList.add(res.correct ? 'qz-opt--right' : 'qz-opt--wrong');
        if (!res.correct && b.textContent === res.answer) b.classList.add('qz-opt--right');
      });
      if (res.correct) { me.score++; paintScore(); }
      await sleep(res.correct ? 220 : 650);
    }
    me.next = i + 1; save();
  }
  playing = false;
  me.over = true; save();
  stopTimer();
  screenWaiting(me, finished);
}

// ── The loop that decides what to show ───────────────────────────────────────
const TEN_MINUTES = 10 * 60 * 1000;

async function tick() {
  if (playing) return;
  if (!configured) { shell(h('h1', { class: 'qz-title' }, 'Not ready yet'), h('p', { class: 'qz-lede' }, 'The quiz is not connected. Ask the coach.')); return; }
  if (!name) { if (shown !== 'name') screenName(); return; }
  let s: State;
  try { s = await getState(); } catch { return; } // keep what is on the screen, try again next tick
  if (playing) return;

  if (s.status === 'open') {
    if (sess && sess.round === s.round_id) {
      if (sess.over) { if (shown !== 'waiting') screenWaiting(sess, sess.next > sess.total); return; }
      play(s, sess); return;
    }
    const { data, error } = await anon.rpc('quiz_join', { p_name: name });
    if (error) {
      note = say(error); prefill = name; name = ''; store.set('quiz-name', '');
      screenName(); return;
    }
    sess = { round: s.round_id!, id: data as string, name, next: 1, score: 0, total: 0, over: false };
    save(); play(s, sess); return;
  }

  if (s.status === 'closed' && Date.now() + s.offset - Date.parse(s.closes_at!) < TEN_MINUTES) {
    const mine = sess && sess.round === s.round_id ? sess : null;
    if (!mine && (!s.board || !s.board.length)) { if (shown !== 'lobby') screenLobby(); return; }
    if (shown !== 'result') screenResult(s, mine);
    return;
  }
  if (shown !== 'lobby') screenLobby();
}

if (name) screenLobby(); else screenName();
tick();
setInterval(tick, 1500);
