const REPORT_SECTIONS = [
  'users',
  'errors',
  'conversation_summary',
  'messages',
  'ai_performance',
  'supervised_otp_usage'
];

const SECTION_LABELS = {
  users: 'Users',
  errors: 'Errors',
  conversation_summary: 'Conversation summary',
  messages: 'Messages',
  ai_performance: 'AI performance',
  supervised_otp_usage: 'Supervised OTP usage'
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
  getSupervisedOtpUsage
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

  const normalizeBooleanFlag = (value) => {
    const text = String(value ?? '').trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'yes' || text === 'on';
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
      const identity = item.user_id || 'unknown';
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
          user_type: userMessage.user_type || '',
          conversation_id: userMessage.conversation_id || '',
          user_message: userMessage.content || '',
          ai_response: assistantResponse?.content || '',
          model: assistantResponse?.model || userMessage.model || '',
          response_time_ms: assistantResponse?.response_time_ms || '',
          error_code: assistantResponse?.error_code || userMessage.error_code || '',
          created_at: formatDate(userMessage.created_at),
          ambiguous_user_message: looksAmbiguous(userMessage.content) ? 'yes' : 'no',
          has_error: Boolean(assistantResponse?.error_code || userMessage.error_code)
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
    const filters = {
      ambiguousOnly: normalizeBooleanFlag(options.ambiguousOnly)
    };
    const data = analyticsRepository
      ? await analyticsRepository.readDB()
      : await Promise.resolve({
        users: [],
        errors: [],
        events: [],
        conversations: [],
        chatMessages: []
      });
    const supervisedOtpUsage = typeof getSupervisedOtpUsage === 'function' ? await getSupervisedOtpUsage() : [];

    const matchesUser = (item) => {
      if (!hasUserFilter) return true;
      const userId = item.user_id || item.userId;
      return selectedUserIds.has(String(userId || ''));
    };

    const users = (data.users || []).filter(
      (item) => matchesUser(item) && isInDateRange(item.registered_at, dateRange)
    );
    const conversations = (data.conversations || []).filter(
      (item) => matchesUser(item) && isInDateRange(item.updated_at || item.created_at, dateRange)
    );
    const messages = (data.chatMessages || []).filter((item) => matchesUser(item) && isInDateRange(item.created_at, dateRange));
    const events = (data.events || []).filter((item) => matchesUser(item) && isInDateRange(item.created_at, dateRange));
    const errors = (data.errors || []).filter((item) => isInDateRange(item.created_at, dateRange));
    const supervisedOtpUsageRows = (supervisedOtpUsage || []).filter(
      (item) => matchesUser(item) && isInDateRange(item.used_at, dateRange)
    );

    const userMessageCount = messages.filter((item) => item.role === 'user').length;
    const assistantMessages = messages.filter((item) => item.role === 'assistant');
    const responseTimes = assistantMessages
      .map((item) => Number(item.response_time_ms))
      .filter((item) => Number.isFinite(item) && item >= 0);
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
        messageTurns,
        supervisedOtpUsage: supervisedOtpUsageRows
      },
      filters,
      summary: {
        registeredUsers: (data.users || []).length,
        activeUsers: activeUserIds.size,
        conversations: conversations.length,
        messages: userMessageCount,
        registeredUserMessages: messages.filter((item) => item.role === 'user').length,
        successfulMessages: assistantMessages.filter((item) => !item.error_code).length,
        errors: errors.length,
        averageAiResponseMs: responseTimes.length
          ? Math.round(responseTimes.reduce((sum, item) => sum + item, 0) / responseTimes.length)
          : 0,
        unansweredConversations: unansweredConversations.length,
        ambiguousMessages: ambiguousMessages.length,
        supervisedOtpUses: supervisedOtpUsageRows.length,
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
      lines.push('user_id,user_type,conversation_id,message_id,created_at,role,content,model,response_time_ms,token_usage,error_code');
      for (const item of data.messages) {
        lines.push(
          [
            item.user_id || '',
            item.user_type || '',
            item.conversation_id || '',
            item.message_id || '',
            formatDate(item.created_at),
            item.role || '',
            item.content || '',
            item.model || '',
            item.response_time_ms || '',
            item.token_usage || '',
            item.error_code || ''
          ]
            .map(csvEscape)
            .join(',')
        );
      }
      lines.push('');
    }

    if (sections.includes('supervised_otp_usage')) {
      lines.push('SUPERVISED_OTP_USAGE');
      lines.push('phone,user_id,used_at,result');
      for (const item of data.supervisedOtpUsage) {
        lines.push(
          [item.phone || '', item.user_id || '', formatDate(item.used_at), item.result || '']
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
        ['registered_user_messages', summary.registeredUserMessages],
        ['average_ai_response_ms', summary.averageAiResponseMs],
        ['successful_messages', summary.successfulMessages],
        ['active_users', summary.activeUsers],
        ['unanswered_conversations', summary.unansweredConversations],
        ['ambiguous_short_messages', summary.ambiguousMessages],
        ['supervised_otp_uses', summary.supervisedOtpUses]
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
      `active_users: ${summary.activeUsers}`,
      `conversations: ${summary.conversations}`,
       `messages: ${summary.messages}`,
      `registered_user_messages: ${summary.registeredUserMessages}`,
      `successful_messages: ${summary.successfulMessages}`,
      `errors: ${summary.errors}`,
      `average_ai_response_ms: ${summary.averageAiResponseMs}`,
      `unanswered_conversations: ${summary.unansweredConversations}`,
      `ambiguous_short_messages: ${summary.ambiguousMessages}`,
      `supervised_otp_uses: ${summary.supervisedOtpUses}`
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
        lines.push(`  conversation_id: ${turn.conversation_id}`);
        lines.push(`  created_at: ${turn.created_at}`);
        lines.push(`  model: ${turn.model}`);
        lines.push(`  response_time_ms: ${turn.response_time_ms}`);
        lines.push(`  error_code: ${turn.error_code}`);
        lines.push(`  ambiguous_user_message: ${turn.ambiguous_user_message}`);
        lines.push('  user_message: |');
        lines.push(...String(turn.user_message || '').split(/\r?\n/).map((line) => `    ${line}`));
        lines.push('  ai_response: |');
        lines.push(...String(turn.ai_response || '').split(/\r?\n/).map((line) => `    ${line}`));
      }
    }

    if (sections.includes('supervised_otp_usage')) {
      appendSection(lines, 'SUPERVISED_OTP_USAGE');
      lines.push(`total_uses: ${data.supervisedOtpUsage.length}`);
      for (const item of data.supervisedOtpUsage) {
        lines.push(`- used_at: ${formatDate(item.used_at)}`);
        lines.push(`  phone: ${item.phone || ''}`);
        lines.push(`  user_id: ${item.user_id || ''}`);
        lines.push(`  result: ${item.result || ''}`);
      }
    }

    if (sections.includes('ai_performance')) {
       appendSection(lines, 'AI_PERFORMANCE');
      lines.push(`registered_user_messages: ${summary.registeredUserMessages}`);
      lines.push(`average_ai_response_ms: ${summary.averageAiResponseMs}`);
      lines.push(`successful_messages: ${summary.successfulMessages}`);
      lines.push(`active_users: ${summary.activeUsers}`);
      lines.push(`unanswered_conversations: ${summary.unansweredConversations}`);
      lines.push(`ambiguous_short_messages: ${summary.ambiguousMessages}`);
      lines.push(`supervised_otp_uses: ${summary.supervisedOtpUses}`);
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
