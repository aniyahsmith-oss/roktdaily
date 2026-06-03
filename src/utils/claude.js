/**
 * LLM API helpers (OpenAI)
 *
 * The function names are kept (claudeAnalyse / claudeChat / claudeSynthesize)
 * so the rest of the codebase doesn't need to change — only the implementation
 * was migrated from the Anthropic SDK to OpenAI.
 *
 * claudeAnalyse(prompt, format)        — gpt-4o-mini, fast/cheap per-agent analysis
 * claudeChat(messages, system)         — gpt-4o, multi-turn Q&A conversations
 * claudeSynthesize(systemPrompt, user) — gpt-4o, final brief synthesis
 */
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Quick single-turn analysis. Used by source agents.
 * @param {string} prompt
 * @param {'text'|'json'} format
 */
export async function claudeAnalyse(prompt, format = 'text') {
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini', // fast + cheap for per-agent work
    max_tokens: 1024,
    ...(format === 'json' ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      {
        role: 'system',
        content: format === 'json'
          ? 'You are a data analyst. Respond ONLY with valid JSON — no markdown fences, no explanation.'
          : 'You are a concise executive analyst.',
      },
      { role: 'user', content: prompt },
    ],
  });

  const text = (res.choices[0].message.content ?? '').trim();
  if (format === 'json') {
    try { return JSON.parse(text); }
    catch { return { summary: text, items: [], urgentFlags: [] }; }
  }
  return text;
}

/**
 * Multi-turn conversation for Q&A sessions.
 * @param {Array} messages  - array of { role, content }
 * @param {string} system
 */
export async function claudeChat(messages, system) {
  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 2048,
    messages: [{ role: 'system', content: system }, ...messages],
  });
  return res.choices[0].message.content;
}

/**
 * Final synthesis — assembles the complete brief from all source outputs.
 * Uses the most capable model for best reasoning.
 */
export async function claudeSynthesize(systemPrompt, userContent) {
  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });
  return res.choices[0].message.content;
}
