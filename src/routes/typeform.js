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
  let firstName = '';
  let lastName = '';
  let email = '';
  let phone = '';
  let workCircumstances = '';
  let reasonForChange = '';

  answers.forEach((answer, index) => {
    const fieldDef = fields_def[index];
    const fieldTitle = (fieldDef?.title || '').toLowerCase();
    let value = '';

    if (answer.type === 'choice') value = answer.choice?.label || '';
    else if (answer.type === 'text') value = answer.text || '';
    else if (answer.type === 'email') {
      value = answer.email || '';
      email = value;
    }
    else if (answer.type === 'phone_number') {
      value = answer.phone_number || '';
      phone = value;
    }

    const valueLower = value.toLowerCase();

    if (fieldTitle.includes('first name')) firstName = value;
    if (fieldTitle.includes('last name')) lastName = value;

    if (fieldTitle.includes('work circumstances') || fieldTitle.includes('circumstances')) {
      workCircumstances = value;
      if (valueLower.includes('earning above £35k') || valueLower.includes('above £35k')) {
        hasHighIncome = true;
      }
    }

    if (fieldTitle.includes('why are you considering') || fieldTitle.includes('reason for change') || fieldTitle.includes('changing your career')) {
      reasonForChange = value;
    }

    if (fieldTitle.includes('investment') || fieldTitle.includes('invest')) {
      if (valueLower.includes('yes') || valueLower.includes('can invest')) {
        hasInvestment = true;
      }
    }

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

  if (hasHighIncome) {
    return { tier: 'gold', color: COLORS.GOLD, prefix: '🥇', price: '£2,997', opportunityValue: 2997, source: 'Finance', firstName, lastName, email, phone, workCircumstances, reasonForChange };
  } else if (hasInvestment && hasGoodCreditScore) {
    return { tier: 'gold', color: COLORS.GOLD, prefix: '🥇', price: '£1,997', opportunityValue: 1997, source: 'Finance', firstName, lastName, email, phone, workCircumstances, reasonForChange };
  } else if (hasInvestment && !hasGoodCreditScore) {
    return { tier: 'green', color: COLORS.GREEN, prefix: '🟢', price: '£1,997', opportunityValue: 1997, source: 'UQ', firstName, lastName, email, phone, workCircumstances, reasonForChange };
  } else {
    return { tier: 'blue', color: COLORS.BLUE, prefix: '📞', price: '£1,997', opportunityValue: 1997, source: 'UQ', firstName, lastName, email, phone, workCircumstances, reasonForChange };
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
    if (err.response?.status === 400 && err.response?.data?.meta?.contactId) {
      console.log('GHL contact already exists:', err.response.data.meta.contactId);
      return { id: err.response.data.meta.contactId };
    }
    console.error('GHL contact error:', err.response?.status, JSON.stringify(err.response?.data));
    return null;
  }
}

async function createGHLOpportunity(contact, stageId, tierData) {
  try {
    const pipelineId = process.env.GHL_PIPELINE_ID;
    if (!pipelineId || !stageId || !contact?.id) return null;

    const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'New Lead';

    const response = await axios.post(
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
    console.log('GHL opportunity created:', response.data?.opportunity?.id);
    return response.data?.opportunity;
  } catch (err) {
    console.error('GHL opportunity error:', err.response?.status, JSON.stringify(err.response?.data));
    return null;
  }
}

async function findAndUpdateOpportunityStage(contactId, stageId) {
  try {
    const pipelineId = process.env.GHL_PIPELINE_ID;
    if (!pipelineId || !stageId || !contactId) return null;

    const response = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&contact_id=${contactId}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Version': '2021-07-28'
        }
      }
    );

    const opportunities = response.data?.opportunities || [];
    const opportunity = opportunities.find(o => o.pipelineId === pipelineId);

    if (opportunity) {
      await axios.put(
        `https://services.leadconnectorhq.com/opportunities/${opportunity.id}`,
        { pipelineStageId: stageId },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28'
          }
        }
      );
      console.log('GHL opportunity stage updated');
      return opportunity;
    }
    return null;
  } catch (err) {
    console.error('GHL opportunity update error:', err.response?.status, JSON.stringify(err.response?.data));
    return null;
  }
}

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const answers = payload.form_response?.answers || [];
    const fields_def = payload.form_response?.definition?.fields || [];
    const hidden = payload.form_response?.hidden || {};

    const tierData = determineLeadTier(answers, fields_def);
    const { color, prefix, price, firstName, lastName, email, phone, workCircumstances, reasonForChange } = tierData;

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

    if (hasCalendly && calendlyValue) {
      bookedCallFields.push({
        name: 'Call Booking',
        value: String(calendlyValue).substring(0, 1024),
        inline: true
      });
    }

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

    // Build custom fields for GHL contact
    const customFields = [];
    if (workCircumstances) {
      customFields.push({ id: 'pM6OspnbLUhfs16LW3JT', value: workCircumstances });
    }
    if (reasonForChange) {
      customFields.push({ id: 'kCPReLZORsoy7HsJNiDQ', value: reasonForChange });
    }

    // Always create GHL contact for ALL leads
    const contact = await createGHLContact({
      firstName,
      lastName,
      email,
      phone,
      locationId: process.env.GHL_LOCATION_ID,
      source: 'typeform',
      tags: ['typeform-lead'],
      customFields,
    });

    if (hasCalendly) {
      if (contact?.id) {
        const existing = await findAndUpdateOpportunityStage(
          contact.id,
          process.env.GHL_PIPELINE_BOOKED_STAGE_ID
        );
        if (!existing) {
          await createGHLOpportunity(contact, process.env.GHL_PIPELINE_BOOKED_STAGE_ID, tierData);
        }
      }

      const bookedTitle = `${prefix} New Call Booked - ${price}`;
      const bookedEmbed = createEmbed(bookedTitle, bookedCallFields, color);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_BOOKED_CALLS, bookedEmbed);

    } else {
      if (!isDuplicateEmail(email) && contact?.id) {
        await createGHLOpportunity(contact, process.env.GHL_PIPELINE_STAGE_ID, tierData);

        const newLeadTitle = `${prefix} New Lead - ${price}`;
        const newLeadEmbed = createEmbed(newLeadTitle, newLeadFields, color);
        await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_LEADS, newLeadEmbed);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Typeform error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
