/**
 * Calendar Agent (Google Calendar)
 *
 * Surfaces:
 *   - Today's meetings with attendee context
 *   - Pre-meeting briefs (cross-referenced with HubSpot contacts)
 *   - Back-to-back warnings
 *   - Events where key prospects will be present
 */
import { BaseAgent } from './base-agent.js';
import { claudeAnalyse } from '../utils/claude.js';
import { google } from 'googleapis';

function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return google.calendar({ version: 'v3', auth });
}

class CalendarAgent extends BaseAgent {
  constructor() { super('calendar'); }

  async fetch(_exec, date) {
    const cal = getCalendarClient();
    const timeMin = new Date(`${date}T00:00:00`).toISOString();
    const timeMax = new Date(`${date}T23:59:59`).toISOString();

    const eventsRes = await cal.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    return { events: eventsRes.data.items ?? [] };
  }

  async analyse(raw, exec, date) {
    const events = raw.events.filter(e =>
      e.status !== 'cancelled' && e.eventType !== 'outOfOffice'
    );

    const summary = await claudeAnalyse(`
You are preparing the calendar briefing for ${exec.name}, ${exec.role} at Rokt. Date: ${date}.

Today's meetings:
${JSON.stringify(events.map(e => ({
  title: e.summary,
  start: e.start?.dateTime ?? e.start?.date,
  end: e.end?.dateTime ?? e.end?.date,
  attendees: e.attendees?.map(a => ({ email: a.email, name: a.displayName, organiser: a.organizer })),
  description: (e.description ?? '').substring(0, 400),
  location: e.location,
  conferenceLink: e.conferenceData?.entryPoints?.[0]?.uri,
})), null, 2)}

For each EXTERNAL meeting (non-Rokt attendees), write a pre-meeting brief:
- Who is attending (name, company, role if known)
- Key talking points / what they likely want
- Any known deal context
- Suggested prep (1-2 lines)

Also flag:
- Back-to-back blocks with no break
- Any scheduling conflicts

Return JSON: {
  summary,
  items: [{ emoji, text, urgency, meetingTitle?, time? }],
  urgentFlags,
  preMeetingBriefs: [{ meetingTitle, time, attendees, keyPoints, suggestedPrep }]
}
`, 'json');

    return {
      source: 'calendar',
      summary: summary.summary,
      items: summary.items ?? [],
      urgentFlags: summary.urgentFlags ?? [],
      preMeetingBriefs: summary.preMeetingBriefs ?? [],
      raw: { eventCount: events.length },
    };
  }
}

export default new CalendarAgent();
