# Fonts

The UI is set in **Apercu** (Thin), the house face requested for the redesign.
Apercu is a commercial typeface and its files are **not** committed here.

To enable it, drop the licensed web font into this folder:

```
public/fonts/Apercu-Thin.woff2
```

That filename is already referenced by the `@font-face` rule in
`app/globals.css` — no code change is needed; the font takes over on the next
reload.

Until the file is present, the app falls back to **Inter** (loaded via
`next/font`, light weights), so nothing breaks and the thin, minimalist look is
preserved.

Have more weights licensed? Add the files here and append matching `@font-face`
blocks in `app/globals.css` (e.g. `Apercu-Regular.woff2` at `font-weight: 400`,
`Apercu-Medium.woff2` at `500`).
