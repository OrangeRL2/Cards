#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${1:-.}"
PROJECT_DIR="$(realpath "$PROJECT_DIR")"

TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
OUTPUT_DIR="$PROJECT_DIR/collected-js-$TIMESTAMP"
FILES_DIR="$OUTPUT_DIR/files"
COMBINED_FILE="$OUTPUT_DIR/all-js-files.txt"
ARCHIVE_FILE="$PROJECT_DIR/discord-bot-js-$TIMESTAMP.tar.gz"

mkdir -p "$FILES_DIR"
: > "$COMBINED_FILE"

echo "Scanning for JavaScript files in: $PROJECT_DIR"

FILE_COUNT=0

while IFS= read -r -d '' file; do
    relative_path="${file#"$PROJECT_DIR"/}"
    destination="$FILES_DIR/$relative_path"

    mkdir -p "$(dirname "$destination")"
    cp -- "$file" "$destination"

    {
        printf '\n'
        printf '%s\n' \
            '================================================================================'
        printf 'FILE: %s\n' "$relative_path"
        printf '%s\n' \
            '================================================================================'
        printf '\n'
        cat -- "$file"
        printf '\n'
    } >> "$COMBINED_FILE"

    echo "Collected: $relative_path"
    FILE_COUNT=$((FILE_COUNT + 1))
done < <(
    find "$PROJECT_DIR" \
        -type d \( \
            -name node_modules \
            -o -name .git \
            -o -name backups \
            -o -name 'collected-js-*' \
        \) -prune \
        -o -type f -name '*.js' -print0
)

if [[ "$FILE_COUNT" -eq 0 ]]; then
    echo "No JavaScript files were found."
    rm -rf "$OUTPUT_DIR"
    exit 1
fi

tar -czf "$ARCHIVE_FILE" -C "$FILES_DIR" .

echo
echo "Collection complete."
echo "JavaScript files found: $FILE_COUNT"
echo "Combined source file:   $COMBINED_FILE"
echo "Individual files:       $FILES_DIR"
echo "Compressed archive:     $ARCHIVE_FILE"