# image-band

A Claude Code mod that shows images in a band above the prompt, so you see them instead of a file path.

- Picks up images Claude reads and image paths printed in Bash output.
- Images from the latest turn show side by side; earlier ones shrink to small thumbnails (the 8 newest are kept).
- Click a filename (or press 1–9 with the band focused) to open the image in a sidebar, with Open in Preview and Close.
- JPG, WebP, HEIC and other formats are converted to PNG with macOS `sips`.

Needs macOS and a terminal that draws images: Ghostty, kitty 0.28+, or iTerm2 3.5+ (in fullscreen rendering).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install image-band --marketplace Snoe0/claude-image-band
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install image-band --marketplace Snoe0/claude-image-band
```
