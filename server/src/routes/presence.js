const express = require('express');
const { cleanupSession } = require('../services/cleanup');
const { getSession, markSessionCloseRequested } = require('../services/redis');

const router = express.Router();

router.post('/close', async (req, res) => {
  const sessionId = req.body?.sessionId;

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return res.status(204).end();
    }

    await markSessionCloseRequested(sessionId);

    if (session.connectedTabs <= 0) {
      await cleanupSession(sessionId);
      return res.status(202).json({ status: 'closed' });
    }

    return res.status(202).json({ status: 'marked' });
  } catch (err) {
    console.error('[Presence] Error handling explicit close:', err);
    return res.status(500).json({ error: 'Failed to close session' });
  }
});

module.exports = router;
