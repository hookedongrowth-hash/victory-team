import { h, mount } from '../dom';
import {
  configured, finishClaim, loginWithPasskey, passkeysSupported, prepareLogin, say, startClaim, type LoginTicket,
} from '../api';

export function header(sub?: string, right?: Node | null) {
  return h('header', { class: 'vic-header' },
    h('img', { class: 'vic-header__crest', src: `${import.meta.env.BASE_URL}crest.png`, alt: 'Royal Victory H.C.' }),
    h('div', null, h('div', { class: 'vic-header__club' }, 'Royal Victory H.C.'),
      h('div', { class: 'vic-header__team' }, ['Dames 1', sub].filter(Boolean).join(' · '))),
    right ?? null);
}

export function showSignIn(root: HTMLElement, onDone: () => void, note = '') {
  let mode: 'login' | 'code' | 'create' = 'login';
  let ticket: LoginTicket | null = null;
  let claim: { challengeId: string; options: any; name: string } | null = null;
  let busy = false;
  let ready = false;
  let error = note;

  // Get the sign-in options ready before the tap, so the prompt opens at once.
  const warm = () => {
    if (!configured || !passkeysSupported()) return;
    prepareLogin().then((t) => { ticket = t; ready = true; if (mode === 'login' && !busy) draw(); })
      .catch(() => { ticket = null; ready = true; if (mode === 'login' && !busy) draw(); });
  };
  // Keep the options fresh, so the phone's prompt always opens straight from the tap.
  const refresh = () => { if (mode === 'login' && !busy && (!ticket || Date.now() - ticket.at > 2 * 60_000)) warm(); };
  setInterval(refresh, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

  const draw = () => {
    const msg = h('p', { class: 'vic-error', role: 'alert', id: 'msg' }, error);
    let body: Node;
    if (!configured) {
      body = h('p', { class: 'vic-lede' }, 'This app is not connected to its database yet.');
    } else if (!passkeysSupported()) {
      body = h('p', { class: 'vic-lede' }, 'This browser cannot use Face ID or fingerprint sign in. Open the app in Safari on iPhone or Chrome on Android.');
    } else if (mode === 'login') {
      body = h('div', null,
        h('h1', { class: 'vic-h1' }, 'Welcome'),
        h('p', { class: 'vic-lede' }, 'Sign in with Face ID or your fingerprint.'),
        msg,
        h('button', { class: 'vic-send', id: 'signin', disabled: busy || !ready, onclick: doLogin }, busy || !ready ? 'One moment...' : 'Sign in'),
        h('p', { class: 'vic-lede', style: 'margin-top:28px' }, 'First time here? The coach gives you a one-time code.'),
        h('button', { class: 'vic-send vic-send--ghost', id: 'havecode', onclick: () => { mode = 'code'; error = ''; draw(); } }, 'I have a code'));
    } else if (mode === 'code') {
      const input = h('input', {
        type: 'text', id: 'code', autocomplete: 'one-time-code', autocapitalize: 'characters',
        autocorrect: 'off', spellcheck: 'false', placeholder: 'ABCDE-FGHJK', class: 'vic-code',
      });
      input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') doCode(input.value); });
      body = h('div', null,
        h('h1', { class: 'vic-h1' }, 'Your code'),
        h('p', { class: 'vic-lede' }, 'Type the one-time code the coach sent you.'),
        input, msg,
        h('button', { class: 'vic-send', id: 'codego', disabled: busy, onclick: () => doCode(input.value) }, busy ? 'Checking...' : 'Continue'),
        h('button', { class: 'vic-send vic-send--ghost', onclick: () => { mode = 'login'; error = ''; draw(); } }, 'Back'));
    } else {
      body = h('div', null,
        h('h1', { class: 'vic-h1' }, `Hi ${claim!.name}`),
        h('p', { class: 'vic-lede' }, 'Now make your login. Your phone will ask for Face ID or your fingerprint. After that, this is how you open the app.'),
        msg,
        h('button', { class: 'vic-send', id: 'create', disabled: busy, onclick: doCreate }, busy ? 'One moment...' : 'Create my login'),
        h('button', { class: 'vic-send vic-send--ghost', onclick: () => { mode = 'code'; error = ''; draw(); } }, 'Back'));
    }
    mount(root, header(), h('main', { class: 'vic-main vic-main--centred' }, body));
  };

  const run = async (fn: () => Promise<void>) => {
    busy = true; error = ''; draw();
    try { await fn(); } catch (e) { error = say(e); }
    busy = false; draw();
  };

  const doLogin = () => run(async () => {
    let t = ticket;
    if (!t || Date.now() - t.at > 4 * 60_000) t = await prepareLogin();
    ticket = null; ready = false;
    try {
      await loginWithPasskey(t);
    } catch (e: any) {
      warm();
      if (e?.name === 'NotAllowedError') throw new Error('Sign in was cancelled. Tap Sign in to try again.');
      throw e;
    }
    onDone();
  });
  const doCode = (code: string) => run(async () => { claim = await startClaim(code); mode = 'create'; });
  const doCreate = () => run(async () => { await finishClaim(claim!); onDone(); });

  warm();
  draw();
}
