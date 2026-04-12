const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');

// Browsers can technically single-PUT files up to S3's 5GB limit, but large
// uploads are much more reliable when we switch to multipart well before that.
const MAX_SINGLE_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB
const MULTIPART_PART_SIZE = 64 * 1024 * 1024; // 64MB

const s3Config = {
  region: config.s3.region,
};

// Prefer the EC2 IAM role in production. Only inject static credentials when both are explicitly set.
if (config.s3.accessKeyId && config.s3.secretAccessKey) {
  s3Config.credentials = {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
    ...(config.s3.sessionToken && { sessionToken: config.s3.sessionToken }),
  };
}

const s3 = new S3Client(s3Config);

async function generateUploadUrl(storageKey, mimeType, fileSize) {
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: storageKey,
    ContentType: mimeType,
  });

  const url = await getSignedUrl(s3, command, {
    expiresIn: config.limits.presignedUrlExpiry,
  });

  return url;
}

async function createMultipartUploadPlan(storageKey, mimeType, fileSize) {
  const multipart = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: config.s3.bucket,
      Key: storageKey,
      ContentType: mimeType,
    })
  );

  const uploadId = multipart.UploadId;
  const partCount = Math.max(1, Math.ceil(fileSize / MULTIPART_PART_SIZE));
  const partUrls = await Promise.all(
    Array.from({ length: partCount }, async (_, index) => {
      const partNumber = index + 1;
      const command = new UploadPartCommand({
        Bucket: config.s3.bucket,
        Key: storageKey,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      return {
        partNumber,
        uploadUrl: await getSignedUrl(s3, command, {
          expiresIn: config.limits.presignedUrlExpiry,
        }),
      };
    })
  );

  return {
    partSize: MULTIPART_PART_SIZE,
    partUrls,
    uploadId,
    uploadType: 'multipart',
  };
}

async function completeMultipartUpload(storageKey, uploadId, parts) {
  const sortedParts = [...parts]
    .map((part) => ({
      ETag: part.ETag,
      PartNumber: Number(part.PartNumber),
    }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.s3.bucket,
      Key: storageKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts,
      },
    })
  );
}

async function generateDownloadUrl(storageKey, fileName) {
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

async function getObjectStream(storageKey) {
  const command = new GetObjectCommand({
    Bucket: config.s3.bucket,
    Key: storageKey,
  });

  const response = await s3.send(command);
  return {
    body: response.Body,
    contentLength: response.ContentLength,
    contentType: response.ContentType,
    lastModified: response.LastModified,
  };
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

module.exports = {
  MAX_SINGLE_UPLOAD_SIZE,
  MULTIPART_PART_SIZE,
  generateUploadUrl,
  createMultipartUploadPlan,
  completeMultipartUpload,
  generateDownloadUrl,
  getObjectStream,
  deleteObject,
  headObject,
};
