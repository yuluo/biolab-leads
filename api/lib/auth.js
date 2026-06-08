// Auth middleware: every request must carry an Apollo key and an email that is
// on the allowlist (DynamoDB). Self-asserted email — a gate, not cryptographic auth.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.AUTHORIZED_EMAILS_TABLE;

// Returns { ok: true, email, apiKey } or { ok: false, status, error }.
async function authorize(event) {
  const headers = event.headers || {};
  const apiKey = headers['x-apollo-key'];
  const email = String(headers['x-user-email'] || '').trim().toLowerCase();

  if (!apiKey) return { ok: false, status: 401, error: 'X-Apollo-Key header is required' };
  if (!email) return { ok: false, status: 401, error: 'X-User-Email header is required' };

  const res = await doc.send(new GetCommand({ TableName: TABLE, Key: { email } }));
  if (!res.Item || res.Item.status === 'revoked') {
    return { ok: false, status: 403, error: 'email is not authorized to use this API' };
  }
  return { ok: true, email, apiKey };
}

module.exports = { authorize };
