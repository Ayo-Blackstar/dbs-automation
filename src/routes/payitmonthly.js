const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');

function buildPaymentFields(data) {
  return [
    { name: '👤 Full Name', value: data.name || 'N/A', inline: true },
    { name: '💰 Amount', value: data.amount || 'N/A', inline: true },
    { name: '📧 Email', value: data.email || 'N/A', inline: true },
    { name: '📞 Phone', value: data.phone || 'N/A', inline: true },
    { name: '🛍️ Product', value: data.product || 'N/A', inline: true },
    { name: '📋 Reference', value: data.reference || 'N/A', inline: true },
    { name: '📊 Status', value: data.status || 'N/A', inline: true },
  ];
}

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const notification = payload.notification || {};
    const application = payload.application || {};

    const data = {
      name: application.customer_name || 'N/A',
      amount: application.amount ? `£${application.amount}` : 'N/A',
      email: application.email || 'N/A',
      phone: application.phone || 'N/A',
      product: application.product_name || 'N/A',
      reference: payload.reference || 'N/A',
      status: notification.new_status || notification.sub_type || 'N/A',
    };

    const fields = buildPaymentFields(data);
    const status = (notification.new_status || '').toUpperCase();

    if (status === 'ACCEPTED' || status === 'APPROVED' || status === 'COMPLETED') {
      const embed = createEmbed('✅ Pay it Monthly - Approved', fields, COLORS.GOLD);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_PAYMENTS, embed);
    } else if (status === 'DECLINED' || status === 'EXPIRED' || status === 'CANCELLED' || status === 'FAILED') {
      const embed = createEmbed('❌ Pay it Monthly - Failed/Declined', fields, COLORS.RED);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS, embed);
    } else {
      const embed = createEmbed(`💼 Pay it Monthly - ${status}`, fields, COLORS.BLUE);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_PAYMENTS, embed);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Pay it Monthly error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
