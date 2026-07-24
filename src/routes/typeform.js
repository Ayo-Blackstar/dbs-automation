const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');

function abbreviateTitle(title) {
  const map = {
    'how long have you been living in the uk': 'UK Residency',
    'why are you considering changing your career': 'Reason for Change',
    'what best describes your work circumstances': 'Work Circumstances',
    'the investment for our program is': 'Investment',
    'to be approved for a 12-month payment plan': 'Credit Score',
    'if you are accepted into our training program': 'Start Timeline',
    'first name': 'First Name',
    'last name': 'Last Name',
    'phone': 'Phone',
    'email': 'Email',
  };

  const lower = title.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return title;
}

function isCalendlyBookingUrl(value) {
  return value && value.includes('calendly.com') && value.includes('invitees');
}

function checkGoldLead(answers, fields_def) {
  let hasHighIncome = false;
  let hasInvestment = false;
  let hasGoodCreditScore = false;

  answers.forEach((answer, index) => {
    const fieldDef = fields_def[index];
    const fieldTitle = (fieldDef?.title || '').toLowerCase();
    let value = '';

    if (answer.type === 'choice') value = answer.choice?.label || '';
    else if (answer.type === 'text') value = answer.text || '';
    else if (answer.type === 'email') value = answer.email || '';
    else if (answer.type === 'phone_number') value = answer.phone_number || '';

    const valueLower = value.toLowerCase();

    // High income check
    if (fieldTitle.includes('work circumstances') || fieldTitle.includes('circumstances')) {
      if (
        valueLower.includes('above £35k') ||
        valueLower.includes('earning above') ||
        valueLower.includes('35k') ||
        valueLower.includes('40k') ||
        valueLower.includes('50k') ||
        valueLower.includes('60k')
      ) {
        hasHighIncome = true;
      }
    }

    // Investment check
    if (fieldTitle.includes('investment') || fieldTitle.includes('invest')) {
      if (valueLower.includes('yes') || valueLower.includes('can invest')) {
        hasInvestment = true;
      }
    }

    // Credit score check - above 600
    if (fieldTitle.includes('credit score') || fieldTitle.includes('experian')) {
      if (
        valueLower.includes('800') ||
        valueLower.includes('701') ||
        valueLower.includes('700') ||
        valueLower.includes('600 - 700') ||
        (valueLower.includes('600') && !valueLower.includes('below 600'))
      ) {
        hasGoodCreditScore = true;
      }
    }
  });

  // Gold if: high income OR (investment yes + good credit score)
  return hasHighIncome || (hasInvestment && hasGoodCreditScore);
}

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const answers = payload.form_response?.answers || [];
    const fields_def = payload.form_response?.definition?.fields || [];
    const hidden = payload.form_response?.hidden || {};

    const discordFields = [];
    let hasCalendly = false;
    let calendlyCount = 0;

    const isGoldLead = checkGoldLead(answers, fields_def);

    const now = new Date().toLocaleDateString('en-GB');
    discordFields.push({ name: 'Time', value: now, inline: true });

    answers.forEach((answer, index) => {
      const fieldDef = fields_def[index];
      const rawTitle = fieldDef?.title || `Question ${index + 1}`;
      const fieldTitle = abbreviateTitle(rawTitle);
      let value = '';

      switch (answer.type) {
        case 'text':
          value = answer.text || '';
          break;
        case 'email':
          value = answer.email || '';
          break;
        case 'phone_number':
          value = answer.phone_number || '';
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

    const color = isGoldLead ? COLORS.GOLD : COLORS.BLUE;

    if (hasCalendly) {
      const title = isGoldLead
        ? '🥇 New Call Booked - £2,997'
        : '📞 New Call Booked - £1,997';
      const embed = createEmbed(title, discordFields, color);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_BOOKED_CALLS, embed);
    } else {
      const title = isGoldLead
        ? '🥇 New Lead - £2,997'
        : '📞 New Lead - £1,997';
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
