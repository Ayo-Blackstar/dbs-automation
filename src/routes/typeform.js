const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');
const axios = require('axios');

async function createGHLContact(contactData) {
  try {
    const response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      contactData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
        }
      }
    );
    console.log('GHL contact created:', response.data?.contact?.id);
    return response.data?.contact;
  } catch (err) {
    console.error('GHL contact error:', err.response?.status, JSON.stringify(err.response?.data));
    return null;
  }
}

function isCalendlyBookingUrl(value) {
  return value && value.includes('calendly.com') && value.includes('invitees');
}

function checkGoldLeadByValue(value) {
  const valueLower = value.toLowerCase();
  // Income above £35k
  if (
    valueLower.includes('earning above £35k') ||
    valueLower.includes('above £35k') ||
    valueLower.includes('35k') ||
    valueLower.includes('40k') ||
    valueLower.includes('45k') ||
    valueLower.includes('50k') ||
    valueLower.includes('60k') ||
    valueLower.includes('over £35') ||
    (valueLower.includes('above') && valueLower.includes('35'))
  ) {
    return true;
  }
  return false;
}

function checkGoldLeadByCreditScore(value) {
  const valueLower = value.toLowerCase();
  if (
    valueLower.includes('800') ||
    valueLower.includes('701') ||
    valueLower.includes('700') ||
    valueLower.includes('601') ||
    valueLower.includes('600 - 700') ||
    valueLower.includes('600+') ||
    (valueLower.includes('600') && !valueLower.includes('below 600') && !valueLower.includes('under 600'))
  ) {
    return true;
  }
  return false;
}

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const answers = payload.form_response?.answers || [];
    const fields_def = payload.form_response?.definition?.fields || [];
    const hidden = payload.form_response?.hidden || {};

    const discordFields = [];
    let isGoldLead = false;
    let hasCalendly = false;
    let firstName = '';
    let lastName = '';
    let phone = '';
    let email = '';
    let source = '';
    let calendlyCount = 0;

    const now = new Date().toLocaleDateString('en-GB');
    discordFields.push({ name: 'Time', value: now, inline: true });

    answers.forEach((answer, index) => {
      const fieldDef = fields_def[index];
      const fieldTitle = fieldDef?.title || `Question ${index + 1}`;
      let value = '';

      switch (answer.type) {
        case 'text':
          value = answer.text || '';
          break;
        case 'email':
          value = answer.email || '';
          email = value;
          break;
        case 'phone_number':
          value = answer.phone_number || '';
          phone = value;
          break;
        case 'choice':
          value = answer.choice?.label || '';
          break;
        case 'choices':
          value = answer.choices?.labels?.join(', ') || '';
          break;
        case 'boolean':
          value = answer.boolean ? 'Yes' : 'No';
          break;
        case 'number':
          value = String(answer.number) || '';
          break;
        case 'calendly':
          hasCalendly = true;
          calendlyCount++;
          value = answer.url || 'Call Booked ✅';
          break;
        case 'url':
          value = answer.url || '';
          if (isCalendlyBookingUrl(value)) {
            hasCalendly = true;
            calendlyCount++;
          }
          break;
        default:
          value = answer.url || answer.text || answer.email || '';
          if (isCalendlyBookingUrl(value)) {
            hasCalendly = true;
            calendlyCount++;
          }
      }

      const titleLower = fieldTitle.toLowerCase();
      if (titleLower.includes('first name')) firstName = value;
      if (titleLower.includes('last name')) lastName = value;
      if (titleLower.includes('how did you hear')) source = value;

      // Check gold lead by field type
      if (
        titleLower.includes('earning') ||
        titleLower.includes('income') ||
        titleLower.includes('salary') ||
        titleLower.includes('work circumstances') ||
        titleLower.includes('circumstances') ||
        titleLower.includes('situation')
      ) {
        if (checkGoldLeadByValue(value)) isGoldLead = true;
      }

      // Also check ANY choice answer for income keywords
      if (answer.type === 'choice' && checkGoldLeadByValue(value)) {
        isGoldLead = true;
      }

      // Credit score check
      if (
        titleLower.includes('credit score') ||
        titleLower.includes('experian') ||
        titleLower.includes('credit')
      ) {
        if (checkGoldLeadByCreditScore(value)) isGoldLead = true;
      }

      // Skip calendar booking URLs — only show first one
      if (isCalendlyBookingUrl(value)) {
        if (calendlyCount === 1) {
          discordFields.push({
            name: 'Call Booking',
            value: String(value).substring(0, 1024),
            inline: true
          });
        }
        return;
      }

      if (value) {
        discordFields.push({
          name: fieldTitle.substring(0, 256),
          value: String(value).substring(0, 1024),
          inline: true
        });
      }
    });

    // Add UTM data if present
    if (hidden && Object.keys(hidden).length > 0) {
      const utmLines = Object.entries(hidden)
        .filter(([k, v]) => v)
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n');
      if (utmLines) {
        discordFields.push({ name: 'ATTRIBUTION', value: utmLines, inline: false });
      }
    }

    if (hasCalendly) {
      const color = isGoldLead ? COLORS.GOLD : COLORS.BLUE;
      const title = isGoldLead
        ? '🥇 New Call Booked - £2,997'
        : '📞 New Call Booked - £1,997';
      const embed = createEmbed(title, discordFields, color);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_BOOKED_CALLS, embed);
    } else {
      if (firstName || email || phone) {
        await createGHLContact({
          firstName, lastName, email, phone,
          locationId: process.env.GHL_LOCATION_ID,
          source: source || 'Typeform',
          tags: ['typeform-lead'],
        });
      }
      const color = isGoldLead ? COLORS.GOLD : COLORS.BLUE;
      const title = isGoldLead ? '🥇 New Lead - £2,997' : '📞 New Lead - £1,997';
      const embed = createEmbed(title, discordFields, color);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_LEADS, embed);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Typeform error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
