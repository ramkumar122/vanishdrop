const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');

const s3Config = {
  region: config.s3.region,
};

// Prefer the EC2 IAM role in production. Only inject static credentials when both are explicitly set.
if (config.s3.accessKeyId && config.s3.secretAccessKey) {
  s3Config.credentials = {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  };
}

const s3 = new S3Client(s3Config);

async function generateUploadUrl(storageKey, mimeType, fileSize) {
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: storageKey,
    ContentType: mimeType,
    ContentLength: fileSize,
  });

  const url = await getSignedUrl(s3, command, {
    expiresIn: config.limits.presignedUrlExpiry,
  });

  return url;
}

async function generateDownloadUrl(storageKey, fileName) {
  const { GetObjectCommand } = require('@aws-sdk/client-s3');

  const command = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: storageKey,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
  });

  const url = await getSignedUrl(s3, command, {
    expiresIn: config.limits.downloadUrlExpiry,
  });

  return url;
}

async function deleteObject(storageKey) {
  const command = new DeleteObjectCommand({
    Bucket: config.s3.bucket,
    Key: storageKey,
  });

  await s3.send(command);
}

async function headObject(storageKey) {
  try {
    const command = new HeadObjectCommand({
      Bucket: config.s3.bucket,
      Key: storageKey,
    });
    await s3.send(command);
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

module.exports = { generateUploadUrl, generateDownloadUrl, deleteObject, headObject };
