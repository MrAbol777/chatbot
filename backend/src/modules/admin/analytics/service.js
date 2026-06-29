const REPORT_SECTIONS = [
  'users',
  'errors',
  'conversation_summary',
  'messages',
  'plans_usage',
  'guest_usage',
  'ai_performance'
];

const SECTION_LABELS = {
  users: 'Users',
  errors: 'Errors',
  conversation_summary: 'Conversation summary',
  messages: 'Messages',
  plans_usage: 'Plans usage',
  guest_usage: 'Guest usage',
  ai_performance: 'AI performance'
};

function createAdminAnalyticsService({
  analyticsRepository,
  getTotalUsers,
  getActiveUsersToday,
  getApiCallsToday,
  getErrorCountToday,
  getUserGrowth,
  getApiUsage,
  getErrorDistribution,
  getRecentAuditLogs,
  getStats,
  getPlanSubscriptions
}) {
  const getLegacyStats = async () => getStats();

  const getDashboardStats = async () => ({
    kpis: {
      totalUsers: await getTotalUsers(),
      activeUsersToday: await getActiveUsersToday(),
      apiCallsToday: await getApiCallsToday(),
      errorCountToday: await getErrorCountToday()
    },
    userGrowth: await getUserGrowth(7),
    apiUsage: await getApiUsage(7),
    errorDistribution: await getErrorDistribution(),
    recentActivities: getRecentAuditLogs(10)
  });

  const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const formatDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  };

  const normalizeUserIds = (value) => {
    const rawItems = Array.isArray(value) ? value : String(value || '').split(',');
    return new Set(rawItems.map((item) => String(item || '').trim()).filter(Boolean));
  };

  const parseDateBoundary = (value, endOfDay = false) => {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const date = dateOnly ? new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`) : new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const normalizeDateRange = ({ fromDate, toDate } = {}) => {
    let from = parseDateBoundary(fromDate, false);
    let to = parseDateBoundary(toDate, true);
    if (from && to && from.getTime() > to.getTime()) {
      [from, to] = [to, from];
    }
    return { from, to };
  };

  const isInDateRange = (value, range) => {
    if (!value) return !range.from && !range.to;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return false;
    if (range.from && time < range.from.getTime()) return false;
    if (range.to && time > range.to.getTime()) return false;
    return true;
  };

  const isUsageDateInRange = (value, range) => {
    if (!value) return !range.from && !range.to;
    const text = String(value).slice(0, 10);
    return isInDateRange(`${text}T12:00:00.000`, range);
  };

  const normalizeSections = ({ sections, users, errors, conversations, messages } = {}) => {
    const requested = String(sections || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const selected = requested.length > 0 ? requested : [
      users === '1' ? 'users' : '',
      errors === '1' ? 'errors' : '',
      conversations === '1' ? 'conversation_summary' : '',
      messages === '1' ? 'messages' : ''
    ].filter(Boolean);

    return selected.filter((item, index) => REPORT_SECTIONS.includes(item) && selected.indexOf(item) === index);
  };

  const normalizeFormat = (format) => {
    const value = String(format || 'csv').trim().toLowerCase();
    return value === 'txt' ? 'txt' : 'csv';
  };

  const looksAmbiguous = (content) => {
    const text = String(content || '').trim().toLowerCase();
    return ['چرا', 'چی', 'نه'].includes(text) || text.length <= 3;
  };

  const pairMessageTurns = (messages) => {
    const grouped = new Map();
    for (const item of messages) {
      const identity = item.user_id || item.guest_id || 'unknown';
      const key = `${identity}:${item.conversation_id || 'default'}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }

    const turns = [];
    for (const group of grouped.values()) {
      const sorted = [...group].sort((a, b) => {
        const byDate = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        if (byDate !== 0) return byDate;
        return Number(a.message_id || 0) - Number(b.message_id || 0);
      });

      for (let index = 0; index < sorted.length; index += 1) {
        const userMessage = sorted[index];
        if (userMessage.role !== 'user') continue;
        const assistantResponse = sorted.slice(index + 1).find((item) => item.role === 'assistant');
        turns.push({
          user_id: userMessage.user_id || '',
          guest_id: userMessage.guest_id || '',
          user_type: userMessage.user_type || '',
          conversation_id: userMessage.conversation_id || '',
          user_message: userMessage.content || '',
          ai_response: assistantResponse?.content || '',
          model: assistantResponse?.model || userMessage.model || '',
          response_time_ms: assistantResponse?.response_time_ms || '',
          limit_status: assistantResponse?.limit_status || userMessage.limit_status || '',
          error_code: assistantResponse?.error_code || userMessage.error_code || '',
          created_at: formatDate(userMessage.created_at),
          ambiguous_user_message: looksAmbiguous(userMessage.content) ? 'yes' : 'no'
        });
      }
    }

    return turns.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  };

  const countBy = (items, getKey) => {
    const counts = new Map();
    for (const item of items) {
      const key = String(getKey(item) || 'unknown');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  };

  const prepareReport = async (options = {}) => {
    const sections = normalizeSections(options);
    const dateRange = normalizeDateRange(options);
    const selectedUserIds = normalizeUserIds(options.userIds);
    const hasUserFilter = selectedUserIds.size > 0;
    const data = analyticsRepository
      ? await analyticsRepository.readDB()
      : await Promise.resolve({
        users: [],
        errors: [],
        events: [],
        conversations: [],
        chatMessages: [],
        plans: [],
        planDailyUsage: [],
        guestMessageCounts: []
      });
    const planSubscriptions = typeof getPlanSubscriptions === 'function' ? await getPlanSubscriptions() : [];

    const matchesUser = (item) => {
      if (!hasUserFilter) return true;
      const userId = item.user_id || item.userId;
      return selectedUserIds.has(String(userId || ''));
    };

    const users = (data.users || []).filter((item) => matchesUser(item) && isInDateRange(item.registered_at, dateRange));
    const conversations = (data.conversations || []).filter(
      (item) => matchesUser(item) && isInDateRange(item.updated_at || item.created_at, dateRange)
    );
    const messages = (data.chatMessages || []).filter((item) => matchesUser(item) && isInDateRange(item.created_at, dateRange));
    const events = (data.events || []).filter((item) => matchesUser(item) && isInDateRange(item.created_at, dateRange));
    const errors = (data.errors || []).filter((item) => isInDateRange(item.created_at, dateRange));
    const planDailyUsage = (data.planDailyUsage || []).filter(
      (item) => matchesUser(item) && isUsageDateInRange(item.usage_date, dateRange)
    );
    const guestMessageCounts = (data.guestMessageCounts || []).filter(
      (item) => isInDateRange(item.last_message_at || item.created_at, dateRange)
    );

    const userMessageCount = messages.filter((item) => item.role === 'user').length;
    const assistantMessages = messages.filter((item) => item.role === 'assistant');
    const responseTimes = assistantMessages
      .map((item) => Number(item.response_time_ms))
      .filter((item) => Number.isFinite(item) && item >= 0);
    const limitErrors = errors.filter((item) => /LIMIT/i.test(`${item.error_type || ''} ${item.details || ''}`));
    const ambiguousMessages = messages.filter((item) => item.role === 'user' && looksAmbiguous(item.content));
    const messageTurns = pairMessageTurns(messages);
    const activeUserIds = new Set(messages.filter((item) => item.user_id).map((item) => String(item.user_id)));
    const unansweredConversations = conversations.filter((conversation) => {
      const conversationMessages = messages.filter((item) => item.conversation_id === conversation.conversation_id);
      if (conversationMessages.length === 0) return false;
      return conversationMessages[conversationMessages.length - 1]?.role === 'user';
    });

    return {
      generatedAt: new Date(),
      format: normalizeFormat(options.format),
      sections,
      dateRange,
      hasUserFilter,
      data: {
        users,
        errors,
        events,
        conversations,
        messages,
        plans: data.plans || [],
        planDailyUsage,
        planSubscriptions,
        guestMessageCounts,
        messageTurns
      },
      summary: {
        registeredUsers: (data.users || []).filter((item) => !String(item.user_id || '').startsWith('guest:')).length,
        guestUsers: (data.users || []).filter((item) => String(item.user_id || '').startsWith('guest:')).length,
        activeUsers: activeUserIds.size,
        conversations: conversations.length,
        messages: userMessageCount,
        guestMessages: messages.filter((item) => item.role === 'user' && item.user_type === 'guest').length,
        registeredUserMessages: messages.filter((item) => item.role === 'user' && item.user_type !== 'guest').length,
        successfulMessages: assistantMessages.filter((item) => !item.error_code).length,
        limitedMessages: limitErrors.length + messages.filter((item) => /limit/i.test(String(item.limit_status || ''))).length,
        errors: errors.length,
        averageAiResponseMs: responseTimes.length
          ? Math.round(responseTimes.reduce((sum, item) => sum + item, 0) / responseTimes.length)
          : 0,
        unansweredConversations: unansweredConversations.length,
        ambiguousMessages: ambiguousMessages.length,
        topErrors: countBy(errors, (item) => item.error_type).slice(0, 10)
      }
    };
  };

  const appendSection = (lines, title) => {
    lines.push('');
    lines.push(`## ${title}`);
    lines.push('-'.repeat(Math.max(8, title.length)));
  };

  const buildCsvFromReport = (report) => {
    const { data, sections, summary } = report;
    const lines = [];

    if (sections.includes('users')) {
      lines.push('USERS');
      lines.push('name,age,phone,registered_at,conversation_count');
      const byUser = new Map();
      for (const c of data.conversations) {
        const key = String(c.user_id || '');
        byUser.set(key, (byUser.get(key) || 0) + 1);
      }
      for (const user of data.users) {
        lines.push(
          [user.name || '', user.age || '', user.phone || '', user.registered_at || '', byUser.get(String(user.user_id)) || 0]
            .map(csvEscape)
            .join(',')
        );
      }
      lines.push('');
    }

    if (sections.includes('errors')) {
      lines.push('ERRORS');
      lines.push('type,endpoint,status_code,message,time');
      for (const item of data.errors) {
        lines.push(
          [item.error_type || '', item.endpoint || '', item.status_code || '', item.details || '', item.created_at || '']
            .map(csvEscape)
            .join(',')
        );
      }
      lines.push('');
    }

    if (sections.includes('conversation_summary')) {
      let total = 0;
      let academic = 0;
      let emotional = 0;
      let creative = 0;
      for (const event of data.events) {
        if (event.event_type === 'message_sent') {
          total += 1;
          if (event.category === 'academic') academic += 1;
          if (event.category === 'emotional') emotional += 1;
          if (event.category === 'creative') creative += 1;
        }
      }

      lines.push('CONVERSATION_SUMMARY');
      lines.push('total_messages,academic,emotional,creative,active_users,unanswered_conversations,ambiguous_messages');
      lines.push([total, academic, emotional, creative, summary.activeUsers, summary.unansweredConversations, summary.ambiguousMessages].join(','));
      lines.push('');
    }

    if (sections.includes('messages')) {
      lines.push('MESSAGES');
      lines.push('user_id,guest_id,user_type,conversation_id,message_id,created_at,role,content,model,response_time_ms,token_usage,error_code,limit_status');
      for (const item of data.messages) {
        lines.push(
          [
            item.user_id || '',
            item.guest_id || '',
            item.user_type || '',
            item.conversation_id || '',
            item.message_id || '',
            formatDate(item.created_at),
            item.role || '',
            item.content || '',
            item.model || '',
            item.response_time_ms || '',
            item.token_usage || '',
            item.error_code || '',
            item.limit_status || ''
          ]
            .map(csvEscape)
            .join(',')
        );
      }
      lines.push('');
    }

    if (sections.includes('plans_usage')) {
      lines.push('PLANS_USAGE');
      lines.push('user_id,usage_date,message_count,image_count,updated_at');
      for (const item of data.planDailyUsage) {
        lines.push(
          [item.user_id || '', item.usage_date || '', item.message_count || 0, item.image_count || 0, item.updated_at || '']
            .map(csvEscape)
            .join(',')
        );
      }
      lines.push('');
    }

    if (sections.includes('guest_usage')) {
      lines.push('GUEST_USAGE');
      lines.push('guest_id,ip_address,message_count,created_at,last_message_at');
      for (const item of data.guestMessageCounts) {
        lines.push(
          [item.guest_id || '', item.ip_address || '', item.message_count || 0, item.created_at || '', item.last_message_at || '']
            .map(csvEscape)
            .join(',')
        );
      }
      lines.push('');
    }

    if (sections.includes('ai_performance')) {
      lines.push('AI_PERFORMANCE');
      lines.push('metric,value');
      for (const [metric, value] of [
        ['guest_messages', summary.guestMessages],
        ['registered_user_messages', summary.registeredUserMessages],
        ['average_ai_response_ms', summary.averageAiResponseMs],
        ['limited_messages', summary.limitedMessages],
        ['successful_messages', summary.successfulMessages],
        ['active_users', summary.activeUsers],
        ['unanswered_conversations', summary.unansweredConversations],
        ['ambiguous_short_messages', summary.ambiguousMessages]
      ]) {
        lines.push([metric, value].map(csvEscape).join(','));
      }
      lines.push('');
    }

    return lines.join('\n');
  };

  const buildTxtFromReport = (report) => {
    const { data, sections, summary, generatedAt, dateRange } = report;
    const lines = [
      'DANUA ADMIN REPORT',
      `Generated at: ${formatDate(generatedAt)}`,
      `Date range: ${dateRange.from ? formatDate(dateRange.from) : 'all'} -> ${dateRange.to ? formatDate(dateRange.to) : 'all'}`,
      `Sections: ${sections.map((item) => SECTION_LABELS[item] || item).join(', ') || 'none'}`,
      '',
      'SUMMARY',
      '-------',
      `registered_users: ${summary.registeredUsers}`,
      `guest_users: ${summary.guestUsers}`,
      `active_users: ${summary.activeUsers}`,
      `conversations: ${summary.conversations}`,
      `messages: ${summary.messages}`,
      `guest_messages: ${summary.guestMessages}`,
      `registered_user_messages: ${summary.registeredUserMessages}`,
      `successful_messages: ${summary.successfulMessages}`,
      `limited_messages: ${summary.limitedMessages}`,
      `errors: ${summary.errors}`,
      `average_ai_response_ms: ${summary.averageAiResponseMs}`,
      `unanswered_conversations: ${summary.unansweredConversations}`,
      `ambiguous_short_messages: ${summary.ambiguousMessages}`
    ];

    if (summary.topErrors.length > 0) {
      lines.push('');
      lines.push('TOP_ERRORS');
      for (const item of summary.topErrors) {
        lines.push(`- ${item.key}: ${item.count}`);
      }
    }

    if (sections.includes('users')) {
      appendSection(lines, 'USERS');
      for (const user of data.users) {
        lines.push(`- user_id: ${user.user_id || ''}`);
        lines.push(`  name: ${user.name || ''}`);
        lines.push(`  age: ${user.age || ''}`);
        lines.push(`  phone: ${user.phone || ''}`);
        lines.push(`  registered_at: ${formatDate(user.registered_at)}`);
        lines.push(`  last_active: ${formatDate(user.last_active)}`);
      }
    }

    if (sections.includes('errors')) {
      appendSection(lines, 'ERRORS');
      for (const item of data.errors) {
        lines.push(`- created_at: ${formatDate(item.created_at)}`);
        lines.push(`  type: ${item.error_type || ''}`);
        lines.push(`  endpoint: ${item.endpoint || ''}`);
        lines.push(`  status_code: ${item.status_code || ''}`);
        lines.push(`  details: ${item.details || ''}`);
      }
    }

    if (sections.includes('conversation_summary')) {
      appendSection(lines, 'CONVERSATION_SUMMARY');
      const categories = countBy(
        data.events.filter((item) => item.event_type === 'message_sent'),
        (item) => item.category
      );
      lines.push(`conversation_count: ${data.conversations.length}`);
      lines.push(`event_message_sent_count: ${categories.reduce((sum, item) => sum + item.count, 0)}`);
      lines.push('categories:');
      for (const item of categories) {
        lines.push(`- ${item.key}: ${item.count}`);
      }
    }

    if (sections.includes('messages')) {
      appendSection(lines, 'MESSAGES');
      for (const turn of data.messageTurns) {
        lines.push('- TURN');
        lines.push(`  user_type: ${turn.user_type}`);
        lines.push(`  user_id: ${turn.user_id}`);
        lines.push(`  guest_id: ${turn.guest_id}`);
        lines.push(`  conversation_id: ${turn.conversation_id}`);
        lines.push(`  created_at: ${turn.created_at}`);
        lines.push(`  model: ${turn.model}`);
        lines.push(`  response_time_ms: ${turn.response_time_ms}`);
        lines.push(`  limit_status: ${turn.limit_status}`);
        lines.push(`  error_code: ${turn.error_code}`);
        lines.push(`  ambiguous_user_message: ${turn.ambiguous_user_message}`);
        lines.push('  user_message: |');
        lines.push(...String(turn.user_message || '').split(/\r?\n/).map((line) => `    ${line}`));
        lines.push('  ai_response: |');
        lines.push(...String(turn.ai_response || '').split(/\r?\n/).map((line) => `    ${line}`));
      }
    }

    if (sections.includes('plans_usage')) {
      appendSection(lines, 'PLANS_USAGE');
      lines.push('plans:');
      for (const plan of data.plans) {
        lines.push(`- id: ${plan.id || ''}, name: ${plan.name || ''}, active: ${Boolean(plan.is_active)}, daily_message_limit: ${plan.daily_message_limit ?? ''}, daily_image_limit: ${plan.daily_image_limit ?? ''}`);
      }
      lines.push('usage:');
      for (const item of data.planDailyUsage) {
        lines.push(`- user_id: ${item.user_id || ''}, usage_date: ${String(item.usage_date || '').slice(0, 10)}, messages: ${item.message_count || 0}, images: ${item.image_count || 0}`);
      }
      if (data.planSubscriptions.length > 0) {
        lines.push('subscriptions:');
        for (const item of data.planSubscriptions) {
          lines.push(`- user_id: ${item.userId || ''}, plan_id: ${item.planId || ''}, status: ${item.status || ''}, assigned_at: ${item.assignedAt || ''}, expires_at: ${item.expiresAt || ''}`);
        }
      }
    }

    if (sections.includes('guest_usage')) {
      appendSection(lines, 'GUEST_USAGE');
      for (const item of data.guestMessageCounts) {
        lines.push(`- guest_id: ${item.guest_id || ''}`);
        lines.push(`  ip_address: ${item.ip_address || ''}`);
        lines.push(`  message_count: ${item.message_count || 0}`);
        lines.push(`  created_at: ${formatDate(item.created_at)}`);
        lines.push(`  last_message_at: ${formatDate(item.last_message_at)}`);
      }
    }

    if (sections.includes('ai_performance')) {
      appendSection(lines, 'AI_PERFORMANCE');
      lines.push(`guest_messages: ${summary.guestMessages}`);
      lines.push(`registered_user_messages: ${summary.registeredUserMessages}`);
      lines.push(`average_ai_response_ms: ${summary.averageAiResponseMs}`);
      lines.push(`limited_messages: ${summary.limitedMessages}`);
      lines.push(`successful_messages: ${summary.successfulMessages}`);
      lines.push(`active_users: ${summary.activeUsers}`);
      lines.push(`unanswered_conversations: ${summary.unansweredConversations}`);
      lines.push(`ambiguous_short_messages: ${summary.ambiguousMessages}`);
    }

    lines.push('');
    return lines.join('\n');
  };

  const buildReport = async (options = {}) => {
    const format = normalizeFormat(options.format);
    const report = await prepareReport({ ...options, format });
    const content = format === 'txt' ? buildTxtFromReport(report) : buildCsvFromReport(report);
    return {
      format,
      extension: format,
      contentType: format === 'txt' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8',
      content,
      sections: report.sections,
      generatedAt: report.generatedAt
    };
  };

  const buildCsvReport = async (options = {}) => {
    const report = await buildReport({ ...options, format: 'csv' });
    return report.content;
  };

  return {
    getLegacyStats,
    getDashboardStats,
    buildCsvReport,
    buildReport,
    supportedReportFormats: ['csv', 'txt'],
    supportedReportSections: REPORT_SECTIONS
  };
}

module.exports = { createAdminAnalyticsService };
