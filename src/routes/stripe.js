const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');

function buildPaymentFields(data) {
  return [
    { name: '👤 Full Name', value: data.name || 'N/A', inline: true },
    { name: '💰 Amount', value: data.amount || 'N/A', inline: true },
    { name: '📧 Email', value: data.email || 'N/A', inline: true },
    { name: '📞 Phone', value: data.phone || 'N/A', inline: true },
    { name: '🛍️ Product', value: data.product || 'N/A', inline: true },
    { name: '📊 Event', value: data.eventType || 'N/A', inline: true },
  ];
}

function extractProductName(obj) {
  if (obj.metadata?.product_name) return obj.metadata.product_name;
  if (obj.metadata?.description) return obj.metadata.description;
  if (obj.description) {
    const desc = obj.description;
    if (desc.toLowerCase().includes('invoiceid') || desc.toLowerCase().includes('paymentscheduleid')) {
      return 'DBS Payment';
    }
    return desc;
  }
  return 'DBS Payment';
}

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log('Stripe event type:', event.type);
    const obj = event.data.object;

    const amount = obj.amount_received
      ? `£${(obj.amount_received / 100).toFixed(2)}`
      : obj.amount
      ? `£${(obj.amount / 100).toFixed(2)}`
      : obj.amount_due
      ? `£${(obj.amount_due / 100).toFixed(2)}`
      : 'N/A';

    const data = {
      name: obj.billing_details?.name || obj.customer_details?.name || obj.shipping?.name || 'N/A',
      amount,
      email: obj.billing_details?.email || obj.customer_details?.email || obj.receipt_email || 'N/A',
      phone: obj.billing_details?.phone || obj.customer_details?.phone || 'N/A',
      product: extractProductName(obj),
      eventType: event.type,
    };

    const fields = buildPaymentFields(data);

    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'charge.succeeded'
    ) {
      const embed = createEmbed('💳 New Stripe Payment - DBS', fields, COLORS.GOLD);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_PAYMENTS, embed);

    } else if (
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'charge.failed' ||
      event.type === 'invoice.payment_failed'
    ) {
      const embed = createEmbed('❌ Failed Stripe Payment - DBS', fields, COLORS.RED);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS, embed);

    } else if (event.type === 'charge.dispute.created') {
      const embed = createEmbed('⚠️ Stripe Dispute - DBS', fields, COLORS.ORANGE);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS, embed);

    } else {
      console.log('Unhandled Stripe event:', event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
