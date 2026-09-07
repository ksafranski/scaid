import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    'Missing MONGODB_URI. Copy .env.example to .env.local and set it (e.g. "mongodb://localhost:27017").',
  );
}

const globalForMongo = globalThis as typeof globalThis & {
  _scaidMongoClient?: Promise<MongoClient>;
  _scaidMongoIndexes?: Promise<void>;
};

/**
 * Connects once and reuses the pool — including across dev hot reloads, which would
 * otherwise leak a connection per edit.
 *
 * A *failed* connection is deliberately not cached: if Mongo happens to be down when the
 * first request lands, caching the rejected promise would keep the app broken until a
 * restart. Clearing it lets the next request try again.
 */
function getClient(): Promise<MongoClient> {
  globalForMongo._scaidMongoClient ??= new MongoClient(uri!, {
    serverSelectionTimeoutMS: 8000,
  })
    .connect()
    .catch((error: unknown) => {
      globalForMongo._scaidMongoClient = undefined;
      throw error;
    });

  return globalForMongo._scaidMongoClient;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  const db = client.db(process.env.MONGODB_DB || "scaid");

  // Same reasoning as above — a failed index build must not be cached as "done".
  globalForMongo._scaidMongoIndexes ??= Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("creations").createIndex({ userId: 1, updatedAt: -1 }),
  ])
    .then(() => undefined)
    .catch((error: unknown) => {
      globalForMongo._scaidMongoIndexes = undefined;
      throw error;
    });

  await globalForMongo._scaidMongoIndexes;
  return db;
}
