import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const envCandidates = [
  path.join(repoRoot, '.env'),
  path.join(repoRoot, 'server/.env'),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

if (process.env.REDIS_TEST_URL) {
  process.env.REDIS_URL = process.env.REDIS_TEST_URL;
}

if (process.env.S3_TEST_BUCKET) {
  process.env.S3_BUCKET = process.env.S3_TEST_BUCKET;
}

if (process.env.S3_TEST_REGION) {
  process.env.S3_REGION = process.env.S3_TEST_REGION;
}

function getMissingInfraEnv() {
  const required = ['REDIS_URL', 'S3_BUCKET', 'S3_REGION'];
  return required.filter((key) => !process.env[key]);
}

export function assertInfraEnv() {
  const missing = getMissingInfraEnv();
  if (missing.length > 0) {
    throw new Error(
      `Missing required infra test env: ${missing.join(', ')}. Set REDIS_URL/S3_BUCKET directly or provide REDIS_TEST_URL/S3_TEST_BUCKET/S3_TEST_REGION before running npm run test:infra.`
    );
  }
}
