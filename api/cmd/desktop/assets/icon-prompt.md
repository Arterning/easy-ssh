# EasySSH icon

Generated using the built-in image_gen tool. Transparent PNG source: `icon.png`.

## Prompt

Use case: logo-brand. Asset type: production Windows desktop application icon for EasySSH, a local SSH terminal and database client. Create one polished standalone app icon, square composition, transparent outside the icon. A deep midnight-blue rounded-square tile with subtly beveled edges and restrained depth, containing a large crisp ivory terminal chevron and short cursor, combined with a single elegant turquoise connection link stroke. Bold simple silhouette, balanced generous interior spacing, excellent legibility at 24px and 32px. Contemporary professional developer tool aesthetic, softly luminous teal accent, extremely restrained gradients, precise geometric proportions, front view. Only the terminal glyph, no words or letters, no mockup, no scenery, no surrounding shadows, no watermark. Fill about 90 percent of square canvas with the rounded-square tile; transparent corners.

## Windows resources

From `api`, run `go generate ./cmd/desktop` to regenerate `assets/icon.ico` and the Windows amd64/arm64 `.syso` files. The ICO contains 16, 20, 24, 32, 40, 48, 64, 128 and 256 pixel images. Commit the generated resources alongside the source so normal builds do not need the generator.

The Windows icon group uses resource ID 32512, matching the icon loaded by Wails for the native window. `application.Options.Icon` also embeds the PNG for other platforms.
