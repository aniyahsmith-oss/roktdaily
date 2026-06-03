/**
 * Asana Agent
 *
 * Surfaces:
 *   - Content that went live yesterday / today
 *   - Overdue or at-risk tasks in key projects
 *   - Tasks assigned to the exec that need action
 *   - Projects with no recent activity (stalled)
 */
import { BaseAgent } from './base-agent.js';
import { claudeAnalyse } from '../utils/claude.js';

const ASANA_BASE = 'https://app.asana.com/api/1.0';

async function asanaGet(path, params = {}) {
  const url = new URL(`${ASANA_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.ASANA_ACCESS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Asana ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data;
}

class AsanaAgent extends BaseAgent {
  constructor() { super('asana'); }

  async fetch(exec, date) {
    const workspace = process.env.ASANA_WORKSPACE_GID;
    const since = new Date(date);
    since.setDate(since.getDate() - 1);

    // Tasks completed recently (content that went live)
    const completed = await asanaGet('/tasks', {
      workspace,
      completed_since: since.toISOString(),
      opt_fields: 'name,completed_at,assignee.name,projects.name,due_on,tags.name,notes',
      limit: 50,
    });

    // Overdue tasks
    const overdue = await asanaGet('/tasks', {
      workspace,
      due_on: `<${date}`,
      completed: false,
      opt_fields: 'name,due_on,assignee.name,projects.name,memberships.project.name',
      limit: 30,
    });

    // Tasks assigned to exec
    let myTasks = [];
    try {
      const me = await asanaGet('/users/me');
      myTasks = await asanaGet('/tasks', {
        assignee: me.gid,
        workspace,
        completed: false,
        opt_fields: 'name,due_on,projects.name,notes',
        limit: 20,
      });
    } catch (_) { /* exec may not have Asana token */ }

    return { completed: completed ?? [], overdue: overdue ?? [], myTasks: myTasks ?? [] };
  }

  async analyse(raw, exec, date) {
    const summary = await claudeAnalyse(`
You are summarising Asana project activity for ${exec.name}, ${exec.role} at Rokt. Date: ${date}.

Tasks completed recently (content/work that went live):
${JSON.stringify(raw.completed.map(t => ({
  name: t.name,
  completedAt: t.completed_at,
  project: t.projects?.[0]?.name,
  tags: t.tags?.map(g => g.name),
})), null, 2)}

Overdue tasks (potential blockers):
${JSON.stringify(raw.overdue.map(t => ({
  name: t.name,
  dueOn: t.due_on,
  assignee: t.assignee?.name,
  project: t.memberships?.[0]?.project?.name,
})), null, 2)}

Tasks assigned to ${exec.name}:
${JSON.stringify(raw.myTasks.map(t => ({
  name: t.name,
  dueOn: t.due_on,
  project: t.projects?.[0]?.name,
})), null, 2)}

Write a briefing covering:
1. Key content or work that shipped / went live
2. At-risk or overdue items needing exec attention
3. ${exec.name}'s own pending tasks

Return JSON: { summary, items: [{ emoji, text, urgency, project? }], urgentFlags }
`, 'json');

    return {
      source: 'asana',
      summary: summary.summary,
      items: summary.items ?? [],
      urgentFlags: summary.urgentFlags ?? [],
      raw: {
        completedCount: raw.completed.length,
        overdueCount: raw.overdue.length,
        myTaskCount: raw.myTasks.length,
      },
    };
  }
}

export default new AsanaAgent();
