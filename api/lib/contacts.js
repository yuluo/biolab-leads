// Read/write the retained contacts cache in DynamoDB (PK ein, SK contact_email).

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CONTACTS_TABLE;

async function getContacts(ein) {
  const res = await doc.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'ein = :e',
    ExpressionAttributeValues: { ':e': String(ein) },
  }));
  return res.Items || [];
}

function toItem(r) {
  const item = { ein: String(r.ein), contact_email: String(r.contact_email) };
  for (const f of ['contact_name', 'contact_title', 'contact_linkedin', 'org_domain', 'enriched_at']) {
    if (r[f] != null && r[f] !== '') item[f] = String(r[f]);
  }
  if (r.match_confidence != null) item.match_confidence = Number(r.match_confidence);
  return item;
}

async function putContacts(records) {
  const valid = records.filter((r) => r.ein && r.contact_email);
  for (let i = 0; i < valid.length; i += 25) {
    let requestItems = {
      [TABLE]: valid.slice(i, i + 25).map((r) => ({ PutRequest: { Item: toItem(r) } })),
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await doc.send(new BatchWriteCommand({ RequestItems: requestItems }));
      const unprocessed = res.UnprocessedItems && res.UnprocessedItems[TABLE];
      if (!unprocessed || unprocessed.length === 0) break;
      requestItems = res.UnprocessedItems;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
}

module.exports = { getContacts, putContacts };
