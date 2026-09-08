const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');
const axios = require('axios');

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

const OUR_TAGS = ['typeform-lead', 'typeform-booked', 'gold-lead', 'green-lead', 'blue-lead'];

function filterTags(tags) {
  if (!tags) return '';
  return tags.split(',').map(t => t.trim()).filter(t => OUR_TAGS.includes(t)).join(', ');
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
    { name: 'Tags', value: filterTags(body.tags), inline: true },
    { name: 'Country', value: body.country || '', inline: true },
    { name: 'Timezone', value: body.timezone || '', inline: true },
    { name: 'Date_created', value: body.date_created || '', inline: true },
    { name: 'Contact_source', value: body.contact_source || '', inline: true },
  ];

  if (body.booked_by) fields.push({ name: '📋 Booked By (Setter)', value: body.booked_by, inline: true });
  if (body.assigned_to) fields.push({ name: '📞 Assigned To (Closer)', value: body.assigned_to, inline: true });
  if (body.rescheduled_by) fields.push({ name: '🔁 Rescheduled By', value: body.rescheduled_by, inline: true });
  if (body.closed_by) fields.push({ name: '🏆 Closed By', value: body.closed_by, inline: true });

  return fields;
}

function buildStageFields(body, stage) {
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
    { name: 'Tags', value: filterTags(body.tags), inline: true },
    { name: 'Country', value: body.country || '', inline: true },
    { name: 'Timezone', value: body.timezone || '', inline: true },
    { name: 'Date_created', value: body.date_created || '', inline: true },
    { name: 'Contact_source', value: body.contact_source || '', inline: true },
    { name: 'Owner', value: body.assigned_user || '', inline: true },
  ];

  if (body.booked_by) fields.push({ name: '📋 Booked By (Setter)', value: body.booked_by, inline: true });
  if (body.assigned_to) fields.push({ name: '📞 Assigned To (Closer)', value: body.assigned_to, inline: true });
  if (body.rescheduled_by) fields.push({ name: '🔁 Rescheduled By', value: body.rescheduled_by, inline: true });
  if (body.closed_by) fields.push({ name: '🏆 Closed By', value: body.closed_by, inline: true });

  return fields;
}

router.post('/booked-call', async (req, res) => {
  try {
    console.log('BOOKED-CALL PAYLOAD:', JSON.stringify(req.body));
    const contactId = req.body.contact_id || req.body.contactId || '';
    const dedupKey = `booked-${contactId}-${req.body.email || ''}`;
    if (isDuplicate(dedupKey)) return res.json({ success: true, skipped: 'duplicate' });
    const embed = createEmbed('🟣 New Call Booked - SETTER BOOKED', buildCallFields(req.body, 'Call Booked'), COLORS.PURPLE);
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
    const embed = createEmbed('✅ Pipeline: Confirmed Call', buildStageFields(req.body, 'Confirmed'), COLORS.GREEN);
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
    const embed = createEmbed('❌ Pipeline: No Show', buildStageFields(req.body, 'No Show'), COLORS.RED);
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
    const embed = createEmbed('🔄 Pipeline: Follow Up', buildStageFields(req.body, 'Follow Up'), COLORS.YELLOW);
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
    const embed = createEmbed('🚫 Pipeline: Booking Cancelled', buildStageFields(req.body, 'Booking Cancelled'), COLORS.ORANGE);
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
    const embed = createEmbed('🔁 Pipeline: Rescheduled', buildStageFields(req.body, 'Rescheduled'), COLORS.BLUE);
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
      { name: 'Tags', value: filterTags(req.body.tags), inline: true },
      { name: 'Country', value: req.body.country || '', inline: true },
      { name: 'Timezone', value: req.body.timezone || '', inline: true },
      { name: 'Opportunity_value', value: req.body.opportunity_value || '', inline: true },
      { name: 'Owner', value: req.body.assigned_user || '', inline: true },
      { name: 'Notes', value: req.body.opportunity_notes || '', inline: false },
    ];

    if (req.body.closed_by) fields.push({ name: '🏆 Closed By', value: req.body.closed_by, inline: true });
    if (req.body.assigned_to) fields.push({ name: '📞 Assigned To', value: req.body.assigned_to, inline: true });

    const embed = createEmbed('🏆 Pipeline: Closed Won', fields, COLORS.GOLD);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_CLOSED_DEAL, embed);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/update-notes', async (req, res) => {
  try {
    console.log('Update notes payload:', JSON.stringify(req.body));
    const { contact_id, email, notes } = req.body;

    if (!notes) return res.json({ success: false, error: 'No notes provided' });

    let contactId = contact_id;

    if (!contactId && email) {
      try {
        const searchResponse = await axios.get(
          `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`,
          {
            headers: {
              'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
              'Version': '2021-07-28'
            }
          }
        );
        const contacts = searchResponse.data?.contacts || [];
        if (contacts.length > 0) contactId = contacts[0].id;
      } catch (err) {
        console.error('Contact search error:', err.message);
      }
    }

    if (!contactId) return res.json({ success: false, error: 'Contact not found' });

    const noteBody = `📋 Business Worksheet Notes:\n\n${notes}`;
    const headers = {
      'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    };

    try {
      await axios.post(
        `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
        { body: noteBody },
        { headers }
      );
      console.log('Contact note added for:', contactId);
    } catch (err) {
      console.error('Contact note error:', err.response?.data || err.message);
    }

    try {
      const oppResponse = await axios.get(
        `https://services.leadconnectorhq.com/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&contact_id=${contactId}`,
        { headers }
      );
      const opportunities = oppResponse.data?.opportunities || [];
      const pipelineId = process.env.GHL_PIPELINE_ID;
      const opportunity = pipelineId
        ? opportunities.find(o => o.pipelineId === pipelineId)
        : opportunities[0];

      if (opportunity) {
        await axios.post(
          `https://services.leadconnectorhq.com/opportunities/${opportunity.id}/notes`,
          { body: noteBody },
          { headers }
        );
        console.log('Opportunity note added for:', opportunity.id);
      }
    } catch (err) {
      console.error('Opportunity note error:', err.response?.data || err.message);
    }

    res.json({ success: true, contactId });

  } catch (err) {
    console.error('Update notes error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
