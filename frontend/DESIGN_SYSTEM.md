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
  - Internal preview route: `/design-system-preview`

## Still legacy (temporary)
- Large parts of `src/styles.css` still contain class-based theme and component styling.
- Chat composer button visuals (`send-btn`, `mic-btn`, `attach-btn`, `confirm-btn`, `cancel-btn`) remain legacy for stability.
- Sidebar action buttons and some admin panel controls are legacy classes.

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
```

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
- Don't: add new hard-coded colors in feature components.
- Don't: add one-off button/input styles when DS components can be reused.
- Don't: remove legacy styles aggressively without migration of consumers.

## Migration rules for future work
1. Prefer replacing repeated UI patterns first (buttons/inputs/modals).
2. Keep class names for legacy visuals only where needed.
3. If replacing a legacy block, add token-based equivalent before deleting old styles.
4. Validate with both themes and RTL before merging.
5. For risky areas (chat composer), migrate in smaller sub-steps.

## How to add a new component correctly
1. Create component in `src/design-system/components/` with strict TypeScript props.
2. Style it in `src/design-system/styles/components.css` using only semantic tokens.
3. Export from `src/design-system/components/index.ts`.
4. Add usage block to `/design-system-preview`.
5. Add docs update in this file.
