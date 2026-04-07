"""Parse note data from Xiaohongshu HTML pages (SSR __INITIAL_STATE__).

This module provides an alternative to the feed API for reading notes.
The HTML endpoint embeds note data in a server-rendered `window.__INITIAL_STATE__`
object, which does not require a valid xsec_token to access.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from .exceptions import XhsApiError

logger = logging.getLogger(__name__)

# Regex to extract the __INITIAL_STATE__ JSON blob from the HTML.
_STATE_PATTERN = re.compile(r"window\.__INITIAL_STATE__=({.*?})\s*</script>", re.DOTALL)


def parse_initial_state(html: str) -> dict[str, Any]:
    """Extract and parse `window.__INITIAL_STATE__` from an XHS note page.

    The server-rendered HTML contains a global state object with note data.
    XHS uses bare `undefined` values in the JS object which are not valid JSON,
    so we replace them before parsing.
    """
    match = _STATE_PATTERN.search(html)
    if not match:
        raise XhsApiError("Could not parse __INITIAL_STATE__ from HTML")

    raw = match.group(1)

    # Replace bare `undefined` with empty string (not valid JSON)
    cleaned = re.sub(r":\s*undefined", ':""', raw)
    cleaned = re.sub(r",\s*undefined", ',""', cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise XhsApiError(f"Failed to parse __INITIAL_STATE__ JSON: {exc}") from None


def extract_note_from_state(
    state: dict[str, Any],
    note_id: str,
) -> dict[str, Any]:
    """Extract a single note dict from the parsed __INITIAL_STATE__.

    The state structure is:
        state.note.noteDetailMap[note_id].note -> full note object
    """
    detail_map = state.get("note", {}).get("noteDetailMap", {})
    if not detail_map:
        raise XhsApiError("Note not found in HTML state: empty noteDetailMap")

    # Try exact noteId first, then fall back to first entry
    entry = detail_map.get(note_id)
    if entry is None:
        entry = next(iter(detail_map.values()), None)

    if entry and isinstance(entry, dict) and "note" in entry:
        return entry["note"]

    raise XhsApiError("Note not found in HTML state")


def extract_user_notes_from_state(state: dict[str, Any]) -> dict[str, Any]:
    """Extract notes list from user profile __INITIAL_STATE__.
    
    Returns standard XHS API format: {"notes": [...], "has_more": bool, "cursor": str}
    """
    user_state = state.get("user", {})
    notes_state = user_state.get("notes", {})
    notes: list[dict[str, Any]] = []
    has_more = False
    cursor = ""

    if isinstance(notes_state, dict):
        notes = notes_state.get("notes", []) or []
        has_more = notes_state.get("hasMore", False)
        cursor = notes_state.get("cursor", "")
    elif isinstance(notes_state, list):
        for group in notes_state:
            if isinstance(group, list):
                notes.extend(item for item in group if isinstance(item, dict))
            elif isinstance(group, dict):
                notes.append(group)

    if not notes and "userPageData" in user_state:
        # Fallback for different state versions
        page_data = user_state.get("userPageData", {})
        nested_notes_state = page_data.get("notes", {}) if isinstance(page_data, dict) else {}
        if isinstance(nested_notes_state, dict):
            notes = nested_notes_state.get("notes", []) or []
            has_more = nested_notes_state.get("hasMore", False)
            cursor = nested_notes_state.get("cursor", "")

    normalized_notes = [_normalize_user_page_note(note) for note in notes]
    
    return {
        "notes": [note for note in normalized_notes if note.get("note_card")],
        "has_more": has_more,
        "cursor": cursor
    }


def extract_user_profile_from_state(state: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Extract user profile info from user page __INITIAL_STATE__.

    Returns a shape compatible with the main user profile API:
    {"basic_info": {...}, "interactions": [...], "user_id": "..."}
    """
    user_state = state.get("user", {})
    page_data = user_state.get("userPageData", {})
    basic_info = page_data.get("basicInfo", {}) if isinstance(page_data, dict) else {}
    interactions = page_data.get("interactions", []) if isinstance(page_data, dict) else []
    tags = page_data.get("tags", []) if isinstance(page_data, dict) else []

    if not isinstance(basic_info, dict):
        basic_info = {}
    if not isinstance(interactions, list):
        interactions = []
    if not isinstance(tags, list):
        tags = []

    return {
        "user_id": user_id,
        "basic_info": {
            "user_id": user_id,
            "nickname": basic_info.get("nickname", ""),
            "desc": basic_info.get("desc", ""),
            "imageb": basic_info.get("imageb", ""),
            "images": basic_info.get("images", ""),
            "red_id": basic_info.get("redId", basic_info.get("red_id", "")),
            "gender": basic_info.get("gender"),
            "ip_location": basic_info.get("ipLocation", basic_info.get("ip_location", "")),
        },
        "interactions": interactions,
        "tags": tags,
    }


def _normalize_user_page_note(note: dict[str, Any]) -> dict[str, Any]:
    note_card = note.get("noteCard", {})
    cover = note_card.get("cover", {})
    user = note_card.get("user", {})
    interact = note_card.get("interactInfo", {})

    if not isinstance(note_card, dict):
        return {}

    return {
        "id": note.get("id", note_card.get("noteId", "")),
        "note_id": note_card.get("noteId", note.get("id", "")),
        "xsec_token": note.get("xsecToken", note_card.get("xsecToken", "")),
        "note_card": {
            "display_title": note_card.get("displayTitle", ""),
            "type": note_card.get("type", ""),
            "liked_count": interact.get("likedCount", note_card.get("likedCount", "")),
            "cover": {
                "url_default": cover.get("urlDefault", cover.get("url", "")),
                "height": cover.get("height", 0),
                "width": cover.get("width", 0),
            },
            "user": {
                "nickname": user.get("nickname", user.get("nickName", "")),
                "avatar": user.get("avatar", ""),
                "user_id": user.get("userId", user.get("user_id", "")),
                "xsec_token": note.get("xsecToken", note_card.get("xsecToken", "")),
            },
            "interact_info": {
                "liked_count": interact.get("likedCount", ""),
            },
        },
    }


def extract_note_from_html(html: str, note_id: str) -> dict[str, Any]:
    """High-level: parse HTML → extract note in one step."""
    state = parse_initial_state(html)
    return extract_note_from_state(state, note_id)
