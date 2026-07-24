const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');

// Deduplication cache
const processedResponses = new Map();
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

function isDuplicate(responseId) {
  const now = Date.now();
  if (processedResponses.has(responseId)) {
    const timestamp = processedResponses.get(responseId);
    if (now - timestamp < DEDUP_WINDOW_MS) {
      console.log(`Duplicate blocked: ${responseId}`);
      return true;
    }
  }
  processedResponses.set(responseId, now);
  for (const [k, t] of processedResponses.entries()) {
    if (now - t > DEDUP_WINDOW_MS) processedResponses.delete(k);
  }
  return false;
}

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

    // High income check - above £35k
    if (fieldTitle.includes('work circumstances') || fieldTitle.includes('circumstances')) {
      if (
        valueLower.includes('above £35k') ||
        valueLower.includes('earning above') ||
        valueLower.includes('35k') ||
        valueLower.includes('40k') ||
        valueLower.includes('45k') ||
        valueLower.includes('50k') ||
        valueLower.includes('60k') ||
        valueLower.includes('over £35')
      ) {
        hasHighIncome = true;
      }
    }

    // Credit score check - ONLY above 600 (600-700, 701-800, 800+)
    if (fieldTitle.includes('credit score') || fieldTitle.includes('experian')) {
      if (
        valueLower.includes('800+') ||
        valueLower.includes('800') ||
        valueLower.includes('701 - 800') ||
        valueLower.includes('701') ||
        valueLower.includes('600 - 700')
      ) {
        hasGoodCreditScore = true;
      }
      // NOT matching: 'below 600', 'i don't have a credit score'
    }
  });

  // Gold if: high income OR good credit score
  return hasHighIncome || hasGoodCreditScore;
}

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const responseId = payload.form_response?.token || payload.event_id || '';

    if (responseId && isDuplicate(responseId)) {
      return res.json({ success: true, skipped: 'duplicate' });
    }

    const answers = payload.form_response?.answers || [];
    const fields_def = payload.form_response?.definition?.fields || [];
    const hidden = payload.form_response?.hidden || {};

    const isGoldLead = checkGoldLead(answers, fields_def);
    const color = isGoldLead ? COLORS.GREEN : COLORS.BLUE;

    const newLeadFields = [];
    const bookedCallFields = [];

    let hasCalendly = false;
    let calendlyValue = '';

    const now = new Date().toLocaleDateString('en-GB');
    newLeadFields.push({ name: 'Time', value: now, inline: true });
    bookedCallFields.push({ name: 'Time', value: now, inline: true });

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
          if (!hasCalendly) {
            hasCalendly = true;
            calendlyValue = answer.url || 'Call Booked ✅';
          }
          return;
        case 'url':
          value = answer.url || '';
          if (isCalendlyBookingUrl(value)) {
            if (!hasCalendly) {
              hasCalendly = true;
              calendlyValue = value;
            }
            return;
          }
          break;
        default:
          value = answer.url || answer.text || answer.email || '';
          if (isCalendlyBookingUrl(value)) {
            if (!hasCalendly) {
              hasCalendly = true;
              calendlyValue = value;
            }
            return;
          }
      }

      if (value) {
        const field = {
          name: fieldTitle.substring(0, 256),
          value: String(value).substring(0, 1024),
          inline: true
        };
        newLeadFields.push(field);
        bookedCallFields.push(field);
      }
    });

    // Add calendly link ONLY to booked call fields
    if (hasCalendly && calendlyValue) {
      bookedCallFields.push({
        name: 'Call Booking',
        value: String(calendlyValue).substring(0, 1024),
        inline: true
      });
    }

    // Add UTM data to both
    if (hidden && Object.keys(hidden).length > 0) {
      const utmLines = Object.entries(hidden)
        .filter(([k, v]) => v)
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n');
      if (utmLines) {
        const utmField = { name: 'ATTRIBUTION', value: utmLines, inline: false };
        newLeadFields.push(utmField);
        bookedCallFields.push(utmField);
      }
    }

    // Always send to new leads
    const newLeadTitle = isGoldLead ? '🟢 New Lead - £2,997' : '📞 New Lead - £1,997';
    const newLeadEmbed = createEmbed(newLeadTitle, newLeadFields, color);
    await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_LEADS, newLeadEmbed);

    // Also send to call booked if booking present
    if (hasCalendly) {
      const bookedTitle = isGoldLead ? '🟢 New Call Booked - £2,997' : '📞 New Call Booked - £1,997';
      const bookedEmbed = createEmbed(bookedTitle, bookedCallFields, color);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_BOOKED_CALLS, bookedEmbed);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Typeform error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
