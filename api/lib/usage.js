const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.USAGE_TABLE;
const TTL_DAYS = 90;

function prune(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(prune);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = typeof v === 'object' ? prune(v) : v;
  }
  return out;
}

async function recordUsage({ email, method, path, detail, requestId, tsMs }) {
  if (!TABLE) return;
  const ms = tsMs || Date.now();
  const iso = new Date(ms).toISOString();
  const item = {
    email,
    sk: `${iso}#${requestId || ms}`,
    day: iso.slice(0, 10),
    ts: iso,
    ts_epoch: ms,
    endpoint: `${method} ${path}`,
    ttl: Math.floor(ms / 1000) + TTL_DAYS * 86400,
    ...prune(detail || {}),
  };
  await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
}

// Never let a usage-write failure break the user's request.
async function safeRecordUsage(args) {
  try {
    await recordUsage(args);
  } catch (err) {
    console.error('usage record failed:', err.message);
  }
}

module.exports = { recordUsage, safeRecordUsage };
