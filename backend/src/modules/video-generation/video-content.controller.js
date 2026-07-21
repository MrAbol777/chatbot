const jwt = require('jsonwebtoken');
const { sanitizeFilename } = require('./storage/video-file-validator');
function parseRange(value, size) {
  if (!value) return null; const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim()); if (!match) return 'invalid';
  let start; let end; if (!match[1] && !match[2]) return 'invalid';
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'; start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'invalid'; end = Math.min(end, size - 1); }
  return { start, end };
}
function resolveContentCookieOwner(req, jwtSecret) {
  try {
    const token = req.cookies && typeof req.cookies.danao_video_content === 'string' ? req.cookies.danao_video_content : '';
    if (!token || !jwtSecret) return '';
    const payload = jwt.verify(token, jwtSecret);
    if (payload.purpose !== 'video-content' || String(payload.generationId || '') !== String(req.params?.generationId || '') || !payload.sub) return '';
    return String(payload.sub);
  } catch (_) { return ''; }
}
function createVideoContentController({ service, storage, jwtSecret }) {
  return async (req, res) => {
    let userId = String(req.user?.id || '');
    if (!userId && !req.videoAdmin) userId = resolveContentCookieOwner(req, jwtSecret);
    if (!userId && !req.videoAdmin) return res.status(401).json({ error: 'VIDEO_GENERATION_LOGIN_REQUIRED' });
    const job = req.videoAdmin ? await service.getForAdmin(req.params.generationId) : await service.get(req.params.generationId, userId);
    if (!job) return res.status(404).json({ error: 'VIDEO_GENERATION_NOT_FOUND' });
    if (job.status !== 'succeeded' || !job.result_storage_key) return res.status(409).json({ error: 'VIDEO_RESULT_NOT_READY' });
    let stat; try { stat = await storage.stat(job.result_storage_key); } catch (_) { return res.status(404).json({ error: 'VIDEO_RESULT_FILE_MISSING' }); }
    const range = parseRange(req.headers.range, stat.size); if (range === 'invalid') { res.setHeader('Content-Range', `bytes */${stat.size}`); return res.status(416).end(); }
    const download = String(req.query.download || '') === '1'; const filename = sanitizeFilename(job.result_original_filename, 'video.mp4');
    res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Type', job.result_mime_type || 'video/mp4'); res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`);
    if (range) { const length = range.end - range.start + 1; res.status(206); res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`); res.setHeader('Content-Length', length); if (req.method === 'HEAD') return res.end(); return storage.openReadStream(job.result_storage_key, { start: range.start, end: range.end }).on('error', () => res.destroy()).pipe(res); }
    res.status(200); res.setHeader('Content-Length', stat.size); if (req.method === 'HEAD') return res.end(); return storage.openReadStream(job.result_storage_key).on('error', () => res.destroy()).pipe(res);
  };
}
module.exports = { createVideoContentController, parseRange, resolveContentCookieOwner };
