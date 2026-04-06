const rateLimit = require('express-rate-limit');
const config = require('../config');

const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.limits.uploadRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: `Rate limit exceeded. Maximum ${config.limits.uploadRateLimit} uploads per hour.`,
  },
  keyGenerator: (req) => req.ip,
});

module.exports = { uploadRateLimit };
