'use strict';

const PRESETS = Object.freeze([
  {
    id: 'video-prompt-profile-cinematic',
    versionId: 'video-prompt-profile-cinematic-v1',
    profileKey: 'cinematic',
    displayName: 'واقعی و سینمایی',
    publicDescription: 'مناسب عکس‌های واقعی، افراد، محصولات و صحنه‌هایی با حرکت طبیعی و دوربین سینمایی',
    visualKey: 'cinematic-frame',
    displayOrder: 10,
    sourceFile: 'cinematic-base.fa.txt',
    executionTemplate: 'Animate the source image as a realistic cinematic shot without redesigning it. Preserve identity, composition, products, logos, text and the original environment while applying only physically plausible motion.',
    rulesManifest: {
      styleProfile: 'Create a realistic, professional cinematic image-to-video shot by animating the supplied image, never by redesigning it.',
      nonNegotiableRules: [
        'Animate the source image; do not redesign or replace it.',
        'Preserve the identity of every person and object.',
        'Do not change faces, age, skin, hair, clothing or body proportions.',
        'Do not alter products, logos or written text.',
        'Keep the original environment unless the user explicitly requests a compatible environmental motion.',
        'Use natural, smooth subject motion and scene-appropriate cinematic camera motion.',
        'Respect real-world physics.',
        'Prevent flicker, warping, morphing and geometric distortion.',
        'Maintain strong temporal consistency.',
        'Follow the user request only when compatible with the source image; convert incompatible motion to the nearest logical motion.'
      ],
      directingDecisions: [
        'When the request is underspecified, prefer a restrained slow camera move and subtle environmental motion.',
        'Keep pacing calm and continuous; do not introduce new subjects or scene changes.'
      ],
      outputQuality: [
        'The result must look realistic, polished and cinematic.',
        'Prioritize identity preservation, temporal stability, clean anatomy and artifact-free motion.'
      ]
    }
  },
  {
    id: 'video-prompt-profile-animation',
    versionId: 'video-prompt-profile-animation-v1',
    profileKey: 'animation',
    displayName: 'انیمیشنی',
    publicDescription: 'مناسب تصاویر کارتونی، انیمه، سه‌بعدی و شخصیت‌های طراحی‌شده',
    visualKey: 'animation-frame',
    displayOrder: 20,
    sourceFile: 'animation-base.fa.txt',
    executionTemplate: 'Animate the source artwork as a professional animation shot while locking its original character design, art direction, palette and medium. Motion must follow the visual language of that exact style.',
    rulesManifest: {
      styleProfile: 'Create a professional animated sequence from the supplied artwork while locking the original character design and artistic medium.',
      nonNegotiableRules: [
        'Preserve the original character design and art style; never make it photorealistic.',
        'Do not change face shape, eyes, hair, clothing, colors or body proportions.',
        'Lock the detected medium: 2D, 3D, anime, stop motion or illustration.',
        'Make all motion consistent with that same artistic style.',
        'Apply timing, spacing, anticipation and follow-through appropriate to the action.',
        'Use squash and stretch only when it matches the locked style.',
        'Keep character acting and emotion natural within the style.',
        'Animate hair, clothing, ears, tails or wings with smooth follow-through.',
        'Keep camera motion compatible with the animation style.',
        'Do not create extra hands, feet, limbs or duplicated features.',
        'Do not change the palette, background or character identity.'
      ],
      directingDecisions: [
        'When underspecified, use a readable pose change, subtle secondary motion and a gentle style-compatible camera move.',
        'Keep staging, silhouette and character readability stable throughout the shot.'
      ],
      outputQuality: [
        'The result must feel like a polished professional animation sequence.',
        'Prioritize style lock, identity preservation, temporal consistency and clean anatomy.'
      ]
    }
  }
]);

module.exports = { VIDEO_PROMPT_PRESETS: PRESETS };

