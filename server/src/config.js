require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  s3: {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },

  limits: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10737418240', 10),
    uploadRateLimit: parseInt(process.env.UPLOAD_RATE_LIMIT || '100', 10),
    sessionGracePeriod: parseInt(process.env.SESSION_GRACE_PERIOD || '30', 10),
    presignedUrlExpiry: parseInt(process.env.PRESIGNED_URL_EXPIRY || '3600', 10),
    downloadUrlExpiry: parseInt(process.env.DOWNLOAD_URL_EXPIRY || '300', 10),
  },
};
