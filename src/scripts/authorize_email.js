#!/usr/bin/env node
// Manage the API allowlist (DynamoDB). Self-asserted emails authorized to call the API.
//
// Usage:
//   npm run authorize-email -- add <email> [--name "N"] [--company "C"] [--note "..."]
//   npm run authorize-email -- remove <email>
//   npm run authorize-email -- list
//
// Table name from `terraform output -raw authorized_emails_table_name` or env
// AUTHORIZED_EMAILS_TABLE. Region from AWS_REGION, defaults to us-east-1.

const path = require('path');
const { execFileSync } = require('child_process');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, PutCommand, DeleteCommand, ScanCommand,
} = require('@aws-sdk/lib-dynamodb');

const ROOT = path.resolve(__dirname, '..', '..');
const TF_DIR = path.join(ROOT, 'terraform');
const REGION = process.env.AWS_REGION || 'us-east-1';

function resolveTableName() {
  if (process.env.AUTHORIZED_EMAILS_TABLE) return process.env.AUTHORIZED_EMAILS_TABLE;
  try {
    return execFileSync('terraform', [`-chdir=${TF_DIR}`, 'output', '-raw', 'authorized_emails_table_name'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    console.error('Could not read authorized_emails_table_name from terraform output. ' +
      'Set AUTHORIZED_EMAILS_TABLE or apply terraform first.');
    process.exit(1);
  }
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { out[args[i].slice(2)] = args[i + 1]; i++; }
  }
  return out;
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const table = resolveTableName();
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

  if (cmd === 'add') {
    const email = normEmail(rest[0]);
    if (!email || !email.includes('@')) { console.error('usage: add <email> [--name ..] [--company ..] [--note ..]'); process.exit(2); }
    const flags = parseFlags(rest.slice(1));
    const item = { email, status: 'active', authorized_at: new Date().toISOString() };
    if (flags.name) item.name = flags.name;
    if (flags.company) item.company = flags.company;
    if (flags.note) item.note = flags.note;
    await doc.send(new PutCommand({ TableName: table, Item: item }));
    console.log(`authorized: ${email}`);
    return;
  }

  if (cmd === 'remove') {
    const email = normEmail(rest[0]);
    if (!email) { console.error('usage: remove <email>'); process.exit(2); }
    await doc.send(new DeleteCommand({ TableName: table, Key: { email } }));
    console.log(`removed: ${email}`);
    return;
  }

  if (cmd === 'list') {
    const res = await doc.send(new ScanCommand({ TableName: table }));
    const items = (res.Items || []).sort((a, b) => String(a.email).localeCompare(b.email));
    if (!items.length) { console.log('(no authorized emails)'); return; }
    for (const it of items) {
      console.log(`${it.email}\t${it.status || 'active'}\t${it.authorized_at || ''}\t${it.company || ''}`);
    }
    console.log(`\n${items.length} authorized email(s) in ${table}`);
    return;
  }

  console.error('usage: authorize-email <add|remove|list> ...');
  process.exit(2);
}

main().catch((e) => { console.error('authorize-email failed:', e.message); process.exit(1); });
