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
    console.log('Pay it Monthly payload:', JSON.stringify(req.body));
    const payload = req.body;

    // Handle different payload structures
    const notification = payload.notification || payload.data?.notification || {};
    const application = payload.application || payload.data?.application || payload.data || {};
    const reference = payload.reference || payload.data?.reference || 'N/A';

    const status = (
      notification.new_status ||
      notification.sub_type ||
      payload.type ||
      payload.event ||
      ''
    ).toUpperCase();

    const data = {
      name: application.customer_name || application.name || payload.customer_name || 'N/A',
      amount: application.amount ? `£${application.amount}` :
              application.financed_amount ? `£${application.financed_amount}` : 'N/A',
      email: application.email || application.customer_email || 'N/A',
      phone: application.phone || application.customer_phone || 'N/A',
      product: application.product_name || application.description || 'DBS Finance',
      reference,
      status: status || 'N/A',
    };

    const fields = buildPaymentFields(data);

    if (status === 'ACCEPTED' || status === 'APPROVED' || status === 'COMPLETED' || status === 'SIGNED') {
      const embed = createEmbed('✅ Pay it Monthly - Approved', fields, COLORS.GOLD);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_PAYMENTS, embed);
    } else if (
      status === 'DECLINED' || status === 'EXPIRED' || 
      status === 'CANCELLED' || status === 'FAILED' ||
      status === 'REFERRED'
    ) {
      const embed = createEmbed('❌ Pay it Monthly - Failed/Declined', fields, COLORS.RED);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS, embed);
    } else {
      // Log unknown statuses so we can handle them
      console.log('Unknown Pay it Monthly status:', status, 'Full payload:', JSON.stringify(payload));
      const embed = createEmbed(`💼 Pay it Monthly - ${status || 'Update'}`, fields, COLORS.BLUE);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_PAYMENTS, embed);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Pay it Monthly error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
