CREATE TABLE IF NOT EXISTS app_video_generation_inputs (
  id VARCHAR(64) PRIMARY KEY,
  generation_id VARCHAR(64) NOT NULL,
  media_id VARCHAR(64) NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_video_gen_input_pos (generation_id, position),
  UNIQUE KEY uq_video_gen_input_media (generation_id, media_id),
  INDEX idx_video_gen_input_generation (generation_id),
  CONSTRAINT fk_video_gen_input_generation FOREIGN KEY (generation_id) REFERENCES app_video_generations(id) ON DELETE CASCADE,
  CONSTRAINT fk_video_gen_input_media FOREIGN KEY (media_id) REFERENCES app_video_input_media(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
