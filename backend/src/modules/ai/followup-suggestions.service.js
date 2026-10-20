const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_LENGTH = 42;
const MIN_REPLY_LENGTH = 40;
const CACHE_LIMIT = 200;
const USER_WINDOW_MS = 60 * 1000;
const USER_MAX_PER_WINDOW = 20;

const FOLLOWUP_SYSTEM_PROMPT = `تو بخش «پیشنهاد ادامه گفتگو» در دانوآ هستی؛ یک چت‌بات فارسی برای بچه‌های ۷ تا ۱۳ ساله.
با توجه به آخرین پرسش و پاسخ، دقیقاً ${MAX_SUGGESTIONS} پیشنهاد کوتاه بنویس که کاربر بتواند با یک لمس بفرستد.

قوانین:
* هر پیشنهاد جمله‌ای است که خودِ کاربر می‌نویسد (لحن اول‌شخص یا درخواست)، حداکثر ۶ کلمه.
* پیشنهادها باید به موضوع همین گفتگو مربوط، متفاوت از هم، جذاب و مناسب سن کاربر باشند.
* اگر موضوع داستان، ایده، شخصیت یا منظره است، یکی از پیشنهادها می‌تواند ساخت تصویر آن باشد؛ مثلاً «یه تصویرش رو بساز».
* اگر گفتگو درباره‌ی احساس بد، ترس، ناراحتی، خودآسیبی، خشونت یا هر موضوع حساس است، یا پاسخ یک امتناع ایمنی است، هیچ پیشنهادی نده.
* سؤال‌های ترسناک، بزرگسالانه یا نامناسب پیشنهاد نکن.
* ایموجی نگذار و فارسی ساده بنویس.

خروجی فقط یک JSON معتبر باشد، بدون هیچ مقدمه یا توضیح یا code fence، با این شکل:
{"suggestions": ["...", "...", "..."]}
اگر پیشنهاد مناسبی نیست: {"suggestions": []}`;

const clip = (value, max) => {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const LINE_BULLET = /^\s*(?:[-*•]|\d+[.)\-]|[۰-۹]+[.)\-])\s*/;

const extractCandidates = (raw) => {
  const text = String(raw || '').replace(/```(?:json)?/gi, '').trim();
  // Models often add a preamble ("Here is the JSON:") or fences around the object.
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (Array.isArray(parsed?.suggestions)) return parsed.suggestions;
    } catch (_error) {
      // fall through to the line-based reading below
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LINE_BULLET, '').replace(/^["'«“]|["'»”,،]+$/g, '').trim())
    // Drop preamble/JSON scaffolding: anything Latin, a label ending in ":", or braces.
    .filter((line) => line && !/[A-Za-z{}\[\]:]/.test(line));
};

const parseSuggestions = (raw) => {
  const seen = new Set();
  const result = [];
  for (const item of extractCandidates(raw)) {
    if (typeof item !== 'string') continue;
    const clean = item.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > MAX_SUGGESTION_LENGTH || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
    if (result.length >= MAX_SUGGESTIONS) break;
  }
  return result;
};

function createFollowupSuggestionsService({ aiService, chatTurnsRepository, usersRepository, logger = console }) {
  const cache = new Map();
  const userHits = new Map();

  const remember = (turnId, suggestions) => {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(turnId, suggestions);
  };

  const allowUser = (userId) => {
    const now = Date.now();
    const hits = (userHits.get(userId) || []).filter((time) => now - time < USER_WINDOW_MS);
    if (hits.length >= USER_MAX_PER_WINDOW) {
      userHits.set(userId, hits);
      return false;
    }
    hits.push(now);
    userHits.set(userId, hits);
    return true;
  };

  // Text comes from the stored turn, never from the client, so a caller can
  // only generate suggestions for their own completed conversation turns.
  const suggestForTurn = async ({ userId, turnId, requestId }) => {
    const owner = String(userId || '').trim();
    const id = String(turnId || '').trim();
    if (!owner || !id) throw Object.assign(new Error('INVALID_TURN_ID'), { code: 'INVALID_TURN_ID' });

    const turn = await chatTurnsRepository.getTurn(id);
    if (!turn || String(turn.user_id) !== owner) throw Object.assign(new Error('TURN_NOT_FOUND'), { code: 'TURN_NOT_FOUND' });
    if (turn.status !== 'completed' || turn.intent !== 'chat') return [];
    const reply = String(turn.reply || '').trim();
    if (reply.length < MIN_REPLY_LENGTH) return [];

    // Regenerate reuses the turn id, so the cache key must change with the reply.
    const cacheKey = `${id}:${reply.length}:${reply.slice(0, 24)}:${reply.slice(-24)}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    if (!allowUser(owner)) throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });

    const user = await usersRepository.findUserById(owner).catch(() => null);
    const age = Number(user?.age) > 0 ? Number(user.age) : 10;

    try {
      const result = await aiService.callOpenAI(
        [
          { role: 'system', content: FOLLOWUP_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `سن کاربر: ${age}\n\nپرسش کاربر:\n${clip(turn.user_message, 600)}\n\nپاسخ دانوآ:\n${clip(reply, 1500)}`
          }
        ],
        { requestId, timeoutMs: 15000, maxOutputTokens: 1024, responseFormat: 'json_object' }
      );
      const suggestions = parseSuggestions(result?.reply);
      if (suggestions.length === 0) {
        // Empty is legitimate for sensitive topics, but also the symptom of a malformed model reply.
        logger.info?.('[followups] no suggestions', { requestId, rawReply: String(result?.reply || '').slice(0, 300) });
      }
      remember(cacheKey, suggestions);
      return suggestions;
    } catch (error) {
      logger.warn?.('[followups] generation failed', { requestId, message: error instanceof Error ? error.message : String(error) });
      return [];
    }
  };

  return { suggestForTurn, parseSuggestions };
}

module.exports = { createFollowupSuggestionsService, parseSuggestions };
