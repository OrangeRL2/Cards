#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import hashlib
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

from PIL import Image
import UnityPy
import UnityPy.config

HOME = Path.home()
BASE = HOME / "testholo"

TOOLS = next(
    (p for p in (
        BASE / "holodori-asset-tools",
        HOME / "holodori-asset-tools",
    ) if p.exists()),
    BASE / "holodori-asset-tools",
)

# Prefer the English DB for card metadata because it may publish new
# Card.json rows before the Japanese diff repository. Fall back to JP.
DB = next(
    (p for p in (
        BASE / "holodori-db-eng-diff",
        HOME / "holodori" / "holodori-db-eng-diff",
        HOME / "holodori-db-eng-diff",
        BASE / "holodori-db-jpn-diff",
        HOME / "holodori-db-jpn-diff",
    ) if p.exists()),
    BASE / "holodori-db-eng-diff",
)

BOT = HOME / "4newCards" / "Cards"
CATALOG = BOT / ".guess-updater" / "octo_list.json"

RAW_CARDS = BASE / "all-cards-raw"
RAW_SIGS = BASE / "card-signatures-raw"
EXTRACTED_SIGS = BASE / "card-signatures-extracted"
CORRECTED = BASE / "corrected-card-images"
SIG_LAYERS = BASE / "card-signature-images"
SIGNED = BASE / "signed-card-images"
ORGANIZED = BASE / "organized-card-images"
STATE_FILE = BASE / "holodori-update-state.json"
LOG_FILE = BASE / "holodori-update.log"

UNITY_VERSION = "6000.3.15f1"
SCRIPT_VERSION = 6
TARGET_SIZE = (1820, 1024)
RARITY_DIRS = {3: "★★★", 4: "★★★★", 5: "★★★★★"}


def log(message: str = "") -> None:
    print(message, flush=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(message + "\n")


def run(command: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    log("$ " + " ".join(map(str, command)))
    return subprocess.run(command, cwd=cwd, check=check, text=True)


def capture(command: list[str], cwd: Path | None = None) -> str:
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def require_layout() -> None:
    missing = [p for p in (TOOLS, DB, CATALOG) if not p.exists()]
    if missing:
        raise SystemExit("Missing required path(s): " + ", ".join(map(str, missing)))
    for command in ("git", "holodori", "ffmpeg"):
        if shutil.which(command) is None:
            raise SystemExit(f"Required command not found: {command}")


def git_update(repo: Path) -> tuple[str, str]:
    before = capture(["git", "rev-parse", "HEAD"], cwd=repo)
    run(["git", "pull", "--ff-only"], cwd=repo)
    after = capture(["git", "rev-parse", "HEAD"], cwd=repo)
    return before, after


def count_files(directory: Path, pattern: str = "*") -> int:
    return sum(1 for p in directory.rglob(pattern) if p.is_file()) if directory.exists() else 0


def download_assets() -> None:
    RAW_CARDS.mkdir(parents=True, exist_ok=True)
    RAW_SIGS.mkdir(parents=True, exist_ok=True)

    run([
        "holodori", "download", str(RAW_CARDS),
        "--filter", "^img_card_full_",
        "--no-overwrite",
        "--catalog", str(CATALOG),
    ], cwd=TOOLS)

    run([
        "holodori", "download", str(RAW_SIGS),
        "--filter", "^mov_card_sign_",
        "--workers", "1",
        "--no-overwrite",
        "--catalog", str(CATALOG),
    ], cwd=TOOLS)


def extract_signature_streams() -> None:
    resources = RAW_SIGS / "resources"
    if not resources.exists():
        log("No signature resources directory found; skipping signature extraction.")
        return
    EXTRACTED_SIGS.mkdir(parents=True, exist_ok=True)
    run(["holodori", "extract", str(resources), str(EXTRACTED_SIGS)], cwd=TOOLS)


def export_cards() -> int:
    source = RAW_CARDS / "assetbundles"
    CORRECTED.mkdir(parents=True, exist_ok=True)
    UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    exported = 0
    failures = 0

    bundles = sorted(p for p in source.glob("img_card_full_*") if p.is_file())
    log(f"Card bundles found: {len(bundles)}")

    for index, bundle in enumerate(bundles, 1):
        prefix = bundle.name
        existing = list(CORRECTED.glob(f"{prefix}_*.png"))
        if existing:
            continue
        try:
            env = UnityPy.load(str(bundle))
            for obj in env.objects:
                if obj.type.name not in {"Texture2D", "Sprite"}:
                    continue
                data = obj.parse_as_object()
                image = data.image.convert("RGBA")
                image = image.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
                destination = CORRECTED / f"{prefix}_{obj.path_id}.png"
                image.save(destination)
                exported += 1
                log(f"Card [{index}/{len(bundles)}]: {destination.name}")
        except Exception as exc:
            failures += 1
            log(f"CARD FAILED {bundle.name}: {exc}")

    log(f"New corrected cards: {exported}; card failures: {failures}")
    return exported


def export_signature_layers() -> int:
    SIG_LAYERS.mkdir(parents=True, exist_ok=True)
    exported = 0

    folders = sorted(p for p in EXTRACTED_SIGS.iterdir() if p.is_dir()) if EXTRACTED_SIGS.exists() else []
    for folder in folders:
        destination = SIG_LAYERS / f"{folder.name}.png"
        if destination.exists():
            continue

        color_stream = folder / "sfv_ch0"
        alpha_stream = folder / "alp_ch0"
        if not color_stream.exists() or not alpha_stream.exists():
            log(f"SIGNATURE STREAMS MISSING: {folder.name}")
            continue

        with tempfile.TemporaryDirectory() as temp_name:
            temp = Path(temp_name)
            color_dir = temp / "color"
            alpha_dir = temp / "alpha"
            color_dir.mkdir()
            alpha_dir.mkdir()

            run(["ffmpeg", "-loglevel", "error", "-f", "h264", "-i", str(color_stream), str(color_dir / "%06d.png")])
            run(["ffmpeg", "-loglevel", "error", "-f", "mpegvideo", "-i", str(alpha_stream), str(alpha_dir / "%06d.png")])

            colors = sorted(color_dir.glob("*.png"))
            alphas = sorted(alpha_dir.glob("*.png"))
            usable = min(len(colors), len(alphas))
            chosen = None

            for frame_index in range(usable - 1, -1, -1):
                with Image.open(alphas[frame_index]) as alpha_test:
                    if alpha_test.convert("L").getbbox() is not None:
                        chosen = max(0, frame_index - 10)
                        break

            if chosen is None:
                log(f"NO VISIBLE SIGNATURE FRAME: {folder.name}")
                continue

            with Image.open(colors[chosen]) as color_image, Image.open(alphas[chosen]) as alpha_image:
                result = color_image.convert("RGBA")
                result.putalpha(alpha_image.convert("L"))
                result.save(destination)

            exported += 1
            log(f"Signature layer: {destination.name}")

    log(f"New signature layers: {exported}")
    return exported


def build_signed_cards() -> int:
    SIGNED.mkdir(parents=True, exist_ok=True)
    created = 0

    for signature_path in sorted(SIG_LAYERS.glob("mov_card_sign_*.png")):
        asset_id = signature_path.stem.removeprefix("mov_card_sign_")
        card_candidates = sorted(CORRECTED.glob(f"img_card_full_{asset_id}_*.png"))
        if not card_candidates:
            log(f"MATCHING CARD MISSING FOR SIGNATURE: {asset_id}")
            continue

        destination = SIGNED / f"img_card_full_{asset_id}_signed.png"
        if destination.exists() and destination.stat().st_mtime >= max(signature_path.stat().st_mtime, card_candidates[0].stat().st_mtime):
            continue

        with Image.open(card_candidates[0]) as card_image, Image.open(signature_path) as signature_image:
            card = card_image.convert("RGBA")
            signature = signature_image.convert("RGBA")
            if signature.size != card.size:
                signature = signature.resize(card.size, Image.Resampling.LANCZOS)
            Image.alpha_composite(card, signature).save(destination)

        created += 1
        log(f"Signed card: {destination.name}")

    log(f"New or refreshed signed cards: {created}")
    return created


def load_database() -> tuple[dict[str, str], list[dict]]:
    characters = json.loads((DB / "Character.json").read_text(encoding="utf-8"))
    cards = json.loads((DB / "Card.json").read_text(encoding="utf-8"))
    names = {
        record["data"]["id"]: record["data"]["shortNameEng"]
        for record in characters
        if record.get("data", {}).get("isPlayable") and record["data"].get("shortNameEng")
    }
    return names, cards


def prepare_output_dirs() -> None:
    ORGANIZED.mkdir(parents=True, exist_ok=True)

    for legacy_name in ("Unsigned", "Signed", "Signatures"):
        legacy = ORGANIZED / legacy_name
        if legacy.exists():
            shutil.rmtree(legacy)

    folders = [
        *RARITY_DIRS.values(),
        "All Card Images",
        "All Signed Card Images",
        "All Signatures Only",
    ]

    for folder in folders:
        root = ORGANIZED / folder
        if root.exists():
            shutil.rmtree(root)
        root.mkdir(parents=True, exist_ok=True)


def organize() -> tuple[int, int]:
    names, cards = load_database()
    prepare_output_dirs()

    rows = []
    for record in cards:
        data = record["data"]
        member = names.get(data.get("characterId"))
        if not member:
            continue
        try:
            rarity = int(data["rarity"].rsplit("_", 1)[-1])
        except (KeyError, ValueError):
            continue
        if rarity not in RARITY_DIRS:
            continue

        rows.append({
            "member": member,
            "rarity": rarity,
            "asset_id": data["assetId"],
            "order": data.get("order", 999999),
        })

    rows.sort(key=lambda r: (
        r["rarity"],
        r["member"].casefold(),
        r["order"],
        r["asset_id"],
    ))

    rarity_counters = defaultdict(int)
    all_unsigned_counters = defaultdict(int)
    all_signed_counters = defaultdict(int)
    all_signature_counters = defaultdict(int)
    copied = 0
    missing = 0
    manifest = []

    for row in rows:
        member = row["member"]
        rarity = row["rarity"]
        asset_id = row["asset_id"]
        rarity_folder = RARITY_DIRS[rarity]
        rarity_key = (member, rarity)

        unsigned_candidates = sorted(CORRECTED.glob(f"img_card_full_{asset_id}_*.png"))
        signed_candidates = sorted(SIGNED.glob(f"img_card_full_{asset_id}_signed.png"))
        signature_candidates = sorted(SIG_LAYERS.glob(f"mov_card_sign_{asset_id}.png"))

        # Preserve the user's existing 001/002 naming behavior:
        # unsigned first, then matching signed card immediately after it.
        if unsigned_candidates:
            rarity_counters[rarity_key] += 1
            rarity_sequence = rarity_counters[rarity_key]
            rarity_name = f"{member} {rarity_sequence:03d}.png"
            shutil.copy2(unsigned_candidates[0], ORGANIZED / rarity_folder / rarity_name)

            all_unsigned_counters[rarity_key] += 1
            all_name = f"{member} {rarity_folder} {all_unsigned_counters[rarity_key]:03d}.png"
            shutil.copy2(unsigned_candidates[0], ORGANIZED / "All Card Images" / all_name)

            copied += 1
            manifest.append([
                member, rarity, rarity_sequence, asset_id,
                "unsigned", rarity_name, all_name,
            ])
        else:
            missing += 1
            log(f"MISSING UNSIGNED CARD: {asset_id}")

        if signed_candidates:
            rarity_counters[rarity_key] += 1
            rarity_sequence = rarity_counters[rarity_key]
            rarity_name = f"{member} {rarity_sequence:03d}.png"
            shutil.copy2(signed_candidates[0], ORGANIZED / rarity_folder / rarity_name)

            all_signed_counters[rarity_key] += 1
            signed_name = f"{member} {rarity_folder} {all_signed_counters[rarity_key]:03d}.png"
            shutil.copy2(signed_candidates[0], ORGANIZED / "All Signed Card Images" / signed_name)

            if signature_candidates:
                all_signature_counters[rarity_key] += 1
                signature_name = f"{member} {rarity_folder} {all_signature_counters[rarity_key]:03d}.png"
                shutil.copy2(signature_candidates[0], ORGANIZED / "All Signatures Only" / signature_name)

            copied += 1
            manifest.append([
                member, rarity, rarity_sequence, asset_id,
                "signed", rarity_name, signed_name,
            ])

    with (ORGANIZED / "manifest.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "member", "rarity", "sequence", "asset_id",
            "type", "rarity_filename", "collection_filename",
        ])
        writer.writerows(manifest)

    log(f"Organized images copied: {copied}; missing unsigned: {missing}")
    return copied, missing


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def database_card_ids() -> set[str]:
    cards = json.loads((DB / "Card.json").read_text(encoding="utf-8"))
    return {
        record["data"]["assetId"]
        for record in cards
        if record.get("data", {}).get("assetId")
    }


def existing_card_ids() -> set[str]:
    result = set()
    prefix = "img_card_full_"
    for path in CORRECTED.glob(f"{prefix}*.png") if CORRECTED.exists() else []:
        name = path.name
        if not name.startswith(prefix):
            continue
        marker = "-00_"
        if marker in name:
            result.add(name[len(prefix):name.index(marker) + 3])
    return result


def cards_need_refresh(previous_state: dict, current_hash: str) -> tuple[bool, list[str]]:
    current_ids = database_card_ids()
    existing_ids = existing_card_ids()
    missing_ids = sorted(current_ids - existing_ids)

    previous_hash = previous_state.get("card_database_sha256")
    if previous_hash == current_hash and not missing_ids:
        return False, []

    if previous_hash is None and not missing_ids:
        return False, []

    return True, missing_ids


def save_state(tool_before: str, tool_after: str, db_before: str, db_after: str, card_hash: str) -> None:
    state = {
        "script_version": SCRIPT_VERSION,
        "asset_tools_before": tool_before,
        "asset_tools_after": tool_after,
        "database_before": db_before,
        "database_after": db_after,
        "card_database_sha256": card_hash,
        "raw_card_bundles": count_files(RAW_CARDS / "assetbundles"),
        "raw_signature_files": count_files(RAW_SIGS / "resources"),
        "corrected_cards": count_files(CORRECTED, "*.png"),
        "signature_layers": count_files(SIG_LAYERS, "*.png"),
        "signed_cards": count_files(SIGNED, "*.png"),
        "organized_images": count_files(ORGANIZED, "*.png"),
    }
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def main() -> None:
    require_layout()
    LOG_FILE.write_text("", encoding="utf-8")
    log("Holodori card update check started")

    previous_state = load_state()

    log(f"Card metadata DB: {DB}")
    tool_before, tool_after = git_update(TOOLS)
    db_before, db_after = git_update(DB)

    card_hash = file_sha256(DB / "Card.json")
    needs_refresh, missing_ids = cards_need_refresh(previous_state, card_hash)

    log(f"Asset tools changed: {tool_before != tool_after}")
    log(f"Database repository changed: {db_before != db_after}")

    if not needs_refresh:
        layout_is_current = (
            previous_state.get("script_version") == SCRIPT_VERSION
            and not any((ORGANIZED / name).exists() for name in ("Unsigned", "Signed", "Signatures"))
            and all((ORGANIZED / name).is_dir() for name in (
                "★★★", "★★★★", "★★★★★",
                "All Card Images", "All Signed Card Images", "All Signatures Only",
            ))
        )

        if not layout_is_current:
            log("No new cards, but folder layout needs migration. Reorganizing existing images.")
            organize()

        save_state(tool_before, tool_after, db_before, db_after, card_hash)
        log("No card differences available. No card assets were downloaded.")
        return

    if missing_ids:
        log(f"New or missing card records detected: {len(missing_ids)}")
        for asset_id in missing_ids:
            log(f"  {asset_id}")
    else:
        log("Card.json changed. Refreshing card assets and organization.")

    if tool_before != tool_after:
        log("Asset tools repository changed; refreshing editable installation.")
        run([sys.executable, "-m", "pip", "install", "-e", "."], cwd=TOOLS)

    download_assets()
    extract_signature_streams()
    export_cards()
    export_signature_layers()
    build_signed_cards()
    organize()
    save_state(tool_before, tool_after, db_before, db_after, card_hash)
    log("Card update complete")
    log(f"Open: {ORGANIZED}")


if __name__ == "__main__":
    main()
