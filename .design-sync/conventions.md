# Tarhunna UI — conventions for design agents

Components import from `@tarhunna/ui`. Styling is **Tailwind v4 utility classes** — there are no per-component styling props beyond `className`. The compiled stylesheet ships at `styles.css` (imports `_ds_bundle.css`); the design agent receives the full transitive `@import` closure. Anything beyond utility classes goes through `className`.

## Setup

No wrapper provider is required for these primitives — every component renders standalone. `Dialog` and `DropdownMenu` are Radix-based and portal themselves; the rendered design must include `_ds_bundle.css` so Radix's positioned content gets the right z-index + transitions.

## Brand tokens (use these for colors)

The brand is a calm teal anchored on `#02C39A` (bright) and `#028090` (deep). Use these utility classes — they're real, defined in the compiled CSS:

| Family | Range | Use |
|---|---|---|
| `bg-brand-{50,100,200,300,400,500,600,700,800,900}` | full ramp | Backgrounds, accent panels |
| `text-brand-{50..900}` | full ramp | Brand-colored text |
| `border-brand-{50..900}` | full ramp | Brand borders |
| `bg-gradient-brand` | utility | The signature 02C39A → 028090 gradient (used by the default Button variant) |
| `bg-ivory-50` (`#FAF8F3`) | one tone | Soft warm background, alt to white |

The default Button variant already uses `bg-gradient-brand` — for a brand-colored CTA, just use `<Button>` with no `variant`. Use `variant="secondary"`/`"outline"`/`"ghost"` for de-emphasized actions. Use `variant="destructive"` for delete; `variant="success"` for confirm.

## Component vocabulary (real names)

| Component | What it does |
|---|---|
| `Button`, `buttonVariants` | 7 variants (default/secondary/outline/ghost/link/destructive/success), 4 sizes (sm/default/lg/icon). `asChild` via Radix Slot. |
| `Badge`, `badgeVariants` | 4 variants (default/secondary/outline/destructive). Inline pill. |
| `Card` + `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter` | Rounded border + shadow shell. |
| `Input`, `Textarea`, `Label` | Form primitives. `Label` pairs with `htmlFor`. |
| `Select` + `SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`/`SelectGroup`/`SelectLabel` | Radix-based combobox. Closed state shows trigger; open state is portaled. |
| `Tabs` + `TabsList`/`TabsTrigger`/`TabsContent` | `defaultValue` selects initial tab. |
| `Dialog` + `DialogTrigger`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogClose`/`DialogPortal`/`DialogOverlay` | Modal with overlay. Use `DialogTrigger asChild` to wrap a Button. |
| `DropdownMenu` + `DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuLabel`/`DropdownMenuSeparator`/`DropdownMenuGroup`/`DropdownMenuSub`/`DropdownMenuRadioGroup`/`DropdownMenuPortal` | Open-on-click menu. Items: `DropdownMenuItem className="text-red-600"` for destructive. |

## Idiomatic snippet

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button } from '@tarhunna/ui'

export function TodayBookings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's bookings</CardTitle>
        <CardDescription>3 consultations across 2 providers.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-gray-700">
        {/* layout glue uses raw Tailwind utilities; no library wrapper needed */}
        <ul className="space-y-2">
          <li className="flex justify-between"><span>9:00 AM — Botox consult</span><span className="text-gray-500">Sarah Chen</span></li>
        </ul>
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm">View calendar</Button>
      </CardFooter>
    </Card>
  )
}
```

## What NOT to do

- Don't invent new component names — only those above exist on `window.Tarhunna`.
- Don't use color tokens that aren't `brand-*` or `ivory-50` for brand accents. Tailwind's built-in `red-*` / `emerald-*` / `gray-*` are fine for semantic state (destructive / success / neutral) — those are what the components use internally.
- Don't apply structural styles inline as `style={…}` — use Tailwind utility classes; `style` is reserved for dynamic values.
