import './quiz.css';
import { clear, h, mount } from '../dom';
import { configured as appConfigured, loadMe, sb } from '../api';
import { BASE, endsAt, getState, say, type State } from './client';

const root = document.getElementById('app') as HTMLElement;
const playUrl = `${location.origin}${BASE}quiz/`;

interface Answer { seq: number; who: string; choice: string; correct: boolean }
interface PlayerRow { name: string; score: number; answered: number; finished_secs: number | null; answers: Answer[] }
interface Results { round_id: string | null; opened_at?: string; closes_at?: string; seconds?: number; open?: boolean; players: PlayerRow[] }

function header() {
  return h('header', { class: 'qz-host-head' },
    h('div', { class: 'qz-badge' }, 'Coach'),
    h('h1', { class: 'qz-host-title' }, 'Name the H1 player'));
}

function needSignIn(text: string) {
  mount(root, h('main', { class: 'qz-main' }, header(),
    h('p', { class: 'qz-lede' }, text),
    h('a', { class: 'qz-go qz-go--a', href: BASE }, 'Open the Victory app'),
    h('button', { class: 'qz-link', onclick: () => location.reload() }, 'I have signed in, reload')));
}

async function start() {
  if (!appConfigured) { needSignIn('The app is not connected to its database yet.'); return; }
  const me = await loadMe().catch(() => null);
  if (!me) { needSignIn('Sign in to the Victory app as the coach first. Then come back to this page.'); return; }
  if (me.role !== 'coach') { needSignIn('Only the coach can run the quiz.'); return; }
  host();
}

function host() {
  const share = h('section', { class: 'qz-card qz-share' },
    h('img', { class: 'qz-qr', src: `${BASE}quiz-qr.svg`, alt: 'QR code for the quiz', width: '220', height: '220' }),
    h('div', { class: 'qz-share__text' },
      h('p', { class: 'qz-share__label' }, 'The girls scan this'),
      h('p', { class: 'qz-share__url' }, playUrl),
      h('button', { class: 'qz-chip', onclick: async (e: Event) => {
        const b = e.currentTarget as HTMLButtonElement;
        try { await navigator.clipboard.writeText(playUrl); b.textContent = 'Copied'; } catch { b.textContent = 'Press and hold the link to copy'; }
        setTimeout(() => { b.textContent = 'Copy link'; }, 2000);
      } }, 'Copy link')));
  const control = h('section', { class: 'qz-card' });
  const results = h('section', { class: 'qz-results' });
  mount(root, h('main', { class: 'qz-main qz-main--wide' }, header(), share, control, results));

  const openRows = new Set<string>();
  let seconds = 90;
  let busy = false;
  let state: State | null = null;
  let data: Results | null = null;
  let ctrlKey = '';
  let resKey = '';
  let countEl: HTMLElement | null = null;
  let flash = '';
  let clockEl: HTMLElement | null = null;

  async function begin() {
    if (busy) return; busy = true; flash = '';
    const { error } = await sb.rpc('quiz_open', { p_seconds: seconds });
    busy = false;
    if (error) flash = say(error);
    await refresh();
  }
  async function stop() {
    if (busy) return; busy = true;
    await sb.rpc('quiz_stop');
    busy = false;
    await refresh();
  }

  function drawControl() {
    clear(control);
    clockEl = null; countEl = null;
    if (!state) { control.append(h('p', { class: 'qz-lede' }, 'Connecting...')); return; }
    if (state.status === 'open') {
      clockEl = h('div', { class: 'qz-bigclock' }, '');
      const count = h('p', { class: 'qz-lede' }, `${state.players ?? 0} playing now`);
      countEl = count;
      control.append(
        h('p', { class: 'qz-share__label' }, 'Quiz is open'),
        clockEl,
        count,
        h('button', { class: 'qz-go qz-go--ghost', onclick: stop }, 'Stop now'));
      tickClock();
      return;
    }
    const picks = [60, 90, 120].map((n) =>
      h('button', { class: 'qz-chip' + (n === seconds ? ' qz-chip--on' : ''), onclick: () => { seconds = n; drawControl(); } },
        n === 90 ? '1:30' : n === 60 ? '1:00' : '2:00'));
    control.append(
      h('p', { class: 'qz-share__label' }, state.status === 'closed' ? 'Round finished' : 'Ready when the girls are'),
      h('div', { class: 'qz-chips' }, ...picks),
      h('button', { class: 'qz-go', onclick: begin }, state.status === 'closed' ? 'Start a new round' : 'Start the quiz'),
      h('p', { class: 'qz-error', role: 'alert' }, flash));
  }

  function tickClock() {
    if (!clockEl || !state || state.status !== 'open') return;
    const left = Math.max(0, Math.ceil((endsAt(state) - Date.now()) / 1000));
    clockEl.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }

  const fmtTime = (s: number | null) => (s == null ? 'no right answers' : `last right at ${s}s`);

  function drawResults() {
    clear(results);
    if (!data || !data.round_id) {
      results.append(h('div', { class: 'qz-card' }, h('p', { class: 'qz-lede' }, 'No round yet. The results and the winner appear here by themselves.')));
      return;
    }
    const closed = !data.open;
    const top = data.players[0];
    if (closed && top && top.score > 0) {
      results.append(h('div', { class: 'qz-card qz-winnercard' },
        h('span', { class: 'qz-joker qz-joker--big', 'aria-hidden': 'true' }, 'J'),
        h('p', { class: 'qz-winner__label' }, 'Winner'),
        h('h2', { class: 'qz-winner__name' }, top.name),
        h('p', { class: 'qz-winner__sub' }, `${top.score} right, ${fmtTime(top.finished_secs)}. Gets 1 Joker.`)));
    } else if (closed) {
      results.append(h('div', { class: 'qz-card' }, h('p', { class: 'qz-lede' }, data.players.length ? 'Nobody got one right.' : 'Nobody played.')));
    }
    const list = h('div', { class: 'qz-card' },
      h('p', { class: 'qz-share__label' }, closed ? `All results (${data.players.length} players)` : `Live scores (${data.players.length} players)`));
    data.players.forEach((p, i) => {
      const d = h('details', { class: 'qz-player' },
        h('summary', null,
          h('span', { class: 'qz-rank' }, String(i + 1)),
          h('span', { class: 'qz-who' }, p.name),
          h('span', { class: 'qz-pts' }, `${p.score}/${p.answered}`)),
        h('p', { class: 'qz-hint' }, `${p.score} right out of ${p.answered} answered, ${fmtTime(p.finished_secs)}.`),
        h('ul', { class: 'qz-answers' }, ...p.answers.map((a) =>
          h('li', { class: a.correct ? 'qz-yes' : 'qz-no' },
            h('strong', null, a.who), a.correct ? ' answered right' : ` answered ${a.choice}`))));
      if (openRows.has(p.name)) d.setAttribute('open', '');
      d.addEventListener('toggle', () => { if (d.open) openRows.add(p.name); else openRows.delete(p.name); });
      list.append(d);
    });
    if (!data.players.length) list.append(h('p', { class: 'qz-lede' }, 'Waiting for the first player...'));
    results.append(list);
  }

  async function refresh() {
    try {
      const s = await getState(sb);
      const r = await sb.rpc('quiz_results');
      if (r.error) throw r.error;
      state = s; data = r.data as Results;
      const ck = [s.status, s.round_id, seconds, flash].join('|');
      if (ck !== ctrlKey) { ctrlKey = ck; drawControl(); }
      if (countEl) countEl.textContent = `${s.players ?? 0} playing now`;
      const rk = JSON.stringify(data);
      if (rk !== resKey) { resKey = rk; drawResults(); }
    } catch (e) {
      if (!state) { clear(control); control.append(h('p', { class: 'qz-error' }, say(e))); }
    }
  }

  drawControl();
  refresh();
  setInterval(refresh, 1500);
  setInterval(tickClock, 250);
}

start();
