'use strict';

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
};

function createAiRoutingRepository(db) {
  return {
    async getRoute(capabilityKey) {
      const [rows] = await db.query('SELECT * FROM app_ai_capability_routes WHERE capability_key=? LIMIT 1', [capabilityKey]);
      return rows[0] || null;
    },
    async listRoutes() { return (await db.query('SELECT * FROM app_ai_capability_routes ORDER BY capability_key'))[0]; },
    async getProvider(key) { return (await db.query('SELECT * FROM app_ai_providers WHERE provider_key=? LIMIT 1', [key]))[0][0] || null; },
    async listProviders() { return (await db.query('SELECT * FROM app_ai_providers ORDER BY provider_key'))[0]; },
    async getModel(key) { return (await db.query('SELECT * FROM app_video_models WHERE internal_key=? LIMIT 1', [key]))[0][0] || null; },
    async listModels() { return (await db.query('SELECT * FROM app_video_models ORDER BY provider,sort_order,internal_key'))[0]; },
    async getHealth(providerKey, capabilityKey) {
      return (await db.query('SELECT * FROM app_ai_provider_health WHERE provider_key=? AND capability_key=? LIMIT 1', [providerKey, capabilityKey]))[0][0] || null;
    },
    async activeAttemptCount({ providerKey, capabilityKey, routeId = null }) {
      const params = [providerKey, capabilityKey];
      let sql = "SELECT COUNT(*) AS count FROM app_ai_provider_attempts WHERE provider_key=? AND capability_key=? AND state IN ('submitting','accepted','processing')";
      if (routeId) { sql += ' AND route_id=?'; params.push(routeId); }
      return Number((await db.query(sql, params))[0][0]?.count || 0);
    },
    async dailyCost({ providerKey, capabilityKey, routeId = null }) {
      const params = [providerKey, capabilityKey];
      let sql = 'SELECT COALESCE(SUM(actual_cost),0) AS total FROM app_ai_provider_attempts WHERE provider_key=? AND capability_key=? AND created_at>=CURDATE()';
      if (routeId) { sql += ' AND route_id=?'; params.push(routeId); }
      return Number((await db.query(sql, params))[0][0]?.total || 0);
    },
    async claimCircuitPermission(providerKey, capabilityKey) {
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query("INSERT IGNORE INTO app_ai_provider_health (provider_key,capability_key,circuit_state,failure_threshold,cooldown_seconds,half_open_max_attempts,half_open_attempts,consecutive_failures,success_count,failure_count,updated_at) VALUES (?,?,'CLOSED',5,300,1,0,0,0,0,NOW())", [providerKey, capabilityKey]);
        const [rows] = await connection.query('SELECT * FROM app_ai_provider_health WHERE provider_key=? AND capability_key=? FOR UPDATE', [providerKey, capabilityKey]);
        const health = rows[0]; let allowed = true;
        if (health.circuit_state === 'OPEN') {
          if (health.retry_after && new Date(health.retry_after) > new Date()) allowed = false;
          else await connection.query("UPDATE app_ai_provider_health SET circuit_state='HALF_OPEN',half_open_attempts=1,version=version+1,updated_at=NOW() WHERE provider_key=? AND capability_key=?", [providerKey, capabilityKey]);
        } else if (health.circuit_state === 'HALF_OPEN') {
          if (Number(health.half_open_attempts) >= Number(health.half_open_max_attempts)) allowed = false;
          else await connection.query('UPDATE app_ai_provider_health SET half_open_attempts=half_open_attempts+1,version=version+1,updated_at=NOW() WHERE provider_key=? AND capability_key=?', [providerKey, capabilityKey]);
        }
        await connection.commit(); return allowed;
      } catch (error) { try { await connection.rollback(); } catch (_) {} throw error; } finally { connection.release(); }
    },
    parseJson
  };
}

module.exports = { createAiRoutingRepository, parseJson };
