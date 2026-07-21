function createHealthService({ httpClient, metisBaseUrl, metisApiKey, defaultModel }) {
  const getStatus = () => ({
    ok: true,
    service: 'hemraz-backend',
    model: defaultModel,
    baseUrl: metisBaseUrl
  });

  const checkUpstream = async () => {
    if (!metisApiKey) {
      return {
        ok: false,
        statusCode: 500,
        body: { ok: false, error: 'METIS_API_KEY is missing' }
      };
    }

    try {
      const startedAt = Date.now();
      const response = await httpClient.get(`${metisBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${metisApiKey}` },
        timeout: 10000
      });

      return {
        ok: true,
        statusCode: 200,
        body: {
          ok: true,
          status: response.status,
          durationMs: Date.now() - startedAt
        }
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: 502,
        body: {
          ok: false,
          code: error?.code || null,
          status: error?.response?.status || null,
          message: error instanceof Error ? error.message : 'upstream_check_failed'
        }
      };
    }
  };

  return {
    getStatus,
    checkUpstream
  };
}

module.exports = { createHealthService };
