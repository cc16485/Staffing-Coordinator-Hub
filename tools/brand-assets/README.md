# Brand assets for the signed PDFs

`build.mjs` reads the three Poppins fonts (SIL Open Font License 1.1, see OFL.txt) and the company logo in this
folder and writes `supabase/functions/_shared/brand-assets.ts` (base64 font data, WinAnsi glyph widths, the logo as
JPEG). The generated file is committed; the signing server reads it, nothing in this folder runs on the server.

Regenerate after changing a font or the logo:

    node tools/brand-assets/build.mjs
