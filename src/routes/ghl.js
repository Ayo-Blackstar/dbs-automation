const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');

const recentNotifications = new Map();
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

function isDuplicate(key) {
  const now = Date.now();
  if (recentNotifications.has(key)) {
    const timestamp = recentNotifications.get(key);
    if (now - timestamp < DEDUP_WINDOW_MS) {
      console.log(`Duplicate blocked: ${key}`);
      return true;
    }
  }
  recentNotifications.set(key, now);
  for (const [k, t] of recentNotifications.entries()) {
    if (now - t > DEDUP_WINDOW_MS) recentNotifications.delete(k);
  }
  return false;
}

function getContactGHLLink(contactId) {
  const locationId = process.env.GHL_LOCATION_ID;
  return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`;
}

function determineLeadColor(body) {
  const tags = (body.tags || '').toLowerCase();
  const leadValue = parseFloat(body.opportunity_value || body.monetary_value || body.lead_value || '0');

  if (tags.includes('gold-lead') || leadValue >= 2997) {
    return { color: COLORS.GOLD, prefix: '🥇', price: '£2,997' };
  } else if (tags.includes('green-lead')) {
    return { color: COLORS.GREEN, prefix: '🟢', price: '£1,997' };
  }
  return { color: COLORS.BLUE, prefix: '📞', price: '£1,997' };
}

function buildLeadFields(body) {
  const contactId = body.contact_id || body.contactId || '';
  const fullName = body.full_name ||
    `${body.first_name || ''} ${body.last_name || ''}`.trim() ||
    body.contact_name || 'Unknown';
  const ghlLink = getContactGHLLink(contactId);

  const fields = [
    { name: 'Time', value: new Date().toLocaleDateString('en-GB'), inline: true },
    { name: 'Name', value: `[${fullName}](${ghlLink})`, inline: true },
    { name: 'Email', value: body.email || '', inline: true },
    { name: 'Phone', value: body.phone || '', inline: true },
    { name: 'Tags', value: body.tags || '', inline: true },
    { name: 'Country', value: body.country || '', inline: true },
    { name: 'Source', value: body.contact_source || body.source || '', inline: true },
    { name: 'Date_created', value: body.date_created || '', inline: true },
  ];

  if (body.work_circumstances) {
    fields.push({ name: 'Work Circumstances', value: body.work_circumstances, inline: true });
  }
  if (body.reason_for_change) {
    fields.push({ name: 'Reason for Change', value: body.reason_for_change, inline: true });
  }
  if (body.uk_residency) {
    fields.push({ name: 'UK Residency', value: body.uk_residency, inline: true });
  }
  if (body.investment) {
    fields.push({ name: 'Investment', value: body.investment, inline: true });
  }
  if (body.credit_score) {
    fields.push({ name: 'Credit Score', value: body.credit_score, inline: true });
  }
  if (body.start_timeline) {
    fields.push({ name: 'Start Timeline', value: body.start_timeline, inline: true });
  }
  if (body.opportunity_value) {
    fields.push({ name: 'Opportunity Value', value: `£${body.opportunity_value}`, inline: true });
  }

  return fields;
}

function buildCallFields(body, stage) {
  const contactId = body.contact_id || body.contactId || '';
  const fullName = body.full_name ||
    `${body.first_name || ''} ${body.last_name || ''}`.trim() ||
    body.contact_name || 'Unknown';
  const ghlLink = getContactGHLLink(contactId);

  const fields = [
    { name: 'Stage', value: stage, inline: true },
    { name: 'Name', value: `[${fullName}](${ghlLink})`, inline: true },
    { name: 'Email', value: body.email || '', inline: true },
    { name: 'Phone', value: body.phone || '', inline: true },
    { name: 'Full_name', value: fullName, inline: true },
    { name: 'Tags', value: body.tags || '', inline: true },
    { name: 'Country', value: body.country || '', inline: true },
    { name: 'Timezone', value: body.timezone || '', inline: true },
    { name: 'Date_created', value: body.date_created || '', inline: true },
    { name: 'Contact_source', value: body.contact_source || '', inline: true },
    { name: 'Opportunity_name', value: body.opportunity_name || fullName, inline: true },
    { name: 'Opportunity_value', value: body.opportunity_value || '', inline: true },
    { name: 'Pipeline_name', value: body.pipeline_name || '', inline: true },
    { name: 'Owner', value: body.assigned_user || '', inline: true },
  ];

  if (body.work_circumstances) {
    fields.push({ name: 'Work Circumstances', value: body.work_circumstances, inline: true });
  }
  if (body.reason_for_change) {
    fields.push({ name: 'Reason for Change', value: body.reason_for_change, inline: true });
  }

  return fields;
}

router.post('/new-lead', async (req, res) => {
  try {
    const contactId = req.body.contact_id || req.body.contactId || '';
    const email = req.body.email || '';
    const dedupKey = `newlead-${contactId}-${email}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });

    const { color, prefix, price } = determineLeadColor(req.body);
    const fields = buildLeadFields(req.body);
    const embed = createEmbed(`${prefix} New Lead - ${price}`, fields, color);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_LEADS, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/booked-call', async (req, res) => {
  try {
    const contactId = req.body.contact_id || req.body.contactId || '';
    const dedupKey = `booked-${contactId}-${req.body.email || ''}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });
    const { color, prefix, price } = determineLeadColor(req.body);
    const embed = createEmbed(`${prefix} New Call Booked - ${price}`, buildCallFields(req.body, 'Call Booked'), color);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_BOOKED_CALLS, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/confirmed-call', async (req, res) => {
  try {
    const contactId = req.body.contact_id || req.body.contactId || '';
    const dedupKey = `confirmed-${contactId}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });
    const { color } = determineLeadColor(req.body);
    const embed = createEmbed('✅ Pipeline: Confirmed Call', buildCallFields(req.body, 'Confirmed'), color);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_CONFIRMED_CALLS, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/no-show', async (req, res) => {
  try {
    const contactId = req.body.contact_id || req.body.contactId || '';
    const dedupKey = `noshow-${contactId}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });
    const embed = createEmbed('❌ Pipeline: No Show', buildCallFields(req.body, 'No Show'), COLORS.RED);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NO_SHOW, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/follow-up', async (req, res) => {
  try {
    const contactId = req.body.contact_id || req.body.contactId || '';
    const dedupKey = `followup-${contactId}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });
    const embed = createEmbed('🔄 Pipeline: Follow Up', buildCallFields(req.body, 'Follow Up'), COLORS.YELLOW);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_FOLLOW_UP, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cancelled', async (req, res) => {
  try {
    const contactId = req.body.contact_id || req.body.contactId || '';
    const dedupKey = `cancelled-${contactId}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });
    const embed = createEmbed('🚫 Pipeline: Booking Cancelled', buildCallFields(req.body, 'Booking Cancelled'), COLORS.ORANGE);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_CANCELLED, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rescheduled', async (req, res) => {
  try {
    const contactId = req.body.contact_id || req.body.contactId || '';
    const dedupKey = `rescheduled-${contactId}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });
    const embed = createEmbed('🔁 Pipeline: Rescheduled', buildCallFields(req.body, 'Rescheduled'), COLORS.BLUE);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_RESCHEDULED, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/closed-deal', async (req, res) => {
  try {
    const contactId = req.body.contact_id || req.body.contactId || '';
    const dedupKey = `closed-${contactId}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });
    const fullName = req.body.full_name ||
      `${req.body.first_name || ''} ${req.body.last_name || ''}`.trim() ||
      req.body.contact_name || 'Unknown';
    const ghlLink = getContactGHLLink(contactId);

    const fields = [
      { name: 'Stage', value: 'Closed Won', inline: true },
      { name: 'Name', value: `[${fullName}](${ghlLink})`, inline: true },
      { name: 'Email', value: req.body.email || '', inline: true },
      { name: 'Phone', value: req.body.phone || '', inline: true },
      { name: 'Full_name', value: fullName, inline: true },
      { name: 'Tags', value: req.body.tags || '', inline: true },
      { name: 'Country', value: req.body.country || '', inline: true },
      { name: 'Timezone', value: req.body.timezone || '', inline: true },
      { name: 'Opportunity_name', value: req.body.opportunity_name || fullName, inline: true },
      { name: 'Opportunity_value', value: req.body.opportunity_value || '', inline: true },
      { name: 'Pipeline_name', value: req.body.pipeline_name || '', inline: true },
      { name: 'Owner', value: req.body.assigned_user || '', inline: true },
      { name: 'Notes', value: req.body.opportunity_notes || '', inline: false },
    ];

    const embed = createEmbed('🏆 Pipeline: Closed Won', fields, COLORS.GOLD);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_CLOSED_DEAL, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
