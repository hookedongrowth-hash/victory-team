import './style.css';
import { currentSession, loadMe, sb, signOut, configured } from './api';
import { showSignIn } from './views/signin';
import { showPlayer } from './views/player';
import { showCoach } from './views/coach';

const root = document.getElementById('app') as HTMLElement;

async function start(note = '') {
  if (!configured) { showSignIn(root, start); return; }
  const session = await currentSession();
  if (!session) { showSignIn(root, start, note); return; }
  const me = await loadMe();
  if (!me) {
    await signOut();
    showSignIn(root, start, 'Your access is switched off. Ask the coach.');
    return;
  }
  const out = async () => { await signOut(); location.reload(); };
  if (me.role === 'coach') showCoach(root, me, out); else showPlayer(root, me, out);
}

// A switched off or signed out session returns to the sign in screen.
sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') start(); });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

start();
