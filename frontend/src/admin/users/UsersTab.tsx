import { useEffect, useMemo, useState } from 'react';
import { Button, FieldGroup, InlineMessage, TextField, useNotification } from '../../design-system/components';
import type { AdminIdentity, ChatImage, ConversationMemoryPayload, ProfileMessage, User, UserProfile, UsersPayload } from '../admin.types';
import { handleAdminResponse } from '../admin.types';

const USERS_PAGE_SIZE = 10;

const toAdminProfileImageUrl = (url: string, userId: string) => {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return '';
  const userPath = encodeURIComponent(userId);
  try {
    const parsed = new URL(raw, window.location.origin);
    const generatedMatch = parsed.pathname.match(/^\/api\/images\/(?:serve|result)\/([^/?#]+)/);
    if (generatedMatch) {
      return `/api/admin/users/${userPath}/images/${encodeURIComponent(decodeURIComponent(generatedMatch[1]))}`;
    }
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return raw;
  } catch {
    const generatedMatch = raw.match(/^\/api\/images\/(?:serve|result)\/([^/?#]+)/);
    if (generatedMatch) {
      return `/api/admin/users/${userPath}/images/${encodeURIComponent(decodeURIComponent(generatedMatch[1]))}`;
    }
    return raw;
  }
};

const getProfileMessageImages = (message: ProfileMessage, userId: string): ChatImage[] => {
  const candidates: ChatImage[] = [];
  if (Array.isArray(message.images)) {
    message.images.forEach((image) => {
      if (image?.url) candidates.push(image);
    });
  }
  if (message.imageUrl) candidates.push({ url: message.imageUrl, alt: message.content || 'تصویر گفتگو' });
  if (message.resultUrl) candidates.push({ url: message.resultUrl, alt: message.content || 'تصویر گفتگو' });

  const taskId = message.taskId || message.imageTaskId;
  if (taskId && (message.type === 'image_result' || message.status === 'COMPLETED')) {
    candidates.push({
      url: `/api/admin/users/${encodeURIComponent(userId)}/images/${encodeURIComponent(taskId)}`,
      alt: message.content || 'تصویر ساخته‌شده'
    });
  }

  const seen = new Set<string>();
  return candidates
    .map((image) => ({
      url: toAdminProfileImageUrl(image.url, userId),
      alt: image.alt || message.content || 'تصویر گفتگو'
    }))
    .filter((image) => {
      if (!image.url || seen.has(image.url)) return false;
      seen.add(image.url);
      return true;
    });
};

type UsersTabProps = {
  adminIdentity: AdminIdentity | null;
  selectedReportUserIds: string[];
  onSelectedReportUserIdsChange: (ids: string[]) => void;
};

export default function UsersTab({
  adminIdentity,
  selectedReportUserIds,
  onSelectedReportUserIdsChange
}: UsersTabProps) {
  const { notify, confirm } = useNotification();
  const [users, setUsers] = useState<User[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [query, setQuery] = useState('');
  const [banFilter, setBanFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  const [conversationMemory, setConversationMemory] = useState<Record<string, ConversationMemoryPayload>>({});
  const [conversationMemoryLoading, setConversationMemoryLoading] = useState<Record<string, boolean>>({});
  const [conversationMemoryMessage, setConversationMemoryMessage] = useState<Record<string, string>>({});

  const isSuperadmin = adminIdentity?.role === 'superadmin';
  const canBan = ['superadmin', 'admin', 'moderator'].includes(adminIdentity?.role || '');

  const loadUsers = async (page = usersPage) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (banFilter !== 'all') params.set('isBanned', banFilter);
    params.set('page', String(page));
    params.set('pageSize', String(USERS_PAGE_SIZE));

    try {
      const response = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری کاربران ناموفق بود.');
      if (!result.ok) return;
      const payload = (result.data || {}) as UsersPayload;
      setUsers(payload.items || []);
      setUsersTotal(Number(payload.total || 0));
      setUsersPage(Number(payload.page || page));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'اتصال به سرور برقرار نشد.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers(1);
  }, []);

  const handleApplyUserFilters = () => {
    void loadUsers(1);
  };

  const usersTotalPages = Math.max(1, Math.ceil(usersTotal / USERS_PAGE_SIZE));

  const isEveryVisibleUserSelected = useMemo(() => {
    if (users.length === 0) return false;
    return users.every((u) => selectedReportUserIds.includes(u.user_id));
  }, [users, selectedReportUserIds]);

  const toggleVisibleReportUsers = () => {
    if (isEveryVisibleUserSelected) {
      const visibleSet = new Set(users.map((u) => u.user_id));
      onSelectedReportUserIdsChange(selectedReportUserIds.filter((id) => !visibleSet.has(id)));
    } else {
      const merged = new Set([...selectedReportUserIds, ...users.map((u) => u.user_id)]);
      onSelectedReportUserIdsChange(Array.from(merged));
    }
  };

  const toggleReportUser = (userId: string) => {
    if (selectedReportUserIds.includes(userId)) {
      onSelectedReportUserIdsChange(selectedReportUserIds.filter((id) => id !== userId));
    } else {
      onSelectedReportUserIdsChange([...selectedReportUserIds, userId]);
    }
  };

  const openUser = async (userId: string) => {
    setActionError('');
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { credentials: 'include' });
      const result = await handleAdminResponse(response, 'بارگذاری اطلاعات کاربر ناموفق بود.');
      if (result.ok) {
        setSelectedUser(result.data as UserProfile);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'دریافت پروفایل کاربر ناموفق بود.');
    }
  };

  const toggleBan = async (user: User) => {
    setActionError('');
    const willBan = !user.isBanned;
    const allowed = await confirm({
      message: willBan ? `آیا از مسدودسازی کاربر "${user.name}" اطمینان دارید؟` : `آیا کاربر "${user.name}" رفع مسدودیت شود؟`,
      confirmText: willBan ? 'مسدودسازی' : 'رفع مسدودی',
      cancelText: 'انصراف',
      variant: willBan ? 'danger' : 'default'
    });
    if (!allowed) return;

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.user_id)}/ban`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isBanned: willBan })
      });
      const result = await handleAdminResponse(response, 'تغییر وضعیت مسدودسازی ناموفق بود.');
      if (result.ok) {
        notify.success(willBan ? 'کاربر با موفقیت مسدود شد.' : 'کاربر رفع مسدودیت شد.', { title: 'مدیریت کاربر' });
        await loadUsers(usersPage);
        if (selectedUser?.user_id === user.user_id) {
          setSelectedUser((prev) => (prev ? { ...prev, isBanned: willBan } : prev));
        }
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'تغییر وضعیت مسدودیت ناموفق بود.');
    }
  };

  const deleteUser = async (user: User) => {
    if (!isSuperadmin) {
      notify.error('فقط مدیر ارشد (Superadmin) امکان حذف کامل کاربر را دارد.', { title: 'عدم دسترسی' });
      return;
    }
    setActionError('');
    const allowed = await confirm({
      message: `آیا از حذف کامل کاربر "${user.name}" و تمام مکالمات آن اطمینان دارید؟ این عملیات غیرقابل بازگشت است.`,
      confirmText: 'حذف دائمی',
      cancelText: 'انصراف',
      variant: 'danger'
    });
    if (!allowed) return;

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.user_id)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      const result = await handleAdminResponse(response, 'حذف کاربر ناموفق بود.');
      if (result.ok) {
        notify.success('کاربر و سوابق گفتگو با موفقیت حذف شدند.', { title: 'حذف کاربر' });
        if (selectedUser?.user_id === user.user_id) {
          setSelectedUser(null);
        }
        await loadUsers(usersPage);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'حذف کاربر ناموفق بود.');
    }
  };

  const loadConversationMemory = async (conversationId: string) => {
    setConversationMemoryLoading((prev) => ({ ...prev, [conversationId]: true }));
    setConversationMemoryMessage((prev) => ({ ...prev, [conversationId]: '' }));
    try {
      const response = await fetch(`/api/admin/conversations/${encodeURIComponent(conversationId)}/memory`, {
        credentials: 'include'
      });
      const result = await handleAdminResponse(response, 'خواندن حافظه مکالمه ناموفق بود.');
      if (result.ok) {
        setConversationMemory((prev) => ({ ...prev, [conversationId]: result.data as ConversationMemoryPayload }));
      }
    } catch (err) {
      setConversationMemoryMessage((prev) => ({
        ...prev,
        [conversationId]: err instanceof Error ? err.message : 'اتصال به سرور برقرار نشد.'
      }));
    } finally {
      setConversationMemoryLoading((prev) => ({ ...prev, [conversationId]: false }));
    }
  };

  const runConversationMemoryAction = async (conversationId: string, action: 'reset' | 'rebuild') => {
    setConversationMemoryLoading((prev) => ({ ...prev, [conversationId]: true }));
    setConversationMemoryMessage((prev) => ({ ...prev, [conversationId]: '' }));
    try {
      const response = await fetch(`/api/admin/conversations/${encodeURIComponent(conversationId)}/memory/${action}`, {
        method: 'POST',
        credentials: 'include'
      });
      const result = await handleAdminResponse(
        response,
        action === 'reset' ? 'ریست حافظه ناموفق بود.' : 'بازسازی حافظه ناموفق بود.'
      );
      if (result.ok) {
        setConversationMemoryMessage((prev) => ({
          ...prev,
          [conversationId]: action === 'reset' ? 'حافظه ریست شد.' : 'حافظه بازسازی شد.'
        }));
        await loadConversationMemory(conversationId);
      }
    } catch (err) {
      setConversationMemoryMessage((prev) => ({
        ...prev,
        [conversationId]: err instanceof Error ? err.message : 'عملیات ناموفق بود.'
      }));
    } finally {
      setConversationMemoryLoading((prev) => ({ ...prev, [conversationId]: false }));
    }
  };

  return (
    <div className="admin-section">
      {error ? <InlineMessage text={error} variant="error" /> : null}
      {actionError ? <InlineMessage text={actionError} variant="error" /> : null}

      <div className="admin-controls">
        <TextField
          className="admin-control-field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجوی نام یا شماره"
          aria-label="جستجوی کاربر"
          fullWidth={false}
        />
        <select value={banFilter} onChange={(e) => setBanFilter(e.target.value)} aria-label="فیلتر وضعیت مسدودی">
          <option value="all">همه کاربران</option>
          <option value="false">فقط کاربران فعال</option>
          <option value="true">فقط کاربران مسدود</option>
        </select>
        <Button className="admin-action-btn" onClick={handleApplyUserFilters} disabled={loading}>
          اعمال فیلتر
        </Button>
      </div>

      <div className="admin-users-summary">
        <span>نمایش صفحه {usersPage} از {usersTotalPages}، مجموع {usersTotal} کاربر</span>
        <span>
          {selectedReportUserIds.length > 0
            ? `${selectedReportUserIds.length} کاربر برای گزارش انتخاب شده`
            : 'برای گزارش چندنفره، کاربران را از جدول انتخاب کنید.'}
        </span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={isEveryVisibleUserSelected}
                  onChange={toggleVisibleReportUsers}
                  aria-label="انتخاب همه کاربران این صفحه برای گزارش"
                />
              </th>
              <th>نام</th>
              <th>سن</th>
              <th>شماره تماس</th>
              <th>تاریخ عضویت</th>
              <th>گفتگوها</th>
              <th>آخرین فعالیت</th>
              <th>وضعیت</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.user_id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedReportUserIds.includes(user.user_id)}
                    onChange={() => toggleReportUser(user.user_id)}
                    aria-label={`انتخاب ${user.name} برای گزارش`}
                  />
                </td>
                <td><strong>{user.name}</strong></td>
                <td>{user.age}</td>
                <td>{user.phone || '-'}</td>
                <td>{user.registered_at || '-'}</td>
                <td>{user.conversationCount || 0}</td>
                <td>{user.last_activity || '-'}</td>
                <td>
                  {user.isBanned ? (
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>مسدود</span>
                  ) : (
                    <span style={{ color: '#10b981' }}>فعال</span>
                  )}
                </td>
                <td>
                  <FieldGroup direction="row" className="admin-row-actions">
                    <Button variant="ghost" size="sm" onClick={() => void openUser(user.user_id)}>
                      پروفایل
                    </Button>
                    {canBan ? (
                      <Button variant="secondary" size="sm" onClick={() => void toggleBan(user)}>
                        {user.isBanned ? 'رفع مسدود' : 'مسدود'}
                      </Button>
                    ) : null}
                    {isSuperadmin ? (
                      <Button variant="danger" size="sm" onClick={() => void deleteUser(user)}>
                        حذف
                      </Button>
                    ) : null}
                  </FieldGroup>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 ? (
              <tr>
                <td colSpan={9}>کاربری با این مشخصات یافت نشد.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="admin-pagination">
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || usersPage <= 1}
          onClick={() => void loadUsers(usersPage - 1)}
        >
          قبلی
        </Button>
        <span>صفحه {usersPage} / {usersTotalPages}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={loading || usersPage >= usersTotalPages}
          onClick={() => void loadUsers(usersPage + 1)}
        >
          بعدی
        </Button>
      </div>

      {selectedUser ? (
        <div className="profile-box" style={{ marginTop: '24px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0 }}>پروفایل کاربر: {selectedUser.name}</h3>
              <p className="admin-note" style={{ margin: '4px 0 0 0' }}>
                شناسه: {selectedUser.user_id} | سن: {selectedUser.age} | شماره: {selectedUser.phone || 'ثبت‌نشده'} | وضعیت: {selectedUser.isBanned ? 'مسدود' : 'فعال'}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedUser(null)}>بستن پروفایل</Button>
          </div>

          <div style={{ marginTop: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>گفتگوهای کاربر ({selectedUser.conversations?.length || 0})</h4>
            {(selectedUser.conversations || []).map((conv) => (
              <details key={conv.conversation_id} className="profile-conversation" style={{ marginBottom: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '12px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '4px 0' }}>
                  {conv.title || 'گفتگوی بدون عنوان'} — {conv.message_count} پیام
                </summary>

                <div className="admin-note" style={{ margin: '8px 0', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                  <strong>منبع عنوان:</strong> {conv.title_source || 'default'} | <strong>مدل:</strong> {conv.title_model || '-'} | <strong>زمان ساخت:</strong> {conv.title_generated_at || '-'}
                </div>

                <div className="conversation-memory-panel" style={{ margin: '12px 0', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                  <div className="admin-section-header" style={{ marginBottom: '8px' }}>
                    <div>
                      <h5 style={{ margin: 0 }}>حافظه مکالمه</h5>
                      <span className="admin-note" style={{ fontSize: '11px' }}>{conv.conversation_id}</span>
                    </div>
                    <FieldGroup direction="row" className="config-actions">
                      <Button variant="secondary" size="sm" disabled={Boolean(conversationMemoryLoading[conv.conversation_id])} onClick={() => void loadConversationMemory(conv.conversation_id)}>
                        بازخوانی
                      </Button>
                      <Button variant="ghost" size="sm" disabled={Boolean(conversationMemoryLoading[conv.conversation_id])} onClick={() => void runConversationMemoryAction(conv.conversation_id, 'reset')}>
                        ریست
                      </Button>
                      <Button variant="ghost" size="sm" disabled={Boolean(conversationMemoryLoading[conv.conversation_id])} onClick={() => void runConversationMemoryAction(conv.conversation_id, 'rebuild')}>
                        بازسازی
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => { window.location.href = `/api/admin/conversations/${encodeURIComponent(conv.conversation_id)}/memory/download`; }}>
                        دانلود
                      </Button>
                    </FieldGroup>
                  </div>

                  {conversationMemoryMessage[conv.conversation_id] ? (
                    <InlineMessage
                      text={conversationMemoryMessage[conv.conversation_id]}
                      variant={conversationMemoryMessage[conv.conversation_id].includes('شد') ? 'success' : 'error'}
                    />
                  ) : null}

                  {conversationMemory[conv.conversation_id] ? (
                    <div className="memory-document-box" style={{ marginTop: '8px' }}>
                      <p className="admin-note" style={{ fontSize: '12px' }}>
                        وضعیت: {conversationMemory[conv.conversation_id].metadata?.status || '-'} | نسخه: {conversationMemory[conv.conversation_id].metadata?.version ?? 0} | حجم: {conversationMemory[conv.conversation_id].sizeBytes ?? '-'} بایت
                      </p>
                      <textarea
                        className="system-prompt-textarea"
                        readOnly
                        rows={8}
                        value={conversationMemory[conv.conversation_id].content}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px', direction: 'ltr' }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="profile-messages" style={{ marginTop: '12px' }}>
                  {conv.messages.map((msg, index) => {
                    const images = getProfileMessageImages(msg, selectedUser.user_id);
                    return (
                      <article className={`profile-message profile-message--${msg.role}`} key={`${conv.conversation_id}-${index}`} style={{ marginBottom: '8px', padding: '8px 12px', borderRadius: '8px', background: msg.role === 'user' ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.05)' }}>
                        <div className="profile-message__meta" style={{ display: 'flex', gap: '8px', fontSize: '12px', marginBottom: '4px' }}>
                          <strong>{msg.role === 'user' ? selectedUser.name : 'دانوآ'}</strong>
                          {msg.timestamp ? <span className="admin-note">{msg.timestamp}</span> : null}
                          {msg.type && msg.type !== 'text' ? <span className="admin-note">({msg.type})</span> : null}
                        </div>
                        {msg.content ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{msg.content}</p> : null}
                        {images.length > 0 ? (
                          <div className="profile-message-images" style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            {images.map((image) => (
                              <a key={image.url} href={image.url} target="_blank" rel="noreferrer">
                                <img src={image.url} alt={image.alt || 'تصویر گفتگو'} loading="lazy" style={{ maxWidth: '120px', maxHeight: '120px', borderRadius: '6px' }} />
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {conv.messages.length === 0 ? <p className="admin-note">پیامی در این گفتگو نیست.</p> : null}
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
