const SYSTEM_PROMPT = `You are a focus coach. You see one screenshot of the user's screen, the task they are supposed to be working on, and a short list of what they were doing recently.

Decide whether the screenshot shows the user working on their task (or something clearly related to it, such as docs, a terminal, an editor, or an AI assistant helping with the work) or being sidetracked (video streaming, social media, games, shopping, news, unrelated browsing, etc.).

If no task is given, infer it from the recent history; if there is no history, treat productive-looking work as on task.
Brief, legitimate breaks (a few seconds on another tab) are fine; judge what the screen is mainly showing.

Reply with ONLY JSON:
{"activity": "<one short sentence describing what they are doing>", "on_task": true|false, "confidence": <0..1>}`;

async function analyze(cfg, apiKey, jpeg, history) {
  if (!apiKey) throw new Error('No OpenAI API key set.');
  const recent = history.length
    ? history.map((h) => `- ${h.activity} (${h.onTask ? 'on task' : 'off task'})`).join('\n')
    : '(none yet)';
  const goalText = cfg.goal?.trim() ? cfg.goal.trim() : '(not specified)';

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: cfg.openaiModel,
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Task the user should be working on: ${goalText}\n\nRecent activity:\n${recent}` },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'auto' } }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(60000)
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI error (${r.status}): ${data.error?.message || 'unknown'}`);

  let parsed;
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch {
    throw new Error('OpenAI returned an unreadable answer.');
  }
  return {
    activity: String(parsed.activity || 'Unknown activity').slice(0, 200),
    onTask: parsed.on_task !== false,
    confidence: Number(parsed.confidence) || 0
  };
}

module.exports = { analyze };
