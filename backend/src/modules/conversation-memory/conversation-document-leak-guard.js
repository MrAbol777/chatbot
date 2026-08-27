const DOCUMENT_TITLE = 'conversation document';
const STREAM_GUARD_MARKERS = [
  DOCUMENT_TITLE,
  'conversation objective',
  'user requirements',
  'last exchange',
  'private internal context',
  'private-conversation-memory'
];
const STREAM_HOLDBACK_LENGTH = Math.max(...STREAM_GUARD_MARKERS.map((marker) => marker.length)) - 1;

const normalizeLeadingText = (value) =>
  String(value || '')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/^[#*_\s:>-]+/, '')
    .toLowerCase();

const isConversationDocumentLeak = (value) => {
  const text = String(value || '').replace(/^\uFEFF/, '').trim();
  if (!text) return false;

  const normalized = text.toLowerCase();
  if (STREAM_GUARD_MARKERS.some((marker) => normalized.includes(marker))) return true;

  const lead = normalizeLeadingText(text);
  if (lead.startsWith(DOCUMENT_TITLE)) return true;

  const hasDocumentHeading = /(?:^|\n)\s{0,3}#{1,6}\s+(?:\*{1,3}\s*)?conversation document\b/i.test(text);
  if (!hasDocumentHeading) return false;

  const requiredSections = [
    'Conversation ID',
    'Conversation Objective',
    'Current Topic',
    'User Requirements',
    'Current State',
    'Last Exchange'
  ];
  const matchedSections = requiredSections.filter((heading) =>
    new RegExp(`(?:^|\\n)\\s{0,3}#{1,6}\\s+${heading}\\b`, 'i').test(text)
  );
  return matchedSections.length >= 2;
};

const releaseSafeStreamText = (value) => {
  const text = String(value || '');
  if (isConversationDocumentLeak(text)) return { blocked: true, emit: '', hold: '' };
  if (text.length <= STREAM_HOLDBACK_LENGTH) return { blocked: false, emit: '', hold: text };
  return {
    blocked: false,
    emit: text.slice(0, -STREAM_HOLDBACK_LENGTH),
    hold: text.slice(-STREAM_HOLDBACK_LENGTH)
  };
};

const createConversationDocumentLeakError = () => {
  const error = new Error('INTERNAL_CONVERSATION_DOCUMENT_LEAK_BLOCKED');
  error.code = 'INTERNAL_CONVERSATION_DOCUMENT_LEAK_BLOCKED';
  return error;
};

module.exports = {
  createConversationDocumentLeakError,
  isConversationDocumentLeak,
  releaseSafeStreamText
};
