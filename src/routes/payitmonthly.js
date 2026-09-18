const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');

function buildPaymentFields(data) {
  return [
    { name: '📋 Reference', value: data.reference || 'N/A', inline: true },
    { name: '📊 Status', value: data.status || 'N/A', inline: true },
    { name: '📑 Notification Type', value: data.notificationType || 'N/A', inline: true },
    { name: '👤 Full Name', value: data.name || 'N/A', inline: true },
    { name: '💰 Amount', value: data.amount || 'N/A', inline: true },
    { name: '📧 Email', value: data.email || 'N/A', inline: true },
    { name: '📞 Phone', value: data.phone || 'N/A', inline: true },
    { name: '🛍️ Product', value: data.product || 'N/A', inline: true },
    { name: '🔗 Agreement Ref', value: data.agreementRef || 'N/A', inline: true },
    { name: '🔗 Application ID', value: data.applicationUuid || 'N/A', inline: true },
  ];
}

router.post('/webhook', async (req, res) => {
  try {
    console.log('Pay it Monthly payload:', JSON.stringify(req.body));
    const payload = req.body;

    const notificationType = (payload.notification_type || '').toLowerCase();
    const notification = payload.notification || {};
    const decision = payload.decision || {};
    const application = payload.application || payload.data?.application || {};

    // Extract status based on notification type
    let status = '';
    if (notificationType === 'decision') {
      // decision events use decision.outcome
      status = (decision.outcome || payload.application_status || '').toUpperCase();
    } else {
      // finance_application_status events use notification.new_status
      status = (
        notification.new_status ||
        notification.sub_type ||
        payload.type ||
        payload.event ||
        ''
      ).toUpperCase();
    }

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
      notificationType: payload.notification_type || 'N/A',
      agreementRef: decision.agreement_reference || 'N/A',
      applicationUuid: payload.application_uuid || 'N/A',
    };

    const fields = buildPaymentFields(data);

    if (
      status === 'ACCEPTED' ||
      status === 'APPROVED' ||
      status === 'COMPLETED' ||
      status === 'SIGNED' ||
      status === 'ACTIVE' ||
      status === 'SUCCESS' ||
      status === 'PROCESSED'
    ) {
      const embed = createEmbed('✅ Pay it Monthly - Payment Approved', fields, COLORS.GOLD);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_PAYMENTS, embed);
      console.log('Sent to new payments:', status);

    } else if (
      status === 'DECLINED' ||
      status === 'EXPIRED' ||
      status === 'CANCELLED' ||
      status === 'FAILED' ||
      status === 'REFERRED' ||
      status === 'FAILURE'
    ) {
      const embed = createEmbed('❌ Pay it Monthly - Failed/Declined', fields, COLORS.RED);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_FAILED_PAYMENTS, embed);
      console.log('Sent to failed payments:', status);

    } else {
      // Send all other statuses to failed payments so nothing is missed
      console.log('Unhandled Pay it Monthly status:', status);
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
