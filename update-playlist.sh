#!/bin/bash
# ═══════════════════════════════════════════════════════
# GTA VI COUNTDOWN — Audio Playlist Auto-Updater
# ═══════════════════════════════════════════════════════
# Scans the public/audio/aac folder for new music tracks
# and automatically appends them to playlist.json with 
# their exact duration, without wiping existing custom titles.

AUDIO_DIR="public/audio/aac"
PLAYLIST_FILE="public/audio/playlist.json"

# Move to the project root directory
cd "$(dirname "$0")" || exit 1

if [ ! -f "$PLAYLIST_FILE" ]; then
    echo "Error: $PLAYLIST_FILE not found!"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: 'jq' is not installed. Please install jq to run this script."
    exit 1
fi

if ! command -v ffprobe &> /dev/null; then
    echo "Error: 'ffprobe' is not installed. Please install ffmpeg to run this script."
    exit 1
fi

echo "Scanning $AUDIO_DIR for new audio files..."

# Find all audio files in the folder (m4a, mp3, aac, flac, wav)
shopt -s nullglob
for file in "$AUDIO_DIR"/*.{m4a,mp3,aac,flac,wav}; do
    FILENAME=$(basename "$file")
    FILEPATH="/audio/aac/$FILENAME"
    
    # Check if this exact file is already in the playlist array
    EXISTS=$(jq --arg filepath "$FILEPATH" 'any(.playlist[]; .file == $filepath)' "$PLAYLIST_FILE")
    
    if [ "$EXISTS" == "true" ]; then
        continue
    fi
    
    # Generate clean title (remove extension, replace underscores with spaces)
    TITLE="${FILENAME%.*}"
    TITLE="${TITLE//_/ }"

    # Get accurate duration using ffprobe
    DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file")
    
    if [ -z "$DURATION" ]; then
        echo "Warning: Could not extract duration for $FILENAME"
        continue
    fi
    
    # Format duration to 3 decimal places for JSON
    DURATION=$(printf "%.3f" "$DURATION")

    # Append to the playlist array in the JSON file
    jq --arg title "$TITLE" \
       --arg filepath "$FILEPATH" \
       --argjson duration "$DURATION" \
       '.playlist += [{"title": $title, "file": $filepath, "duration": $duration}]' "$PLAYLIST_FILE" > "${PLAYLIST_FILE}.tmp" && mv "${PLAYLIST_FILE}.tmp" "$PLAYLIST_FILE"
    
    echo "🎵 Added new track: '$TITLE' (${DURATION}s)"
done

echo "✅ Playlist update complete!"
