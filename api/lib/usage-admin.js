// Read side of the usage log, used only by the GET /admin/usage route.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.USAGE_TABLE;

function clampLimit(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(n, 1), 1000);
}

// Fetch raw usage events per the query params.
async function queryUsage({ email, day, since, until, limit }) {
  const lim = clampLimit(limit);

  if (email) {
    const expr = ['email = :e'];
    const vals = { ':e': String(email).trim().toLowerCase() };
    if (since) { expr.push('sk >= :since'); vals[':since'] = String(since); }
    if (until) { expr.push('sk <= :until'); vals[':until'] = String(until); }
    const res = await doc.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: expr.join(' AND '),
      ExpressionAttributeValues: vals,
      ScanIndexForward: false,
      Limit: lim,
    }));
    return res.Items || [];
  }

  if (day) {
    const res = await doc.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'by_day',
      KeyConditionExpression: '#d = :d',
      ExpressionAttributeNames: { '#d': 'day' },
      ExpressionAttributeValues: { ':d': String(day) },
      ScanIndexForward: false,
      Limit: lim,
    }));
    return res.Items || [];
  }

  // No account/day filter: bounded scan of the whole log, newest first.
  const res = await doc.send(new ScanCommand({ TableName: TABLE, Limit: lim }));
  const items = res.Items || [];
  items.sort((a, b) => (b.ts_epoch || 0) - (a.ts_epoch || 0));
  return items.slice(0, lim);
}

// Roll events up into per-account and per-endpoint totals.
function summarize(events) {
  const byAccount = {};
  const byEndpoint = {};
  let apolloCalls = 0;
  for (const e of events) {
    const acct = (byAccount[e.email] ||= { requests: 0, apollo_calls: 0, endpoints: {} });
    acct.requests += 1;
    acct.endpoints[e.endpoint] = (acct.endpoints[e.endpoint] || 0) + 1;
    byEndpoint[e.endpoint] = (byEndpoint[e.endpoint] || 0) + 1;
    if (typeof e.apollo_calls === 'number') {
      acct.apollo_calls += e.apollo_calls;
      apolloCalls += e.apollo_calls;
    }
  }
  return { total_events: events.length, apollo_calls: apolloCalls, by_account: byAccount, by_endpoint: byEndpoint };
}

module.exports = { queryUsage, summarize };
