# Design System (RTL)

## Goals
- Use semantic tokens only (no direct hard-coded design values in components).
- Keep RTL as the default for all product UI.
- Keep theme switching stable via `data-theme`.

## Tokens
Defined in `src/design-system/tokens/tokens.css`.

- Color: `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-text`, `--color-muted`, `--color-border`, `--color-primary`, `--color-primary-contrast`, `--color-primary-soft`, `--color-success`, `--color-warning`, `--color-danger`, `--color-focus-ring`
- Typography: `--font-family-base`, `--font-size-xs/sm/md/lg/xl`, `--line-height-base`
- Spacing: `--space-1/2/3/4/5/6/8`
- Radius: `--radius-sm/md/lg/xl/pill`
- Shadows: `--shadow-sm/md/lg`
- Z-index: `--z-base`, `--z-dropdown`, `--z-sticky`, `--z-modal`, `--z-toast`
- Motion: `--motion-fast/normal/slow`, `--motion-ease-standard`

## Theme switching
Themes are configured with:
- `[data-theme='energy']`
- `[data-theme='calm']`

Runtime usage (already wired):
```ts
const root = document.documentElement;
root.setAttribute('data-theme', 'energy');
```

## Components
Location: `src/design-system/components/`

- `Button`: variants (`primary`, `secondary`, `ghost`, `danger`), sizes (`sm`, `md`, `lg`), loading, icon slots.
- `TextField` and `TextAreaField`: label, helper, error, disabled, full width.
- `Card`: token-based surface wrapper.
- `Dialog`: overlay + ESC close + tab focus trap.
- `ToastProvider` + `useToast`: lightweight notification system.

## Preview route
Use `/design-system-preview` in browser to inspect core components.

## Contribution rules
- Do not add new hard-coded colors/shadows/spacing in feature code.
- Reuse design-system components where possible.
- If a new visual style is needed, add token(s) first, then component API.
- Keep RTL behavior and keyboard focus-visible support on every component.
