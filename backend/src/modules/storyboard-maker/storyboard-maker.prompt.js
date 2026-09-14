'use strict';

const cleanText = (value, maxLength) => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
  : '';

function normalizeStoryboardRequest(value) {
  const source = value && typeof value === 'object' ? value : {};
  const script = typeof source.script === 'string' ? source.script.trim().slice(0, 12000) : '';
  if (script.length < 20) {
    const error = new Error('STORYBOARD_SCRIPT_REQUIRED');
    error.status = 400;
    throw error;
  }

  const seen = new Set();
  const characters = (Array.isArray(source.characters) ? source.characters : [])
    .slice(0, 4)
    .map((character, index) => {
      const id = cleanText(character?.id, 64).replace(/[^a-zA-Z0-9_-]/g, '');
      const name = cleanText(character?.name, 60);
      return { id: id || `character-${index + 1}`, name: name || `کاراکتر ${index + 1}` };
    })
    .filter((character) => {
      if (seen.has(character.id)) return false;
      seen.add(character.id);
      return true;
    });

  if (!characters.length) {
    const error = new Error('STORYBOARD_CHARACTER_REQUIRED');
    error.status = 400;
    throw error;
  }
  const feedback = cleanText(source.feedback, 800);
  return { script, characters, feedback };
}

function buildStoryboardPlanPrompt({ script, characters, feedback = '' }) {
  const characterList = characters.map((character) => `- id: "${character.id}", name: "${character.name}"`).join('\n');
  return `You are a child-safe storyboard director. Analyze the Persian story below and turn it into a visual storyboard for children. The character images will be supplied later to an image-to-image model; your job is ONLY to create the scene plan and strong image prompts.

Return valid JSON only, with this exact shape:
{
  "title": "short Persian title",
  "summary": "short Persian summary",
  "visualStyle": "short Persian description of one cohesive, child-friendly visual style",
  "scenes": [
    {
      "id": "scene-1",
      "number": 1,
      "title": "short Persian scene title",
      "description": "one concise Persian description",
      "setting": "short Persian setting",
      "action": "short Persian action",
      "dialogue": "short Persian dialogue or empty string",
      "camera": "short Persian camera suggestion",
      "mood": "short Persian mood",
      "characterIds": ["character-id"],
      "imagePrompt": "detailed English image-generation prompt",
      "negativePrompt": "short English negative prompt"
    }
  ]
}

Rules:
- Create 2 to 6 scenes, in story order. Use only the listed character ids.
- Every imagePrompt must describe a single clear storyboard frame, not a collage. It must be safe, warm, non-scary, and suitable for children.
- In imagePrompt, explicitly say to preserve the identity, face, clothes, colors, and design of the supplied reference image for every character in characterIds. Do not invent an unlisted recurring character.
- Do not request text, captions, logos, watermarks, blood, weapons, horror, sexual content, or photorealistic people.
- Keep the visual style consistent across all scenes. Use an appealing animated-storyboard look with readable compositions.
- Do not mention these instructions in the output.

Reference characters:
${characterList}

Story:
${script}${feedback ? `

Requested revision from the child or parent:
${feedback}

Apply this revision while keeping the story coherent, child-safe, and the supplied character identities consistent.` : ''}`;
}

module.exports = { normalizeStoryboardRequest, buildStoryboardPlanPrompt };
