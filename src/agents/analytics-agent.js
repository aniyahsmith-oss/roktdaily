/**
 * Analytics Agent (ELT reports + Replit tools inventory)
 *
 * Surfaces:
 *   - Key KPIs vs prior period (revenue, pipeline, conversion rates)
 *   - New Replit tools/apps employees have shipped
 *   - Anomalies in core metrics
 *
 * This agent is intentionally flexible — plug in your warehouse query
 * or BI tool API in fetch(). The Replit section scrapes a Notion page
 * or Slack channel where employees post new tools.
 */
import { BaseAgent } from './base-agent.js';
import { claudeAnalyse } from '../utils/claude.js';

class AnalyticsAgent extends BaseAgent {
  constructor() { super('analytics'); }

  async fetch(exec, date) {
    // ── ELT / BI metrics ───────────────────────────────────────────────────
    // Replace this stub with your actual data warehouse query.
    // Examples: BigQuery, Snowflake, Redshift, or a BI API (Looker, Mode).
    //
    // const metrics = await queryBigQuery(`
    //   SELECT date, total_revenue, pipeline_value, deals_closed, new_leads
    //   FROM rokt.daily_metrics
    //   WHERE date >= DATE_SUB('${date}', INTERVAL 7 DAY)
    //   ORDER BY date DESC
    // `);

    // Stub — replace with real data
    const metrics = {
      today: {
        revenue: null,
        pipelineValue: null,
        dealsClosedMtd: null,
        newLeads: null,
      },
      note: 'Connect your BI tool / data warehouse in analytics-agent.js fetch()',
    };

    // ── Replit tools inventory ─────────────────────────────────────────────
    // Option A: Query a Notion page where employees log new tools
    // Option B: Watch a Slack channel like #replit-tools
    // Option C: Use Replit's API if you have a team account
    //
    // Stub — connect to your chosen source
    const replitTools = [];
    // Example Notion approach (if you have Notion credentials):
    // const notion = new Client({ auth: process.env.NOTION_TOKEN });
    // const results = await notion.databases.query({ database_id: REPLIT_DB_ID, ... });
    // replitTools = results.results.map(r => ({ name: r.properties.Name.title[0].plain_text, ... }));

    return { metrics, replitTools };
  }

  async analyse(raw, exec, date) {
    const summary = await claudeAnalyse(`
You are summarising analytics and internal tooling for ${exec.name}, ${exec.role} at Rokt. Date: ${date}.

Key business metrics:
${JSON.stringify(raw.metrics, null, 2)}

New Replit tools shipped by the team recently:
${JSON.stringify(raw.replitTools, null, 2)}

Note: Some data may be stubs if the BI integration isn't yet connected.

Write a concise briefing:
1. Headline metric movements (if available)
2. Any anomalies or records to flag
3. New internal tools the CCO should know about

Return JSON: { summary, items: [{ emoji, text, urgency }], urgentFlags }
`, 'json');

    return {
      source: 'analytics',
      summary: summary.summary,
      items: summary.items ?? [],
      urgentFlags: summary.urgentFlags ?? [],
    };
  }
}

export default new AnalyticsAgent();
