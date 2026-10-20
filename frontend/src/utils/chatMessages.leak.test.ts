import { describe, expect, it } from 'vitest';
import { getConversationPreview, getDisplayContent, INTERNAL_DOCUMENT_NOTICE, isInternalDocumentLeak } from './chatMessages';
import type { Conversation } from '../types';

const LEAK = '{ "Conversation ID": "x", "Conversation Objective": "y", "Current Topic": "z", "Last Exchange": "q" }';

describe('internal conversation document leak', () => {
  it('recognises the pasted memory document but not ordinary answers', () => {
    expect(isInternalDocumentLeak(LEAK)).toBe(true);
    expect(isInternalDocumentLeak('Your user requirements are listed below, and the last exchange was short.')).toBe(false);
    expect(isInternalDocumentLeak('آسمان آبی است چون نور آبی بیشتر پخش می‌شود.')).toBe(false);
    expect(isInternalDocumentLeak(undefined)).toBe(false);
  });

  it('replaces only assistant replies, and only for display', () => {
    const message = { role: 'assistant' as const, content: LEAK };
    expect(getDisplayContent(message)).toBe(INTERNAL_DOCUMENT_NOTICE);
    expect(message.content).toBe(LEAK);
    expect(getDisplayContent({ role: 'user', content: LEAK })).toBe(LEAK);
  });

  it('uses the notice, not the raw document, as the sidebar preview', () => {
    const conversation = {
      id: 'c1',
      title: 't',
      createdAt: '',
      updatedAt: '',
      messages: [
        { role: 'user', content: 'سلام', timestamp: '' },
        { role: 'assistant', content: LEAK, timestamp: '' }
      ]
    } as unknown as Conversation;
    expect(getConversationPreview(conversation)).toBe(INTERNAL_DOCUMENT_NOTICE);
  });
});
