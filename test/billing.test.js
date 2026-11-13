// Abonnement Stripe : création du paiement, vérification du webhook, activation / résiliation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startApp, testConfig, mockFetch } from './helpers.js';

const SECRET = 'whsec_test';
const DAY = 86400;
let app;
let stripeCalls;

before(async () => {
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * DAY;
  const fetchImpl = mockFetch([
    ['api.stripe.com/v1/checkout/sessions', { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }],
    // Version récente de l'API : la fin de période est sur les lignes de l'abonnement.
    ['api.stripe.com/v1/subscriptions/sub_1', { id: 'sub_1', status: 'active', customer: 'cus_1', items: { data: [{ current_period_end: periodEnd }] }, metadata: {} }],
  ]);
  stripeCalls = fetchImpl.calls;
  app = await startApp({
    fetchImpl,
    config: testConfig({
      stripe: { secretKey: 'sk_test_x', webhookSecret: SECRET, priceId: 'price_1' },
      premium: { stripeEnabled: true, allowDemo: false },
    }),
  });
});
after(() => app.close());

function sign(payload, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

async function webhook(event, signature) {
  const body = JSON.stringify(event);
  return fetch(`${app.base}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature ?? sign(body) },
    body,
  });
}

test('le mode démo est désactivé quand Stripe est configuré', async () => {
  const c = app.client();
  await c.register('zoe');
  assert.equal((await c.post('/api/subscription/demo')).status, 400);
  assert.equal((await c.get('/api/config')).data.premium.stripeEnabled, true);
});

test('création de la session de paiement Stripe', async () => {
  const c = app.client();
  const { data } = await c.register('yann');
  const r = await c.post('/api/subscription/checkout');
  assert.equal(r.status, 200);
  assert.match(r.data.url, /^https:\/\/checkout\.stripe\.com/);
  assert.ok(stripeCalls.some((u) => u.includes('/v1/checkout/sessions')));
  assert.ok(data.user.id);
});

test('webhook : signature invalide refusée', async () => {
  const res = await webhook({ type: 'customer.subscription.updated', data: { object: {} } }, sign('autre'));
  assert.equal(res.status, 400);
  const expired = await webhook({ type: 'x', data: { object: {} } }, sign('{}', SECRET, 1000));
  assert.equal(expired.status, 400);
});

test('webhook : paiement validé → Premium actif, résiliation → Premium terminé', async () => {
  const c = app.client();
  const { data } = await c.register('xavier');
  const userId = data.user.id;

  const ok = await webhook({
    type: 'checkout.session.completed',
    data: { object: { mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: String(userId) } },
  });
  assert.equal(ok.status, 200);
  let me = (await c.get('/api/me')).data.user;
  assert.equal(me.isPremium, true);
  assert.equal(me.premiumProvider, 'stripe');

  // Le membre peut maintenant commenter
  const titleId = app.db.get('SELECT id FROM titles LIMIT 1').id;
  assert.equal((await c.post('/api/comments', { titleId, body: 'Génial' })).status, 201);

  await webhook({
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: {}, ended_at: Math.floor(Date.now() / 1000) } },
  });
  me = (await c.get('/api/me')).data.user;
  assert.equal(me.isPremium, false);
  assert.equal(me.subscriptionStatus, 'canceled');
});
