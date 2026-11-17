// The main flows in a real browser against a local Supabase stack, using a
// virtual passkey device. Signs in as the coach and as two players.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';

const URL_ = process.env.E2E_SUPABASE_URL!;
const SERVICE = process.env.E2E_SERVICE_KEY!;
const ANON = process.env.E2E_ANON_KEY!;
const COACH_CODE = 'ABCDEFGHJK';
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

async function device(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  return page;
}

async function claim(page: Page, code: string) {
  await page.goto('/');
  await page.click('#havecode');
  await page.fill('#code', code);
  await page.click('#codego');
  await page.click('#create');
}

/** What this page's signed in user can read straight from the API. */
async function api(page: Page, path: string) {
  return page.evaluate(async ({ url, anon, path }) => {
    const raw = localStorage.getItem('victory-session');
    const token = JSON.parse(raw!).access_token;
    const res = await fetch(`${url}${path}`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body };
  }, { url: URL_, anon: ANON, path });
}

async function fillReview(page: Page, well: string, work: string, note: string, coach: string) {
  await page.click('[data-rate="4"]');
  await page.fill('#well', well);
  await page.fill('#work', work);
  await page.fill('#note', note);
  await page.fill('#coachbody', coach);
  await page.click('#send');
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

test('coach, two players, feedback, files and privacy', async ({ browser }) => {
  // The coach starts with a one-time code, as the deploy gives her.
  const { data: coachRow, error } = await admin.from('members').insert({ name: 'Coach', role: 'coach' }).select('id').single();
  expect(error).toBeNull();
  await admin.from('invites').insert({
    member_id: coachRow!.id, code_hash: createHash('sha256').update(COACH_CODE).digest('hex'),
  });

  const coach = await device(browser);
  let annCode = '', beaCode = '';

  await test.step('coach claims her code and creates her passkey', async () => {
    await claim(coach, 'abcde-fghjk');
    await expect(coach.locator('[data-tab="squad"]')).toBeVisible();
  });

  await test.step('coach adds two players and gets their codes', async () => {
    await coach.click('[data-tab="squad"]');
    for (const name of ['Ann', 'Bea']) {
      await coach.fill('#new-name', name);
      await coach.click('#add-player');
      await expect(coach.locator(`[data-member="${name}"]`)).toBeVisible();
      await coach.click(`[data-code="${name}"]`);
      const code = (await coach.locator('#code-value').textContent())!.trim();
      expect(code).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      if (name === 'Ann') annCode = code; else beaCode = code;
    }
  });

  const ann = await device(browser);
  const bea = await device(browser);

  await test.step('players claim codes and send their reviews', async () => {
    await claim(ann, annCode);
    await expect(ann.locator('[data-tab="review"]')).toBeVisible();
    await fillReview(ann, 'Ann went well text', 'Ann work on text', 'A kind word from Ann', 'Ann anonymous words');
    await expect(ann.getByText('Thanks, Ann')).toBeVisible();

    await claim(bea, beaCode);
    await fillReview(bea, 'Bea went well text', 'Bea work on text', 'A kind word from Bea', 'Bea anonymous words');
    await expect(bea.getByText('Thanks, Bea')).toBeVisible();
  });

  await test.step('a used code cannot be used twice', async () => {
    const other = await device(browser);
    await other.goto('/');
    await other.click('#havecode');
    await other.fill('#code', annCode);
    await other.click('#codego');
    await expect(other.locator('#msg')).toContainText('That code did not work');
  });

  await test.step('each player sees only her own review', async () => {
    await bea.click('#again');
    await expect(bea.getByText('Bea went well text')).toBeVisible();
    await expect(bea.getByText('Ann went well text')).toHaveCount(0);
    for (const [page, own, other] of [[ann, 'Ann went well', 'Bea went well'], [bea, 'Bea went well', 'Ann went well']] as const) {
      const r = await api(page, '/rest/v1/reflections?select=went_well');
      expect(r.body.map((x: any) => x.went_well)).toEqual([own + ' text']);
      expect(JSON.stringify(r.body)).not.toContain(other);
      expect((await api(page, '/rest/v1/teammate_praise?select=note')).body).toEqual([]);
      expect((await api(page, '/rest/v1/coach_notes?select=body')).body).toEqual([]);
      expect((await api(page, '/rest/v1/passkeys?select=*')).status).toBeGreaterThanOrEqual(400);
      expect((await api(page, '/rest/v1/invites?select=*')).status).toBeGreaterThanOrEqual(400);
      const me = await api(page, '/rest/v1/members?select=name');
      expect(me.body).toHaveLength(1);
    }
  });

  await test.step('coach sees both reviews, the kind words and the anonymous notes', async () => {
    await coach.click('[data-tab="reflections"]');
    await expect(coach.getByText('Ann went well text')).toBeVisible();
    await expect(coach.getByText('Bea went well text')).toBeVisible();
    await expect(coach.getByText('A kind word from Ann')).toBeVisible();
    await expect(coach.getByText('Ann anonymous words')).toBeVisible();
  });

  await test.step('coach writes feedback to Ann and to the team', async () => {
    await coach.click('[data-tab="feedback"]');
    await coach.selectOption('#fb-to', { label: 'Ann' });
    await coach.fill('#fb-body', 'Only for Ann: nice pressing');
    await coach.click('#fb-send');
    await expect(coach.locator('#msg')).toHaveText('Sent.');
    await coach.selectOption('#fb-to', { label: 'The whole team' });
    await coach.fill('#fb-body', 'For everyone: good week');
    await coach.click('#fb-send');
    await expect(coach.getByText('For everyone: good week').first()).toBeVisible();
  });

  await test.step('players get their own feedback and the team feedback only', async () => {
    await ann.reload();
    await ann.click('[data-tab="feedback"]');
    await expect(ann.getByText('Only for Ann: nice pressing')).toBeVisible();
    await expect(ann.getByText('For everyone: good week')).toBeVisible();
    await bea.reload();
    await bea.click('[data-tab="feedback"]');
    await expect(bea.getByText('For everyone: good week')).toBeVisible();
    await expect(bea.getByText('Only for Ann')).toHaveCount(0);
    const r = await api(bea, '/rest/v1/feedback?select=body');
    expect(r.body.map((x: any) => x.body)).toEqual(['For everyone: good week']);
  });

  await test.step('coach sees that Ann has read hers', async () => {
    await coach.reload();
    await coach.click('[data-tab="feedback"]');
    await expect(coach.getByText('Read', { exact: true }).first()).toBeVisible();
  });

  let path = '';
  await test.step('coach uploads a file and players can open it', async () => {
    await coach.click('[data-tab="files"]');
    await coach.fill('#up-title', 'Press slides');
    await coach.setInputFiles('#up-file', { name: 'press.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(coach.locator('#msg')).toHaveText('Uploaded and live.');
    await ann.reload();
    await ann.click('[data-tab="files"]');
    await expect(ann.getByText('Press slides')).toBeVisible();
    const rows = await api(ann, '/rest/v1/files?select=storage_path');
    path = rows.body[0].storage_path;
    const dl = await ann.evaluate(async ({ url, anon, path }) => {
      const token = JSON.parse(localStorage.getItem('victory-session')!).access_token;
      const r = await fetch(`${url}/storage/v1/object/authenticated/team-files/${path}`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
      return r.status;
    }, { url: URL_, anon: ANON, path });
    expect(dl).toBe(200);
  });

  await test.step('hiding a file takes it away from players, in the list and in storage', async () => {
    await coach.click('[data-pub]');
    await expect(coach.getByText('Hidden. Publish')).toBeVisible();
    await ann.reload();
    await ann.click('[data-tab="files"]');
    await expect(ann.getByText('Press slides')).toHaveCount(0);
    const dl = await ann.evaluate(async ({ url, anon, path }) => {
      const token = JSON.parse(localStorage.getItem('victory-session')!).access_token;
      const r = await fetch(`${url}/storage/v1/object/authenticated/team-files/${path}`, { headers: { apikey: anon, authorization: `Bearer ${token}` } });
      return r.status;
    }, { url: URL_, anon: ANON, path });
    expect(dl).toBeGreaterThanOrEqual(400);
  });

  await test.step('after signing out, the passkey signs her back in', async () => {
    await ann.click('#signout');
    await expect(ann.locator('#signin')).toBeVisible();
    await ann.click('#signin');
    await expect(ann.locator('[data-tab="review"]')).toBeVisible();
    await expect(ann.getByText('Ann · sign out')).toBeVisible();
  });

  await test.step('a switched off player is locked out at once', async () => {
    await coach.click('[data-tab="squad"]');
    coach.once('dialog', (d) => d.accept());
    await coach.locator('[data-member="Bea"]').getByText('Switch off').click();
    await expect(coach.getByText('Switched off')).toBeVisible();
    const r = await api(bea, '/rest/v1/reflections?select=went_well');
    expect(r.body).toEqual([]);
  });
});
