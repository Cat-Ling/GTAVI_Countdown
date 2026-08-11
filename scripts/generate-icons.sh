#!/bin/bash
# ═══════════════════════════════════════════════════════
# GTA VI Countdown — Icon Generation Script
# ═══════════════════════════════════════════════════════
# Generates all PWA icons from the source logo.png
# Uses ImageMagick's convert and montage commands.
#
# Usage: bash scripts/generate-icons.sh
# ═══════════════════════════════════════════════════════

set -euo pipefail

LOGO="logo.png"
ICONS_DIR="public/icons"
SPLASH_DIR="public/splash"
BG_COLOR="#2D1B3D"

# Create output directories
mkdir -p "$ICONS_DIR" "$SPLASH_DIR"

echo "→ Generating transparent icons..."

# Standard favicon sizes (transparent background)
for SIZE in 16 32 48; do
  convert "$LOGO" -resize "${SIZE}x${SIZE}" -gravity center -background none -extent "${SIZE}x${SIZE}" \
    "$ICONS_DIR/favicon-${SIZE}x${SIZE}.png"
  echo "  ✓ favicon-${SIZE}x${SIZE}.png"
done

# PWA icon sizes (transparent background)
for SIZE in 48 72 96 128 144 152 192 384 512; do
  convert "$LOGO" -resize "${SIZE}x${SIZE}" -gravity center -background none -extent "${SIZE}x${SIZE}" \
    "$ICONS_DIR/icon-${SIZE}x${SIZE}.png"
  echo "  ✓ icon-${SIZE}x${SIZE}.png"
done

echo "→ Generating icons with background..."

# Apple Touch Icon (180x180 with solid background — iOS doesn't support transparency)
APPLE_INNER=140  # Logo fits within this box, with padding
convert "$LOGO" -resize "${APPLE_INNER}x${APPLE_INNER}" -gravity center \
  -background "$BG_COLOR" -extent "180x180" \
  "$ICONS_DIR/apple-touch-icon.png"
cp "$ICONS_DIR/apple-touch-icon.png" "$ICONS_DIR/apple-touch-icon-precomposed.png"
echo "  ✓ apple-touch-icon.png (180x180)"

# Maskable icon (512x512, logo in 80% safe zone)
# Safe zone = inner 80% = 410x410 area centered in 512x512
MASKABLE_INNER=360  # Logo fits in the safe zone with some margin
convert "$LOGO" -resize "${MASKABLE_INNER}x${MASKABLE_INNER}" -gravity center \
  -background "$BG_COLOR" -extent "512x512" \
  "$ICONS_DIR/maskable-icon-512x512.png"
echo "  ✓ maskable-icon-512x512.png"

# Microsoft tile (150x150)
MSTILE_INNER=110
convert "$LOGO" -resize "${MSTILE_INNER}x${MSTILE_INNER}" -gravity center \
  -background "$BG_COLOR" -extent "150x150" \
  "$ICONS_DIR/mstile-150x150.png"
echo "  ✓ mstile-150x150.png"

echo "→ Generating favicon.ico (multi-size)..."

# Combine 16, 32, 48 into a single ICO file
convert "$ICONS_DIR/favicon-16x16.png" "$ICONS_DIR/favicon-32x32.png" "$ICONS_DIR/favicon-48x48.png" \
  "$ICONS_DIR/favicon.ico"
echo "  ✓ favicon.ico"

# Copy 192x192 as the root favicon
cp "$ICONS_DIR/icon-192x192.png" "public/favicon.png"
echo "  ✓ favicon.png (192x192)"

echo "→ Generating iOS splash screens..."

# iOS splash screens from the artwork
ARTWORK="artwork.jpg"

# Generate splash screens for all required iOS sizes
# Each is cropped from the center of the artwork with the deep plum overlay
SPLASH_SIZES=(
  "750x1334"
  "828x1792"
  "1125x2436"
  "1170x2532"
  "1179x2556"
  "1242x2688"
  "1284x2778"
  "1290x2796"
  "1536x2048"
  "1668x2388"
  "2048x2732"
)

for DIMS in "${SPLASH_SIZES[@]}"; do
  WIDTH="${DIMS%x*}"
  HEIGHT="${DIMS#*x}"

  # Resize artwork to cover the splash dimensions, then crop to exact size
  # Add a semi-transparent overlay for branding consistency
  convert "$ARTWORK" \
    -resize "${WIDTH}x${HEIGHT}^" \
    -gravity center \
    -extent "${WIDTH}x${HEIGHT}" \
    -brightness-contrast -20x-10 \
    \( -size "${WIDTH}x${HEIGHT}" xc:"rgba(45,27,61,0.65)" \) \
    -composite \
    "$SPLASH_DIR/splash-${DIMS}.png"

  echo "  ✓ splash-${DIMS}.png"
done

echo ""
echo "✅ All icons and splash screens generated!"
echo "   Icons: $(ls -1 $ICONS_DIR | wc -l) files"
echo "   Splash: $(ls -1 $SPLASH_DIR | wc -l) files"
