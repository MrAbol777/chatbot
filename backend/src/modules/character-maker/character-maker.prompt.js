'use strict';

function buildCharacterAnalysisPrompt(scenario) {
  return `You are a specialist character designer for family-friendly animated films. Analyze the Persian scenario below and return ONLY valid JSON.

Scenario:
${scenario}

Return this exact shape:
{
  "title": "short Persian project title",
  "summary": "short Persian summary",
  "visualStyle": "short Persian visual direction",
  "stylePrompt": "detailed English project-wide visual bible, 35-90 words",
  "relationships": [{"from":"character id","to":"character id","label":"short Persian relationship"}],
  "characters": [{
    "id":"C01",
    "name":"Persian name",
    "role":"short Persian story role",
    "archetype":"short Persian archetype",
    "personality":"short Persian personality",
    "relationshipNote":"short Persian relationship note",
    "identityLock":"short Persian list of immutable visual traits",
    "appearance":"short Persian appearance description",
    "wardrobe":"short Persian wardrobe description",
    "mannerism":"short Persian mannerism",
    "palette":"short Persian color palette",
    "imagePrompt":"detailed English image-generation prompt; one full-body character only, clean neutral studio background, no text, preserve every identity trait, and follow stylePrompt exactly",
    "negativePrompt":"detailed English negative prompt that explicitly rejects photorealism, live action, real people, and mixed visual styles"
  }],
  "setting": {
    "name":"short Persian place name",
    "description":"short Persian setting description",
    "imagePrompt":"detailed English environment image-generation prompt, cinematic establishing shot, no characters, no text, and follow stylePrompt exactly",
    "negativePrompt":"detailed English negative prompt that explicitly rejects photorealism, live action, real people, and mixed visual styles"
  }
}

Rules:
- Identify every recurring, named, or story-driving character; merge only duplicate references to the exact same character; maximum 8 characters; do not invent characters not supported by the scenario; keep all content safe for children and teens.
- If the scenario contains a Visual Bible and character IDs (C01, C02…), treat them as production truth: preserve every listed character exactly once with the same ID, and use its blueprint and consistency rules instead of guessing conflicting traits.
- Before writing any asset prompt, choose ONE single visual language for the entire project. stylePrompt is the mandatory visual bible shared by every character and the setting: specify the medium, rendering approach, shape language, materials, lighting, color treatment and camera quality. It must never be photorealistic or live action.
- When a scenario Visual Bible exists, translate it faithfully into stylePrompt; do not replace it with a new art direction.
- All characters and the setting must look like assets from the same production. Never mix photo-realism, live action, real people, 2D illustration, 3D animation, anime, or different rendering levels in one project. Choose only one approach and use it consistently.
- Every imagePrompt must reproduce the exact stylePrompt at its beginning and may only vary character identity, costume, pose, or location afterwards. If a detail conflicts with stylePrompt, stylePrompt wins.
- Image prompts must be production-ready and distinct for each character while preserving the same project-wide style.`;
}

module.exports = { buildCharacterAnalysisPrompt };
