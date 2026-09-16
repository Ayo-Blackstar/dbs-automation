const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');

function buildPaymentFields(data) {
  return [
    { name: '📋 Reference', value: data.reference || 'N/A', inline: true },
    { name: '📊 Status', value: data.status || 'N/A', inline: true },
    { name: '📑 Sub Type', value: data.subType || 'N/A', inline: true },
    { name: '👤 Full Name', value: data.name || 'N/A', inline: true },
    { name: '💰 Amount', value: data.amount || 'N/A', inline: true },
    { name: '📧 Email', value: data.email || 'N/A', inline: true },
    { name: '📞 Phone', value: data.phone || 'N/A', inline: true },
    { name: '🛍️ Product', value: data.product || 'N/A', inline: true },
    { name: '🔗 Application ID', value: data.applicationUuid || 'N/A', inline: true },
  ];
}

router.post('/webhook', async (req, res) => {
  try {
    console.log('Pay it Monthly payload:', JSON.stringify(req.body));
    const payload = req.body;

    const notification = payload.notification || payload.data?.notification || {};
    const application = payload.application || payload.data?.application || payload.data || {};

    const newStatus = (notification.new_status || '').toUpperCase();
    const subType = (notification.sub_type || '').toUpperCase();
    const notificationType = (payload.notification_type || '').toUpperCase();
    const payloadType = (payload.type || payload.event || '').toUpperCase();

    // Use new_status as primary, fall back to sub_type or type
    const status = newStatus || subType || payloadType || notificationType;

    const firstName = application.first_name || application.customer_first_name || '';
    const lastName = application.last_name || application.customer_last_name || '';
    const fullName = application.customer_name ||
      application.name ||
      payload.customer_name ||
      (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName) ||
      'N/A';

    const data = {
      name: fullName,
      amount: application.amount ? `£${application.amount}` :
              application.financed_amount ? `£${application.financed_amount}` : 'N/A',
      email: application.email || application.customer_email || 'N/A',
      phone: application.phone || application.customer_phone || 'N/A',
      product: application.product_name || application.description || 'DBS Finance',
      reference: payload.reference || 'N/A',
      status: status || 'N/A',
      subType: notification.sub_type || 'N/A',
      applicationUuid: payload.application_uuid || 'N/A',
    };

    const fields = buildPaymentFields(data);

    if (
      status === 'ACCEPTED' ||
      status === 'APPROVED' ||
      status === 'COMPLETED' ||
      status === 'SIGNED' ||
      status === 'ACTIVE'
    ) {
      const embed = createEmbed('✅ Pay it Monthly - New Payment', fields, COLORS.GOLD);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_PAYMENTS, embed);
      console.log('Sent to new payments:', status);

    } else if (
      status === 'DECLINED' ||
      status === 'EXPIRED' ||
      status === 'CANCELLED' ||
      status === 'FAILED' ||
      status === 'REFERRED'
    ) {
      const embed = createEmbed('❌ Pay it Monthly - Failed/Declined', fields, COLORS.RED);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS, embed);
      console.log('Sent to failed payments:', status);

    } else {
      // Send ALL other statuses to failed payments channel so nothing is missed
      console.log('Unhandled Pay it Monthly status:', status, '— sending to failed payments');
      const embed = createEmbed(`💼 Pay it Monthly - ${status || 'UPDATE'}`, fields, COLORS.BLUE);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS, embed);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Pay it Monthly error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
