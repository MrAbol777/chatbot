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

  const buildCsvReport = async ({ users, errors, conversations }) => {
    const includeUsers = users === '1';
    const includeErrors = errors === '1';
    const includeConversationSummary = conversations === '1';
    const data = analyticsRepository ? await analyticsRepository.readDB() : await Promise.resolve({ users: [], errors: [], events: [], conversations: [] });
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
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
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
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
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

    return lines.join('\n');
  };

  return {
    getLegacyStats,
    getDashboardStats,
    buildCsvReport
  };
}

module.exports = { createAdminAnalyticsService };
