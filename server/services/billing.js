// Abonnement Premium (sans pub + commentaires) : Stripe Checkout, ou mode démo sans paiement.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, now, DAY } from '../util.js';

const STRIPE = 'https://api.stripe.com/v1';
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export function createBilling({ db, config, fetchImpl = globalThis.fetch, log = console }) {
  const { stripe, premium } = config;

  async function stripeApi(method, path, body) {
    const res = await fetchImpl(`${STRIPE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${stripe.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body ? form(body).toString() : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new HttpError(502, `Stripe : ${data?.error?.message || res.status}`);
    return data;
  }

  async function createCheckout(user) {
    if (!premium.stripeEnabled) throw new HttpError(400, 'Le paiement en ligne n’est pas configuré.');
    const session = await stripeApi('POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: { 0: { price: stripe.priceId, quantity: 1 } },
      success_url: `${config.publicUrl}/premium?statut=succes`,
      cancel_url: `${config.publicUrl}/premium?statut=annule`,
      client_reference_id: String(user.id),
      customer: user.stripe_customer_id || undefined,
      customer_email: user.stripe_customer_id ? undefined : user.email,
      allow_promotion_codes: 'true',
      metadata: { user_id: String(user.id) },
      subscription_data: { metadata: { user_id: String(user.id) } },
    });
    return session.url;
  }

  async function createPortal(user) {
    if (!premium.stripeEnabled || !user.stripe_customer_id) {
      throw new HttpError(400, 'Aucun abonnement Stripe associé à ce compte.');
    }
    const session = await stripeApi('POST', '/billing_portal/sessions', {
      customer: user.stripe_customer_id,
      return_url: `${config.publicUrl}/profil`,
    });
    return session.url;
  }

  /** Vérifie l'en-tête Stripe-Signature (HMAC SHA-256, tolérance 5 min). */
  function verifySignature(rawBody, header, toleranceSec = 300) {
    if (!stripe.webhookSecret) throw new HttpError(400, 'STRIPE_WEBHOOK_SECRET manquant.');
    const parts = Object.fromEntries(
      String(header || '')
        .split(',')
        .map((kv) => kv.split('=').map((s) => s.trim()))
        .filter((kv) => kv.length === 2 && kv[0] !== 'v1'),
    );
    const signatures = String(header || '')
      .split(',')
      .map((kv) => kv.trim())
      .filter((kv) => kv.startsWith('v1='))
      .map((kv) => kv.slice(3));
    const t = Number(parts.t);
    if (!t || !signatures.length) throw new HttpError(400, 'Signature Stripe invalide.');
    if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new HttpError(400, 'Signature Stripe expirée.');
    const expected = createHmac('sha256', stripe.webhookSecret).update(`${t}.${rawBody}`).digest('hex');
    const ok = signatures.some((sig) => {
      const a = Buffer.from(sig, 'hex');
      const b = Buffer.from(expected, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!ok) throw new HttpError(400, 'Signature Stripe invalide.');
    return JSON.parse(rawBody);
  }

  function periodEnd(sub) {
    // Selon la version de l'API Stripe, la fin de période est sur l'abonnement ou sur ses lignes.
    const end = sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
    return end ? end * 1000 : null;
  }

  function applySubscription(sub, userIdHint) {
    const userId =
      Number(sub.metadata?.user_id) ||
      Number(userIdHint) ||
      db.get('SELECT id FROM users WHERE stripe_subscription_id = ? OR stripe_customer_id = ?', sub.id, sub.customer)?.id;
    if (!userId) {
      log.warn?.(`[stripe] abonnement ${sub.id} sans utilisateur associé`);
      return;
    }
    const end = periodEnd(sub);
    const premiumUntil = ACTIVE.has(sub.status)
      ? (end || now() + 31 * DAY) + DAY // 1 jour de grâce pour le renouvellement
      : Math.min(now(), end || now());
    db.run(
      `UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = ?,
         subscription_status = ?, premium_until = ?, premium_provider = 'stripe' WHERE id = ?`,
      typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
      sub.id,
      sub.status,
      premiumUntil,
      userId,
    );
  }

  async function handleEvent(event) {
    const obj = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription' || !obj.subscription) break;
        const userId = Number(obj.client_reference_id || obj.metadata?.user_id);
        if (userId && obj.customer) {
          db.run('UPDATE users SET stripe_customer_id = ? WHERE id = ?', obj.customer, userId);
        }
        const sub = await stripeApi('GET', `/subscriptions/${obj.subscription}`);
        applySubscription(sub, userId);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        applySubscription(obj);
        break;
      case 'invoice.paid': {
        const subId = obj.subscription || obj.parent?.subscription_details?.subscription;
        if (subId) applySubscription(await stripeApi('GET', `/subscriptions/${subId}`));
        break;
      }
      default:
        break;
    }
  }

  function activateDemo(userId) {
    if (!premium.allowDemo) throw new HttpError(400, 'Le mode démo est désactivé.');
    const until = now() + premium.demoDays * DAY;
    db.run(
      `UPDATE users SET premium_until = ?, premium_provider = 'demo', subscription_status = 'active' WHERE id = ?`,
      until,
      userId,
    );
    return until;
  }

  function cancelDemo(userId) {
    db.run(
      `UPDATE users SET premium_until = NULL, subscription_status = 'canceled' WHERE id = ? AND premium_provider = 'demo'`,
      userId,
    );
  }

  return { createCheckout, createPortal, verifySignature, handleEvent, activateDemo, cancelDemo, applySubscription };
}
