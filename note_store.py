import copy
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from uuid import uuid4

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATETIME_FORMAT = "%Y-%m-%d %H:%M:%S"
CODE_FENCE_PATTERN = re.compile(r"```(?P<language>[^\n`]*)\n(?P<code>[\s\S]*?)```", re.MULTILINE)


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _now_str() -> str:
    return datetime.now().strftime(DATETIME_FORMAT)


def _display_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _note_path(note_id: str) -> Path:
    return DATA_DIR / f"{note_id}.json"


def _load_note_file(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _serialize_note_for_storage(note: dict) -> dict:
    """
    Serialize note to disk with a stable/minimal storage shape.

    We intentionally drop `versions[].blocks` to keep storage size bounded, since
    the UI and restore flow only require `versions[].document` + metadata.
    """
    storage_note = copy.deepcopy(note)
    for version in storage_note.get("versions", []) or []:
        version.pop("blocks", None)
    return storage_note


def _write_note_file(note: dict) -> None:
    _ensure_data_dir()
    target_path = _note_path(note["id"])

    # Best-effort backup to reduce the chance of losing data.
    if target_path.exists():
        backup_path = Path(str(target_path) + ".bak")
        try:
            shutil.copy2(target_path, backup_path)
        except OSError:
            # Backup failure should not block the actual write.
            pass

    tmp_path = target_path.with_name(
        f"{target_path.stem}.tmp_{uuid4().hex[:8]}{target_path.suffix}"
    )
    try:
        storage_note = _serialize_note_for_storage(note)
        with tmp_path.open("w", encoding="utf-8") as file:
            json.dump(storage_note, file, ensure_ascii=False, indent=2)
        # Atomic on Windows when source and target are on the same filesystem.
        tmp_path.replace(target_path)
    finally:
        # If replace() failed, clean up best-effort.
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _new_block_id() -> str:
    return f"block_{uuid4().hex[:8]}"


def _new_version_id() -> str:
    return f"version_{uuid4().hex[:8]}"


def _normalize_language(language: str | None) -> str:
    normalized = (language or "").strip().lower()
    if normalized == "js":
        return "javascript"
    return normalized


def _normalize_document(document: str | None) -> str:
    return (document or "").replace("\r\n", "\n").replace("\r", "\n")


def _normalize_title(title: str | None, fallback: str | None = None) -> str:
    candidate = (title or "").strip()
    if candidate:
        return candidate
    if fallback:
        return fallback
    return f"未命名笔记-{_display_timestamp()}"


def _normalize_blocks(blocks: list[dict] | None) -> list[dict]:
    normalized_blocks = []
    for block in blocks or []:
        block_type = block.get("type", "text")
        if block_type not in {"text", "code"}:
            block_type = "text"

        normalized_block = {
            "id": block.get("id") or _new_block_id(),
            "type": block_type,
            "content": _normalize_document(block.get("content", "")),
        }
        if block_type == "code":
            language = _normalize_language(block.get("language"))
            if language:
                normalized_block["language"] = language

        normalized_blocks.append(normalized_block)

    if normalized_blocks:
        return normalized_blocks

    return [{"id": _new_block_id(), "type": "text", "content": ""}]


def blocks_to_document(blocks: list[dict] | None) -> str:
    parts = []
    for block in _normalize_blocks(blocks):
        if block["type"] == "code":
            language = block.get("language", "")
            header = f"```{language}" if language else "```"
            parts.append(f"{header}\n{block.get('content', '')}\n```")
            continue

        content = block.get("content", "")
        if content:
            parts.append(content)

    return "\n\n".join(parts)


def document_to_blocks(document: str | None) -> list[dict]:
    normalized_document = _normalize_document(document)
    if not normalized_document.strip():
        return [{"id": _new_block_id(), "type": "text", "content": ""}]

    blocks = []
    cursor = 0
    for match in CODE_FENCE_PATTERN.finditer(normalized_document):
        text_segment = normalized_document[cursor : match.start()]
        if text_segment.strip():
            blocks.append(
                {
                    "id": _new_block_id(),
                    "type": "text",
                    "content": text_segment.strip("\n"),
                }
            )

        code_block = {
            "id": _new_block_id(),
            "type": "code",
            "content": match.group("code").rstrip("\n"),
        }
        language = _normalize_language(match.group("language"))
        if language:
            code_block["language"] = language
        blocks.append(code_block)
        cursor = match.end()

    trailing_text = normalized_document[cursor:]
    if trailing_text.strip():
        blocks.append(
            {
                "id": _new_block_id(),
                "type": "text",
                "content": trailing_text.strip("\n"),
            }
        )

    if blocks:
        return blocks

    return [{"id": _new_block_id(), "type": "text", "content": ""}]


def _normalize_version(raw_version: dict) -> dict:
    document = raw_version.get("document")
    blocks = raw_version.get("blocks")

    normalized_document = _normalize_document(document) if document is not None else None
    # Treat `document` as source of truth when present; otherwise derive from blocks.
    if normalized_document is not None:
        normalized_blocks = document_to_blocks(normalized_document)
        normalized_document_final = normalized_document
    else:
        normalized_blocks = _normalize_blocks(blocks)
        normalized_document_final = blocks_to_document(normalized_blocks)

    normalized_version = {
        "id": raw_version.get("id") or _new_version_id(),
        "time": raw_version.get("time") or _now_str(),
        "title": _normalize_title(raw_version.get("title")),
        "document": normalized_document_final,
        "blocks": normalized_blocks,
    }
    if raw_version.get("restored_from"):
        normalized_version["restored_from"] = raw_version["restored_from"]
    return normalized_version


def _default_note() -> dict:
    now = _now_str()
    return {
        "id": f"note_{uuid4().hex[:8]}",
        "title": f"未命名笔记-{_display_timestamp()}",
        "document": "",
        "blocks": [{"id": _new_block_id(), "type": "text", "content": ""}],
        "versions": [],
        "created_at": now,
        "updated_at": now,
    }


def _version_snapshot(note: dict, restored_from: str | None = None) -> dict:
    snapshot = {
        "id": _new_version_id(),
        "time": _now_str(),
        "title": note["title"],
        "document": note.get("document") or blocks_to_document(note.get("blocks")),
    }
    if restored_from:
        snapshot["restored_from"] = restored_from
    return snapshot


def _normalize_note(raw_note: dict) -> dict:
    document = raw_note.get("document")
    blocks = raw_note.get("blocks")

    normalized_document = _normalize_document(document) if document is not None else None
    # Treat `document` as source of truth when present; otherwise derive from blocks.
    if normalized_document is not None:
        normalized_blocks = document_to_blocks(normalized_document)
        normalized_document_final = normalized_document
    else:
        normalized_blocks = _normalize_blocks(blocks)
        normalized_document_final = blocks_to_document(normalized_blocks)

    return {
        "id": raw_note["id"],
        "title": _normalize_title(raw_note.get("title")),
        "document": normalized_document_final,
        "blocks": normalized_blocks,
        "versions": [_normalize_version(version) for version in raw_note.get("versions", [])],
        "created_at": raw_note.get("created_at") or _now_str(),
        "updated_at": raw_note.get("updated_at") or _now_str(),
    }


def list_notes() -> list[dict]:
    _ensure_data_dir()
    notes = []
    for path in DATA_DIR.glob("*.json"):
        note = _normalize_note(_load_note_file(path))
        notes.append(
            {
                "id": note["id"],
                "title": note["title"],
                "created_at": note["created_at"],
                "updated_at": note["updated_at"],
                "version_count": len(note.get("versions", [])),
            }
        )

    return sorted(notes, key=lambda item: item["updated_at"], reverse=True)


def create_note() -> dict:
    note = _default_note()
    _write_note_file(note)
    return note


def get_note(note_id: str) -> dict:
    path = _note_path(note_id)
    if not path.exists():
        raise FileNotFoundError(f"Note not found: {note_id}")
    return _normalize_note(_load_note_file(path))


def save_note(note_id: str, payload: dict) -> dict:
    existing = get_note(note_id)
    document = payload.get("document")
    if document is None and payload.get("blocks") is not None:
        blocks = _normalize_blocks(payload.get("blocks"))
        document = blocks_to_document(blocks)
    elif document is None:
        document = existing.get("document", "")

    normalized_document = _normalize_document(document)
    updated_note = {
        "id": note_id,
        "title": _normalize_title(payload.get("title"), existing["title"]),
        "document": normalized_document,
        "blocks": document_to_blocks(normalized_document),
        "versions": list(existing.get("versions", [])),
        "created_at": existing["created_at"],
        "updated_at": _now_str(),
    }
    updated_note["versions"].append(_version_snapshot(updated_note))
    _write_note_file(updated_note)
    return _normalize_note(updated_note)


def restore_version(note_id: str, version_id: str) -> dict:
    note = get_note(note_id)
    version = next((item for item in note.get("versions", []) if item.get("id") == version_id), None)
    if version is None:
        raise FileNotFoundError(f"Version not found: {version_id}")

    restored_document = _normalize_document(version.get("document"))
    note["title"] = _normalize_title(version.get("title"), note["title"])
    note["document"] = restored_document or blocks_to_document(version.get("blocks"))
    note["blocks"] = document_to_blocks(note["document"])
    note["updated_at"] = _now_str()
    note["versions"].append(_version_snapshot(note, restored_from=version_id))
    _write_note_file(note)
    return _normalize_note(note)


def delete_version(note_id: str, version_id: str) -> dict:
    note = get_note(note_id)
    remaining_versions = [version for version in note.get("versions", []) if version.get("id") != version_id]
    if len(remaining_versions) == len(note.get("versions", [])):
        raise FileNotFoundError(f"Version not found: {version_id}")

    note["versions"] = remaining_versions
    _write_note_file(note)
    return _normalize_note(note)


def delete_note(note_id: str) -> None:
    path = _note_path(note_id)
    if not path.exists():
        raise FileNotFoundError(f"Note not found: {note_id}")
    path.unlink()
