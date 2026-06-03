/**
 * HubSpot Agent
 *
 * Surfaces:
 *   - Deals that changed stage in the last 24 h
 *   - New/updated high-value deals (above exec-configured threshold)
 *   - Key prospect contacts and any events they're attending
 *   - Deals that are stalled or need exec attention
 */
import { BaseAgent } from './base-agent.js';
import { claudeAnalyse } from '../utils/claude.js';

const HS_BASE = 'https://api.hubapi.com';

async function hsGet(path, params = {}) {
  const url = new URL(`${HS_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json();
}

class HubSpotAgent extends BaseAgent {
  constructor() { super('hubspot'); }

  async fetch(exec, date) {
    const since = new Date(date);
    since.setDate(since.getDate() - 1);
    const sinceMs = since.getTime();

    // Fetch recently modified deals
    const dealsRes = await hsGet('/crm/v3/objects/deals', {
      limit: 50,
      properties: 'dealname,amount,dealstage,pipeline,closedate,hs_lastmodifieddate,hubspot_owner_id',
      filterGroups: JSON.stringify([{
        filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: sinceMs }],
      }]),
    });

    // Fetch contacts with upcoming events (custom property — or notes)
    // Adjust property names to match your HubSpot schema
    const contactsRes = await hsGet('/crm/v3/objects/contacts', {
      limit: 20,
      properties: 'firstname,lastname,company,email,upcoming_event,event_date,jobtitle,lifecyclestage',
      filterGroups: JSON.stringify([{
        filters: [{ propertyName: 'lifecyclestage', operator: 'IN', values: ['opportunity', 'salesqualifiedlead'] }],
      }]),
    });

    return {
      deals: dealsRes.results ?? [],
      contacts: contactsRes.results ?? [],
    };
  }

  async analyse(raw, exec, date) {
    const prefs = exec.preferences;
    const threshold = prefs.dealValueThreshold ?? 100000;

    // Filter to deals that actually moved
    const movedDeals = raw.deals.filter(d => {
      const modified = new Date(d.properties.hs_lastmodifieddate);
      const yesterday = new Date(date);
      yesterday.setDate(yesterday.getDate() - 1);
      return modified >= yesterday;
    });

    const highValueDeals = movedDeals.filter(
      d => parseFloat(d.properties.amount ?? 0) >= threshold
    );

    // Ask Claude to summarise the deal movements in plain English
    const summary = await claudeAnalyse(`
You are summarising HubSpot deal activity for ${exec.name}, ${exec.role} at Rokt.

Deals that moved in the last 24 hours:
${JSON.stringify(movedDeals.map(d => d.properties), null, 2)}

Key prospect contacts and events they're attending:
${JSON.stringify(raw.contacts.map(c => c.properties), null, 2)}

Preferences: deal value threshold = $${threshold.toLocaleString()}

Write a concise briefing section (3–8 bullet points) covering:
1. Most significant deal movements (stage changes, large amounts)
2. Any deals at risk or stalled
3. Prospect contacts attending upcoming events (connection opportunities)
4. Anything the CCO should act on today

Format: return JSON with keys:
  summary (1-sentence headline),
  items (array of { emoji, text, urgency: 'high'|'medium'|'low', dealName?, amount? }),
  urgentFlags (array of strings — only truly urgent items)
`, 'json');

    return {
      source: 'hubspot',
      summary: summary.summary,
      items: summary.items ?? [],
      urgentFlags: summary.urgentFlags ?? [],
      raw: { movedDeals: movedDeals.length, highValue: highValueDeals.length },
    };
  }
}

export default new HubSpotAgent();
