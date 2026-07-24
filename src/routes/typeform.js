const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');

function checkGoldLeadByValue(value) {
  const valueLower = value.toLowerCase();
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
        case 'url':
          // Skip calendly/url fields entirely
          return;
        default:
          value = answer.url || answer.text || answer.email || '';
      }

      const titleLower = fieldTitle.toLowerCase();

      // Gold lead - income/work circumstances
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

      // Gold lead - credit score above 600
      if (
        titleLower.includes('credit score') ||
        titleLower.includes('experian') ||
        titleLower.includes('credit')
      ) {
        if (checkGoldLeadByCreditScore(value)) isGoldLead = true;
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

    // Always send to new leads channel
    const color = isGoldLead ? COLORS.GOLD : COLORS.BLUE;
    const title = isGoldLead ? '🥇 New Lead - £2,997' : '📞 New Lead - £1,997';
    const embed = createEmbed(title, discordFields, color);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_LEADS, embed);

    res.json({ success: true });
  } catch (err) {
    console.error('Typeform error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
