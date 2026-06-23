---
name: Danua Design System
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#4a4455'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#7b7487'
  outline-variant: '#ccc3d8'
  surface-tint: '#732ee4'
  primary: '#630ed4'
  on-primary: '#ffffff'
  primary-container: '#7c3aed'
  on-primary-container: '#ede0ff'
  inverse-primary: '#d2bbff'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#7c3d00'
  on-tertiary: '#ffffff'
  tertiary-container: '#a05100'
  on-tertiary-container: '#ffdfcb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#eaddff'
  primary-fixed-dim: '#d2bbff'
  on-primary-fixed: '#25005a'
  on-primary-fixed-variant: '#5a00c6'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#ffdcc5'
  tertiary-fixed-dim: '#ffb783'
  on-tertiary-fixed: '#301400'
  on-tertiary-fixed-variant: '#713700'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 52px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 40px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  body-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.02em
  caption:
    fontFamily: Be Vietnam Pro
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 20px
  lg: 32px
  xl: 48px
  container-margin-mobile: 16px
  container-margin-desktop: 40px
  gutter: 16px
---

## Brand & Style
The design system is engineered to bridge the gap between childhood curiosity and teenage sophistication. The brand personality is **Intellectual Playfulness**—it is supportive, safe, and modern, avoiding the overly simplistic tropes of younger children's apps to remain relevant to the 18-year-old demographic.

The aesthetic follows a **Refined Playful** style, blending **Minimalism** with **Glassmorphism**. It utilizes generous whitespace, vibrant but controlled color accents, and soft, tactile surfaces. The interface should feel like a high-end educational tool: precise enough to be trusted, yet soft enough to be approachable. All interactions must prioritize RTL (Right-to-Left) flow naturally, ensuring the Persian-speaking audience feels centered in the experience.

## Colors
The palette is rooted in a **Bright Purple** (Primary) to represent wisdom and imagination. **Teal** (Secondary) provides a sense of calm and safety, while **Soft Orange** (Tertiary) is used sparingly for energetic calls-to-action and motivational feedback.

- **Primary (#7C3AED):** Used for the AI's identity, main buttons, and active states.
- **Secondary (#0D9488):** Used for educational success states, "Safe Mode" indicators, and secondary navigation.
- **Tertiary (#FB923C):** Reserved for highlights, badges, and "Aha!" moments in the learning journey.
- **Neutrals:** A range of cool grays and off-whites ensure the interface feels "clean" and high-end rather than cluttered.

The system defaults to a **Light Mode** with a high-contrast text ratio to ensure readability for educational content, utilizing subtle tinting in the backgrounds to reduce eye strain.

## Typography
The typography strategy uses **Plus Jakarta Sans** for headings to provide a friendly, geometric, and modern feel. For body text, **Be Vietnam Pro** offers a clean, contemporary rhythm. 

**Important Note for Persian Implementation:** While the system tokens use Google Fonts for international compatibility, the production interface must map these roles to **Vazirmatn** or **Yekan Bakh**. 
- Display and Headlines should use the *ExtraBold* or *Bold* weights of the Persian typeface to maintain the playful energy.
- Body text should use the *Regular* weight with a slightly increased line height (minimum 1.5x) to accommodate the height of Persian characters and improve legibility for younger readers.
- All text alignment is **Right-aligned** by default.

## Layout & Spacing
The layout follows a **Mobile-First, Fluid Grid** philosophy. On mobile devices, the system uses a 4-column grid with 16px margins. On desktop, it expands to a 12-column grid capped at a maximum content width of 1200px.

Spacing is based on an **8px linear scale**, favoring generous internal padding within components to create a "breathable" and uncrowded feeling. In the RTL context, the horizontal flow begins from the right; therefore, all "Next" actions appear on the left, and "Back" actions on the right. Sidebars and navigation drawers must anchor to the right edge of the screen.

## Elevation & Depth
Depth in this design system is created through **Soft Ambient Shadows** and **Tonal Layering**. We avoid harsh black shadows in favor of shadows tinted with the primary color (e.g., a deep purple shadow with 8% opacity).

1.  **Level 0 (Base):** The main background, using the neutral background color.
2.  **Level 1 (Cards/Inputs):** Flat surfaces with a subtle 1px border in a slightly darker neutral shade.
3.  **Level 2 (Floating Elements):** Items like chat bubbles and primary action buttons use a soft, diffused shadow (Y: 4px, Blur: 12px) to appear "interactive."
4.  **Level 3 (Modals/Overlays):** These use **Glassmorphism**. A backdrop blur (12px to 20px) with a semi-transparent white fill (80% opacity) creates a sense of safe, focused immersion without losing the context of the previous screen.

## Shapes
The shape language is defined by **High Roundedness**. This removes visual "edges" and makes the interface feel safer and more inviting.

- **Standard Components:** Use a 16px (1rem) radius.
- **Large Containers/Cards:** Use a 24px (1.5rem) radius.
- **Buttons and Chips:** Are fully pill-shaped (rounded-full) to emphasize their "squishy" and tappable nature.
- **Chat Bubbles:** Use a distinctive "asymmetric" roundness—the corner pointing toward the user/AI avatar remains slightly sharper (4px) while the other three corners are deeply rounded (20px).

## Components
Consistent component styling reinforces the "High-End Educational" feel:

- **Chat Bubbles:** The AI (Danua) bubbles use the Primary Purple with white text, positioned on the right. User bubbles use a Soft Gray surface with Primary Purple text, positioned on the left.
- **Buttons:** Primary buttons are pill-shaped, using a subtle vertical gradient (Primary to a slightly darker shade) to feel tactile.
- **Input Fields:** Search and chat inputs have a thick 2px border that transitions from Gray to Primary Purple on focus. Backgrounds are solid white to stand out from the surface color.
- **Cards:** Learning modules are displayed in cards with Level 2 elevation and a "top-border" accent using either the Secondary Teal or Tertiary Orange to categorize subjects.
- **Progress Bars:** Thick (12px height), fully rounded tracks with a vibrant gradient fill to provide high-visibility feedback for educational milestones.
- **Chips/Tags:** Used for "Quick Replies" or "Topic Suggestions," these should be outlined with a 1px Primary border to look lightweight.
- **Avatars:** The AI avatar should be circular, with a soft "glow" (shadow) using the Secondary Teal color to indicate the AI is "thinking" or active.