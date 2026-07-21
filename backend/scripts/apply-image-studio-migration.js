const path = require('path');
const dotenv = require('dotenv');
const { DatabaseClient } = require('../src/repositories/DatabaseClient');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const db = new DatabaseClient({ databaseUrl: process.env.DATABASE_URL });
  try {
    await db.init();
    const [columns] = await db.query("SHOW COLUMNS FROM image_generations LIKE 'idempotency_key'");
    const [indexes] = await db.query(
      "SHOW INDEX FROM image_generations WHERE Key_name = 'uq_image_generations_owner_idempotency'"
    );
    if (columns.length !== 1 || indexes.length < 1) {
      throw new Error('Image Studio schema verification failed.');
    }
    await db.query(`
      UPDATE app_settings
      SET setting_value = 'true', updated_at = NOW()
      WHERE setting_key = 'ai.image.edit_enabled'
        AND EXISTS (
          SELECT 1 FROM (
            SELECT JSON_UNQUOTE(setting_value) AS model_value
            FROM app_settings
            WHERE setting_key IN ('ai.image.model_preset', 'ai.image.model.runtime_model', 'ai.image.model', 'ai.image.model.admin_value')
          ) supported_models
          WHERE supported_models.model_value IN ('nano-banana', 'nano-banana-pro', 'gemini-2.5-flash-image', 'gemini-3-pro-image')
        )
    `);
    console.log('[migrations 021-022] Image Studio schema and edit capability are ready.');
  } finally {
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error('[migration 021] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
