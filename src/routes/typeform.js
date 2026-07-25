const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');
const axios = require('axios');

const processedEmails = new Map();
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

function isDuplicateEmail(email) {
  if (!email) return false;
  const now = Date.now();
  if (processedEmails.has(email)) {
    const timestamp = processedEmails.get(email);
    if (now - timestamp < DEDUP_WINDOW_MS) {
      console.log(`Duplicate email blocked: ${email}`);
      return true;
    }
  }
  processedEmails.set(email, now);
  for (const [k, t] of processedEmails.entries()) {
    if (now - t > DEDUP_WINDOW_MS) processedEmails.delete(k);
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

function determineLeadTier(answers, fields_def) {
  let hasHighIncome = false;
  let hasInvestment = false;
  let hasGoodCreditScore = false;
  let isIneligible = false;
  let firstName = '';
  let lastName = '';
  let email = '';
  let phone = '';
  let workCircumstances = '';

  answers.forEach((answer, index) => {
    const fieldDef = fields_def[index];
    const fieldTitle = (fieldDef?.title || '').toLowerCase();
    let value = '';

    if (answer.type === 'choice') value = answer.choice?.label || '';
    else if (answer.type === 'text') value = answer.text || '';
    else if (answer.type === 'email') value = answer.email || '';
    else if (answer.type === 'phone_number') value = answer.phone_number || '';

    const valueLower = value.toLowerCase();

    if (fieldTitle.includes('first name')) firstName = value;
    if (fieldTitle.includes('last name')) lastName = value;
    if (fieldTitle.includes('email')) email = value;
    if (fieldTitle.includes('phone')) phone = value;

    // Work circumstances check
    if (fieldTitle.includes('work circumstances') || fieldTitle.includes('circumstances')) {
      workCircumstances = value;
      // Above £35k → Gold
      if (valueLower.includes('earning above £35k') || valueLower.includes('above £35k')) {
        hasHighIncome = true;
      }
      // Unemployed or Tier 2 → always Blue
      if (valueLower.includes('unemployed') || valueLower.includes('tier 2') || valueLower.includes('sponsorship')) {
        isIneligible = true;
      }
    }

    // Investment check
    if (fieldTitle.includes('investment') || fieldTitle.includes('invest')) {
      if (valueLower.includes('yes') || valueLower.includes('can invest')) {
        hasInvestment = true;
      }
    }

    // Credit score check - only 600+
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
    }
  });

  // Tier logic
  if (isIneligible) {
    // Unemployed or Tier 2 → Blue £1,997
    return { tier: 'blue', color: COLORS.BLUE, prefix: '📞', price: '£1,997', opportunityValue: 1997, source: 'UQ', firstName, lastName, email, phone, workCircumstances };
  } else if (hasHighIncome) {
    // Above £35k → Gold £2,997
    return { tier: 'gold', color: COLORS.GOLD, prefix: '🥇', price: '£2,997', opportunityValue: 2997, source: 'Finance', firstName, lastName, email, phone, workCircumstances };
  } else if (hasInvestment && hasGoodCreditScore) {
    // Below £35k + Yes + credit 600+ → Gold £1,997
    return { tier: 'gold', color: COLORS.GOLD, prefix: '🥇', price: '£1,997', opportunityValue: 1997, source: 'Finance', firstName, lastName, email, phone, workCircumstances };
  } else if (hasInvestment && !hasGoodCreditScore) {
    // Below £35k + Yes + credit below 600 → Green £1,997
    return { tier: 'green', color: COLORS.GREEN, prefix: '🟢', price: '£1,997', opportunityValue: 1997, source: 'UQ', firstName, lastName, email, phone, workCircumstances };
  } else {
    // No investment → Blue £1,997
    return { tier: 'blue', color: COLORS.BLUE, prefix: '📞', price: '£1,997', opportunityValue: 1997, source: 'UQ', firstName, lastName, email, phone, workCircumstances };
  }
}

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

async function createGHLOpportunity(contact, tierData) {
  try {
    const pipelineId = process.env.GHL_PIPELINE_ID;
    const stageId = process.env.GHL_PIPELINE_STAGE_ID;
    if (!pipelineId || !stageId || !contact?.id) return;

    const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email;

    await axios.post(
      'https://services.leadconnectorhq.com/opportunities/',
      {
        pipelineId,
        pipelineStageId: stageId,
        contactId: contact.id,
        name,
        locationId: process.env.GHL_LOCATION_ID,
        status: 'open',
        monetaryValue: tierData.opportunityValue,
        source: tierData.source,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
        }
      }
    );
    console.log('GHL opportunity created successfully');
  } catch (err) {
    console.error('GHL opportunity error:', err.response?.status, JSON.stringify(err.response?.data));
  }
}

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const answers = payload.form_response?.answers || [];
    const fields_def = payload.form_response?.definition?.fields || [];
    const hidden = payload.form_response?.hidden || {};

    const tierData = determineLeadTier(answers, fields_def);
    const { color, prefix, price, firstName, lastName, email, phone } = tierData;

    // Need at least email or phone to process
    if (!email && !phone && !firstName) {
      return res.json({ success: true, skipped: 'no contact info' });
    }

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

    // Always create GHL contact and opportunity for ALL submissions
    if (!isDuplicateEmail(email)) {
      const contact = await createGHLContact({
        firstName,
        lastName,
        email,
        phone,
        locationId: process.env.GHL_LOCATION_ID,
        source: 'typeform',
        tags: ['typeform-lead'],
      });
      if (contact) {
        await createGHLOpportunity(contact, tierData);
      }

      // Always send to new leads
      const newLeadTitle = `${prefix} New Lead - ${price}`;
      const newLeadEmbed = createEmbed(newLeadTitle, newLeadFields, color);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_LEADS, newLeadEmbed);
    }

    // Also send to call booked if booking present
    if (hasCalendly) {
      const bookedTitle = `${prefix} New Call Booked - ${price}`;
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
