const jwt = require('jsonwebtoken');

function createVideoContentAuthController({ service, jwtSecret }) {
  return async (req, res) => {
    const userId = String(req.user?.id || '');
    if (!userId) return res.status(401).json({ error: 'VIDEO_GENERATION_LOGIN_REQUIRED' });
    const generationId = String(req.params.generationId || '');
    const job = await service.get(generationId, userId);
    if (!job) return res.status(404).json({ error: 'VIDEO_GENERATION_NOT_FOUND' });
    if (job.status !== 'succeeded' || !job.result) return res.status(409).json({ error: 'VIDEO_RESULT_NOT_READY' });
    const token = jwt.sign({ sub: userId, generationId, purpose: 'video-content' }, jwtSecret, { expiresIn: '5m' });
    const contentPath = `/api/video-generations/${encodeURIComponent(generationId)}/content`;
    res.cookie('danoa_video_content', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 5 * 60 * 1000,
      path: contentPath
    });
    return res.json({ contentUrl: contentPath, downloadUrl: `${contentPath}?download=1` });
  };
}

module.exports = { createVideoContentAuthController };
