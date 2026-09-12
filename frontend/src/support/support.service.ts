export type SupportCategory = 'technical' | 'account' | 'billing' | 'suggestion' | 'other';
export type SupportStatus = 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';

export type SupportMessage = {
  id: string;
  authorType: 'user' | 'admin' | 'system';
  authorName: string;
  body: string;
  isInternal?: boolean;
  createdAt: string;
};

export type SupportTicket = {
  id: string;
  code: string;
  userId?: string;
  userName?: string | null;
  userPhone?: string | null;
  userAge?: number | null;
  subject: string;
  category: SupportCategory;
  priority: 'normal' | 'high' | 'urgent';
  status: SupportStatus;
  assignedAdminUsername?: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  context?: Record<string, unknown> | string | null;
  messages: SupportMessage[];
};

type ApiResponse = { item?: SupportTicket; items?: SupportTicket[]; message?: string; error?: string };

function authHeaders(): HeadersInit {
  try {
    const token = localStorage.getItem('chat_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request(path: string, init: RequestInit = {}): Promise<ApiResponse> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init.headers || {}) }
  });
  const payload = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok) throw new Error(payload.message || payload.error || 'ارتباط با مرکز پشتیبانی برقرار نشد.');
  return payload;
}

export async function listSupportTickets() {
  const result = await request('/api/support');
  return result.items || [];
}

export async function getSupportTicket(id: string) {
  const result = await request(`/api/support/${encodeURIComponent(id)}`);
  if (!result.item) throw new Error('درخواست پیدا نشد.');
  return result.item;
}

export async function createSupportTicket(input: { subject: string; category: SupportCategory; message: string; context?: Record<string, unknown> }) {
  const result = await request('/api/support', { method: 'POST', body: JSON.stringify(input) });
  if (!result.item) throw new Error('درخواست ثبت نشد.');
  return result.item;
}

export async function sendSupportMessage(id: string, body: string) {
  const result = await request(`/api/support/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
  if (!result.item) throw new Error('پیام ارسال نشد.');
  return result.item;
}

export const supportCategoryLabels: Record<SupportCategory, string> = {
  technical: 'خطای فنی', account: 'حساب کاربری', billing: 'اعتبار و پرداخت', suggestion: 'پیشنهاد', other: 'موضوع دیگر'
};

export const supportStatusLabels: Record<SupportStatus, string> = {
  open: 'در انتظار بررسی', in_progress: 'در حال بررسی', waiting_user: 'منتظر پاسخ شما', resolved: 'حل‌شده', closed: 'بسته‌شده'
};
