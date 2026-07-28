-- Executed with bound parameters by the guarded migration runner.
-- INSERT IGNORE is intentional: reruns never reset later Admin changes.
INSERT IGNORE INTO app_ai_providers
  (provider_key,display_name,enabled,base_url,api_key_env_name,max_concurrency,daily_cost_limit,config_json,created_at,updated_at)
VALUES (?,?,?,?,?,NULL,NULL,?,NOW(),NOW());

INSERT IGNORE INTO app_ai_capability_routes
  (route_id,capability_key,primary_provider_key,primary_model_key,fallback_provider_key,fallback_model_key,routing_policy,enabled,version,max_concurrency,daily_cost_limit,config_json,created_at,updated_at)
VALUES (?,?,?,?,?,?,?, ?,1,NULL,NULL,?,NOW(),NOW());

