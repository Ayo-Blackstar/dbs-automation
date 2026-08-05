const express = require('express');
const router = express.Router();
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
    return { tier: 'gold', opportunityValue: 2997, source: 'Finance', firstName, lastName, email, phone, workCircumstances, reasonForChange };
  } else if (hasInvestment && hasGoodCreditScore) {
    return { tier: 'gold', opportunityValue: 1997, source: 'Finance', firstName, lastName, email, phone, workCircumstances, reasonForChange };
  } else if (hasInvestment && !hasGoodCreditScore) {
    return { tier: 'green', opportunityValue: 1997, source: 'UQ', firstName, lastName, email, phone, workCircumstances, reasonForChange };
  } else {
    return { tier: 'blue', opportunityValue: 1997, source: 'UQ', firstName, lastName, email, phone, workCircumstances, reasonForChange };
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

    const tierData = determineLeadTier(answers, fields_def);
    const { firstName, lastName, email, phone, workCircumstances, reasonForChange, tier } = tierData;

    if (!email && !phone && !firstName) {
      return res.json({ success: true, skipped: 'no contact info' });
    }

    // Build custom fields
    const customFields = [];
    if (workCircumstances) {
      customFields.push({ id: 'pM6OspnbLUhfs16LW3JT', value: workCircumstances });
    }
    if (reasonForChange) {
      customFields.push({ id: 'kCPReLZORsoy7HsJNiDQ', value: reasonForChange });
    }

    // Always create GHL contact with tier tag
    const contact = await createGHLContact({
      firstName,
      lastName,
      email,
      phone,
      locationId: process.env.GHL_LOCATION_ID,
      source: 'typeform',
      tags: ['typeform-lead', `${tier}-lead`],
      customFields,
    });

    if (!contact?.id) {
      return res.json({ success: true, skipped: 'contact creation failed' });
    }

    // Check if booking present
    let hasCalendly = false;
    answers.forEach(answer => {
      if (answer.type === 'calendly') hasCalendly = true;
      if (answer.type === 'url' && isCalendlyBookingUrl(answer.url)) hasCalendly = true;
    });

    if (hasCalendly) {
      // Move opportunity to Appointment Booked
      const existing = await findAndUpdateOpportunityStage(
        contact.id,
        process.env.GHL_PIPELINE_BOOKED_STAGE_ID
      );
      if (!existing) {
        await createGHLOpportunity(contact, process.env.GHL_PIPELINE_BOOKED_STAGE_ID, tierData);
      }
    } else {
      // New lead - create opportunity in Submitted Application
      if (!isDuplicateEmail(email)) {
        await createGHLOpportunity(contact, process.env.GHL_PIPELINE_STAGE_ID, tierData);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Typeform error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
