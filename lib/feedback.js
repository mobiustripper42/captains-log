import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';

const execFile = promisify(execFileCb);

const COLUMNS = [
  'submitted_by_chat_id',
  'body',
  'drafted_issue_body',
  'github_issue_url',
  'status',
];

const REQUIRED = ['submitted_by_chat_id', 'body'];

export function createPending(db, { chatId, body, draftedTitle, draftedBody }) {
  if (!chatId || !body) {
    throw new Error('feedback.createPending: chatId and body are required');
  }
  // drafted_issue_body stores "<title>\n\n<body>" — keeps the schema simple
  // (no extra column needed), since title + body are always presented together.
  const drafted = draftedTitle && draftedBody ? `${draftedTitle}\n\n${draftedBody}` : null;
  const fields = {
    submitted_by_chat_id: String(chatId),
    body,
    drafted_issue_body: drafted,
    github_issue_url: null,
    status: 'pending',
  };
  for (const k of REQUIRED) {
    if (fields[k] == null) throw new Error(`feedback.createPending: missing ${k}`);
  }
  const cols = COLUMNS.filter((c) => fields[c] !== undefined);
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map((c) => fields[c]);
  const sql = `INSERT INTO feedback (${cols.join(', ')}) VALUES (${placeholders})`;
  const { lastInsertRowid } = db.prepare(sql).run(...values);
  return { id: Number(lastInsertRowid) };
}

export function findLatestPending(db, chatId) {
  return (
    db
      .prepare(
        "SELECT * FROM feedback WHERE submitted_by_chat_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(String(chatId)) ?? null
  );
}

export function findById(db, id) {
  return db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) ?? null;
}

export function markFiled(db, id, githubIssueUrl) {
  db.prepare("UPDATE feedback SET status = 'filed', github_issue_url = ? WHERE id = ?").run(
    githubIssueUrl,
    id,
  );
}

export function markCancelled(db, id) {
  db.prepare("UPDATE feedback SET status = 'cancelled' WHERE id = ?").run(id);
}

const DRAFT_SYSTEM_PROMPT = `You are drafting a GitHub issue for Captain's Log — a Telegram bot that lets Brewboat captains log boat trips by free-form text message. The owner (Eric) is filing feedback from the field, usually via Telegram.

Return a JSON object with exactly these fields:
{
  "title": "<short imperative title, under 80 chars>",
  "body": "<markdown issue body — include a brief description, and if it's a bug: repro + expected/actual; if a feature: motivation + acceptance criteria>"
}

Keep it concise and actionable. Don't add boilerplate sections that aren't needed. Return ONLY the JSON object — no explanation, no markdown fences.`;

let anthropicClient = null;
function getClient() {
  if (!anthropicClient) anthropicClient = new Anthropic();
  return anthropicClient;
}

export async function draftFeedback(observationText) {
  if (process.env.CAPTAINSLOG_NO_HAIKU === '1') {
    return {
      title: `Feedback: ${observationText.slice(0, 60)}`,
      body: `From the field: ${observationText}`,
    };
  }
  const response = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [{ type: 'text', text: DRAFT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: observationText }],
  });
  // Find the first text block — guards against future block types
  // (thinking, tool_use, etc.) landing at index 0.
  const raw = response.content.find((b) => b.type === 'text')?.text ?? '';
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    const { title, body } = JSON.parse(text);
    if (!title || !body) throw new Error('missing title/body');
    return { title, body };
  } catch (err) {
    console.error('[feedback] draft parse failed:', raw.slice(0, 200));
    throw new Error(`draftFeedback: could not parse Haiku response (${err.message})`);
  }
}

function resolveRepo() {
  return process.env.CAPTAINSLOG_FEEDBACK_REPO ?? 'mobiustripper42/captains-log';
}

export async function fileViaGh({ title, body }) {
  if (process.env.CAPTAINSLOG_NO_GH_FILE === '1') {
    return { url: 'https://github.com/example/example/issues/0' };
  }
  const repo = resolveRepo();
  const { stdout } = await execFile(
    'gh',
    ['issue', 'create', '--repo', repo, '--title', title, '--body', body],
    // Bound the gh call so an auth-prompt hang doesn't strand a child process.
    { timeout: 15_000 },
  );
  // gh sometimes prints a preamble ("Creating issue in owner/repo") before the
  // URL — extract by pattern rather than relying on token position.
  const match = stdout.match(/https:\/\/github\.com\/\S+?\/issues\/\d+/);
  const url = match?.[0];
  if (!url) {
    throw new Error(`fileViaGh: unexpected gh output: ${stdout.slice(0, 200)}`);
  }
  return { url };
}
