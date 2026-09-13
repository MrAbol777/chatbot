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
  "relationships": [{"from":"character id","to":"character id","label":"short Persian relationship"}],
  "characters": [{
    "id":"char-1",
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
    "imagePrompt":"detailed English image-generation prompt; one full-body character only, clean neutral studio background, no text, preserve every identity trait",
    "negativePrompt":"detailed English negative prompt"
  }],
  "setting": {
    "name":"short Persian place name",
    "description":"short Persian setting description",
    "imagePrompt":"detailed English environment image-generation prompt, cinematic establishing shot, no characters, no text",
    "negativePrompt":"detailed English negative prompt"
  }
}

Rules: identify every recurring, named, or story-driving character; merge only duplicate references to the exact same character; maximum 8 characters; do not invent characters not supported by the scenario; keep all content safe for children and teens; image prompts must be production-ready and distinct for each character.`;
}

module.exports = { buildCharacterAnalysisPrompt };
