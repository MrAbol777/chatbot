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
  getStats
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

  const buildCsvReport = async ({ users, errors, conversations, messages }) => {
    const includeUsers = users === '1';
    const includeErrors = errors === '1';
    const includeConversationSummary = conversations === '1';
    const includeMessages = messages === '1';
    const data = analyticsRepository
      ? await analyticsRepository.readDB()
      : await Promise.resolve({ users: [], errors: [], events: [], conversations: [], chatMessages: [] });
    const lines = [];

    if (includeUsers) {
      lines.push('USERS');
      lines.push('name,age,phone,registered_at,conversation_count');
      const byUser = new Map();
      for (const c of data.conversations || []) {
        const key = String(c.user_id || '');
        byUser.set(key, (byUser.get(key) || 0) + 1);
      }
      for (const user of data.users || []) {
        lines.push(
          [user.name || '', user.age || '', user.phone || '', user.registered_at || '', byUser.get(String(user.user_id)) || 0]
            .map(csvEscape)
            .join(',')
        );
      }
      lines.push('');
    }

    if (includeErrors) {
      lines.push('ERRORS');
      lines.push('type,endpoint,status_code,message,time');
      for (const item of data.errors || []) {
        lines.push(
          [item.error_type || '', item.endpoint || '', item.status_code || '', item.details || '', item.created_at || '']
            .map(csvEscape)
            .join(',')
        );
      }
      lines.push('');
    }

    if (includeConversationSummary) {
      let total = 0;
      let academic = 0;
      let emotional = 0;
      let creative = 0;
      for (const event of data.events || []) {
        if (event.event_type === 'message_sent') {
          total += 1;
          if (event.category === 'academic') academic += 1;
          if (event.category === 'emotional') emotional += 1;
          if (event.category === 'creative') creative += 1;
        }
      }

      lines.push('CONVERSATION_SUMMARY');
      lines.push('total_messages,academic,emotional,creative');
      lines.push([total, academic, emotional, creative].join(','));
      lines.push('');
    }

    if (includeMessages) {
      lines.push('MESSAGES');
      lines.push('user_id,guest_id,user_type,conversation_id,message_id,created_at,role,content,model,response_time_ms,token_usage,error_code,limit_status');
      for (const item of data.chatMessages || []) {
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

    return lines.join('\n');
  };

  return {
    getLegacyStats,
    getDashboardStats,
    buildCsvReport
  };
}

module.exports = { createAdminAnalyticsService };
