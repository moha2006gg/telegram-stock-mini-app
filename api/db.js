const { MongoClient } = require('mongodb');

let client;
let db;

async function connect() {
  if (db) return db;
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');
  client = new MongoClient(uri, { useUnifiedTopology: true });
  await client.connect();
  db = client.db(process.env.MONGO_DBNAME || 'stockdb');
  // Ensure indexes
  await db.collection('items').createIndex({ sku: 1 }, { unique: true, sparse: true });
  await db.collection('warehouses').createIndex({ name: 1 }, { unique: true });
  return db;
}

module.exports = { connect };
