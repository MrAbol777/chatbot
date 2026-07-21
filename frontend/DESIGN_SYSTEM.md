# Design System (RTL)

## Scope
This design system is integrated incrementally into the existing app. It is **not** a full rewrite.

## What is migrated
- Foundations:
  - `src/design-system/tokens/tokens.css`
  - `src/design-system/styles/base.css`
  - `src/design-system/styles/components.css`
- Components:
  - `Button`, `TextField`, `TextAreaField`, `Card`, `Dialog`, `ToastProvider`
- Screens/areas:
  - Landing/auth actions (high-visibility buttons)
  - Auth step 1, step 2, OTP step (shared form fields/actions)
  - Profile settings modal (Dialog + TextField + Button + Toast)
  - Admin login (Card + TextField + Button)
  - Sidebar head/footer action buttons (migrated to `Button` with compatibility classes)
  - Conversation row quick actions (pin/rename/delete) migrated to `Button` icon-only mode
  - Admin users filter controls partially migrated (`TextField` + `Button`)
  - Internal preview route: `/design-system-preview`

## Still legacy (temporary)
- Large parts of `src/styles.css` still contain class-based theme and component styling.
- Chat composer button visuals (`send-btn`, `mic-btn`, `attach-btn`, `confirm-btn`, `cancel-btn`) remain legacy for stability.
- Most admin panel controls still use legacy styles (only low-risk filter controls migrated).
- Auth back buttons and chips remain legacy classes.

## Tokens
Defined in `src/design-system/tokens/tokens.css`.

- Color: `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-text`, `--color-muted`, `--color-border`, `--color-primary`, `--color-primary-contrast`, `--color-primary-soft`, `--color-success`, `--color-warning`, `--color-danger`, `--color-focus-ring`
- Typography: `--font-family-base`, `--font-size-xs/sm/md/lg/xl`, `--line-height-base`
- Spacing: `--space-1/2/3/4/5/6/8`
- Radius: `--radius-sm/md/lg/xl/pill`
- Shadows: `--shadow-sm/md/lg`
- Z-index: `--z-base`, `--z-dropdown`, `--z-sticky`, `--z-modal`, `--z-toast`
- Motion: `--motion-fast/normal/slow`, `--motion-ease-standard`

## Theme usage rules
Themes are controlled with `data-theme` on the root element:
- `[data-theme='energy']`
- `[data-theme='calm']`

Current compatibility:
- Legacy `.theme-calm` styles still exist and should be considered transitional.
- New components should rely on semantic tokens, not `.theme-calm` selectors.

## Component usage examples

### Button
```tsx
<Button>ذخیره</Button>
<Button variant="secondary">بازگشت</Button>
<Button variant="danger" size="sm">حذف</Button>
<Button loading>در حال انجام</Button>
<Button iconOnly aria-label="تنظیمات">⚙️</Button>
```

`iconOnly` accessibility rule:
- Every `iconOnly` button **must** include an explicit `aria-label`.
- `title` is optional helper text only and must not be the sole accessible name.

### TextField / TextAreaField
```tsx
<TextField label="نام" placeholder="مثال: علی" helperText="این یک راهنماست" />
<TextField label="کد تایید" errorText="کد نامعتبر است" />
<TextAreaField label="پیام" placeholder="پیام خود را بنویسید" />
```

### Dialog
```tsx
<Dialog open={open} title="تنظیمات" onClose={() => setOpen(false)}>
  <TextField label="نام" />
</Dialog>
```

For custom footer controls:
```tsx
<Dialog open={open} title="پروفایل" onClose={close} showFooter={false}>
  ...custom actions...
</Dialog>
```

### Toast
```tsx
const { pushToast } = useToast();
pushToast('ذخیره شد', 'success');
pushToast('خطا رخ داد', 'danger');
```

## Do / Don't
- Do: use semantic tokens for color/spacing/radius/shadow.
- Do: preserve RTL (`dir="rtl"` on app shell, logical spacing when possible).
- Do: keep keyboard focus-visible and aria labels.
- Do: add compatibility classes when migrating high-traffic legacy surfaces (example: `.sidebar-btn.ds-button`).
- Don't: add new hard-coded colors in feature components.
- Don't: add one-off button/input styles when DS components can be reused.
- Don't: remove legacy styles aggressively without migration of consumers.

## Migration rules for future work
1. Prefer replacing repeated UI patterns first (buttons/inputs/modals).
2. Keep class names for legacy visuals only where needed.
3. If replacing a legacy block, add token-based equivalent before deleting old styles.
4. Validate with both themes and RTL before merging.
5. For risky areas (chat composer), migrate in smaller sub-steps.

## CSS cleanup rules
- Narrow legacy selectors when DS components are introduced (example: `input:not(.ds-field__input)`).
- Prefer grouped compatibility selectors over duplicate blocks.
- Keep comments where legacy selectors are intentionally preserved.
- Avoid broad overrides that target every `button`/`input` globally in feature scopes.

## When to use DS vs native/legacy
- Use DS components for repeated product UI (forms, action buttons, dialogs, settings).
- Keep native/legacy markup for structure-sensitive areas that have animation-heavy CSS dependencies (chat composer controls).
- Migrate legacy markup only after ensuring class-specific behavior is preserved.

## Compatibility layering example
When moving a legacy button group to DS `Button`, keep compatibility selectors during transition:

```css
.sidebar-footer button,
.sidebar-btn.ds-button {
  /* shared legacy-compatible visual rules */
}
```

This pattern enables safe rollout without changing all related screens at once.

## Transitional bridge patterns
When full DS migration is too risky, bridge incrementally:

- Native input + DS field visual layer:
  - keep native markup/behavior, add `.ds-field__input` class for tokenized visuals.
  - example: rename conversation input keeps native focus/submit timing while aligning with DS input style.
- DS button + legacy class compatibility:
  - migrate markup to `Button`, then map old visual classes via targeted selectors (e.g. `.sidebar-btn.ds-button`).
- Avoid bridge overuse:
  - bridge classes are temporary; replace with pure DS composition once area is behavior-safe.

## How to add a new component correctly
1. Create component in `src/design-system/components/` with strict TypeScript props.
2. Style it in `src/design-system/styles/components.css` using only semantic tokens.
3. Export from `src/design-system/components/index.ts`.
4. Add usage block to `/design-system-preview`.
5. Add docs update in this file.
