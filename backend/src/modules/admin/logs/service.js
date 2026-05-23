function createAdminLogsService({ readDB, readAuditLogs }) {
  const getErrors = async ({ errorType = '', from = '', to = '' }) => {
    const data = await readDB();
    let errors = Array.isArray(data.errors) ? data.errors : [];

    if (typeof errorType === 'string' && errorType.trim()) {
      errors = errors.filter((item) => String(item.error_type || '') === errorType.trim());
    }

    if (typeof from === 'string' && from.trim()) {
      const fromDate = new Date(from).getTime();
      if (!Number.isNaN(fromDate)) {
        errors = errors.filter((item) => new Date(item.created_at || 0).getTime() >= fromDate);
      }
    }

    if (typeof to === 'string' && to.trim()) {
      const toDate = new Date(to).getTime();
      if (!Number.isNaN(toDate)) {
        errors = errors.filter((item) => new Date(item.created_at || 0).getTime() <= toDate);
      }
    }

    errors.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    return { items: errors };
  };

  const getAuditLogs = async ({ page = '1', pageSize = '20' }) => {
    const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number.parseInt(String(pageSize), 10) || 20));
    const logs = await readAuditLogs();
    const start = (safePage - 1) * safePageSize;
    const items = logs.slice(start, start + safePageSize);

    return {
      items,
      total: logs.length,
      page: safePage,
      pageSize: safePageSize
    };
  };

  return {
    getErrors,
    getAuditLogs
  };
}

module.exports = { createAdminLogsService };
