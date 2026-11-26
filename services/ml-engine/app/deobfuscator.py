"""
Adversarial De-obfuscation & Prompt-Injection Guard (PhishTank-NS).

Neutralizes three classes of adversarial attacks before neural/symbolic inference:
1. CSS Visibility-Aware DOM Poisoning (display:none, visibility:hidden, opacity:0,
   font-size:0, off-screen absolute positioning, matching foreground/background colors).
2. Unicode UTS #39 Homoglyphs & Zero-Width Character Obfuscation.
3. Embedded LLM Prompt-Injection Payloads.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import List, Tuple
from bs4 import BeautifulSoup, Tag

# Zero-width & invisible formatting characters commonly used to break tokenizers
ZERO_WIDTH_CHARS = re.compile(
    r"[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]"
)

# Subset of Unicode UTS #39 confusables (Cyrillic, Greek, Mathematical Alphanumerics -> ASCII)
CONFUSABLES_MAP = str.maketrans({
    # Cyrillic lowercase & uppercase
    "\u0430": "a", "\u0410": "A",
    "\u0435": "e", "\u0415": "E",
    "\u043E": "o", "\u041E": "O",
    "\u0440": "p", "\u0420": "P",
    "\u0441": "c", "\u0421": "C",
    "\u0443": "y", "\u0423": "Y",
    "\u0445": "x", "\u0425": "X",
    "\u0456": "i", "\u0406": "I",
    "\u0458": "j", "\u0408": "J",
    "\u043A": "k", "\u041A": "K",
    "\u043C": "m", "\u041C": "M",
    "\u043D": "h", "\u041D": "H",
    "\u0442": "t", "\u0422": "T",
    "\u0432": "b", "\u0412": "B",
    "\u0455": "s", "\u0405": "S",
    "\u0501": "d", "\u051B": "q",
    # Greek confusables
    "\u03B1": "a", "\u0391": "A",
    "\u03B2": "b", "\u0392": "B",
    "\u03B5": "e", "\u0395": "E",
    "\u03B6": "z", "\u0396": "Z",
    "\u03B7": "n", "\u0397": "H",
    "\u03B9": "i", "\u0399": "I",
    "\u03BA": "k", "\u039A": "K",
    "\u03BC": "m", "\u039C": "M",
    "\u03BD": "v", "\u039D": "N",
    "\u03BF": "o", "\u039F": "O",
    "\u03C1": "p", "\u03A1": "P",
    "\u03C4": "t", "\u03A4": "T",
    "\u03C5": "u", "\u03A5": "Y",
    "\u03C7": "x", "\u03A7": "X",
    # Fullwidth / common Latin lookalikes
    "\u0131": "i", "\u0237": "j",
    "\uFF41": "a", "\uFF45": "e", "\uFF49": "i", "\uFF4F": "o", "\uFF55": "u",
})

# CSS patterns indicating hidden decoy nodes
HIDDEN_CSS_PATTERNS = [
    re.compile(r"display\s*:\s*none", re.I),
    re.compile(r"visibility\s*:\s*hidden", re.I),
    re.compile(r"opacity\s*:\s*0(?:\.0+)?(?:\s*;|$)", re.I),
    re.compile(r"font-size\s*:\s*0(?:px|pt|em|rem|%)?", re.I),
    re.compile(r"(?:width|height)\s*:\s*0(?:px)?\s*;.*overflow\s*:\s*hidden", re.I),
    re.compile(r"text-indent\s*:\s*-\d{3,}", re.I),
    re.compile(r"left\s*:\s*-\d{3,}", re.I),
]

# Prompt-injection patterns embedded in emails to manipulate LLM/AI scanners
PROMPT_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?", re.I),
    re.compile(r"(?:system|assistant)\s*(?:prompt|override|instruction)\s*:", re.I),
    re.compile(r"classify\s+(?:this|the)\s+email\s+as\s+(?:benign|safe|clean|legitimate)", re.I),
    re.compile(r"output\s+(?:score|verdict)\s*[:=]\s*(?:0|clean|benign|safe)", re.I),
    re.compile(r"you\s+are\s+now\s+(?:in\s+)?developer\s+mode", re.I),
]


@dataclass
class DeobfuscationResult:
    visible_text: str
    hidden_text_removed: str
    hidden_node_count: int
    obfuscation_ratio: float
    zero_width_count: int
    homoglyph_count: int
    prompt_injection_hits: List[str] = field(default_factory=list)
    adversarial_flags: List[str] = field(default_factory=list)


def _is_hidden_style(style_attr: str) -> bool:
    if not style_attr:
        return False
    return any(p.search(style_attr) for p in HIDDEN_CSS_PATTERNS)


def normalize_unicode_confusables(text: str) -> Tuple[str, int, int]:
    """
    Strips zero-width characters, applies NFKC normalization, and maps
    UTS #39 homoglyphs back to canonical ASCII.
    Returns (normalized_text, zero_width_count, homoglyph_count).
    """
    zw_matches = ZERO_WIDTH_CHARS.findall(text)
    zw_count = len(zw_matches)
    cleaned = ZERO_WIDTH_CHARS.sub("", text)
    cleaned = unicodedata.normalize("NFKC", cleaned)

    homoglyph_count = 0
    out_chars: List[str] = []
    for ch in cleaned:
        mapped = ch.translate(CONFUSABLES_MAP)
        if mapped != ch:
            homoglyph_count += 1
        out_chars.append(mapped)

    return "".join(out_chars), zw_count, homoglyph_count


def deobfuscate_email(plain_text: str = "", html_body: str = "", subject: str = "") -> DeobfuscationResult:
    """
    Extracts human-visible text from HTML/plain email bodies while stripping
    hidden CSS decoy elements, normalizing homoglyphs, and flagging prompt injections.
    """
    hidden_chunks: List[str] = []
    hidden_node_count = 0

    if html_body and html_body.strip():
        soup = BeautifulSoup(html_body, "html.parser")

        # Remove script/style/noscript metadata tags first
        for tag in soup(["script", "style", "head", "meta", "link"]):
            tag.decompose()

        # Detect and strip CSS-hidden adversarial decoy elements
        for tag in list(soup.find_all(True)):
            if not isinstance(tag, Tag):
                continue
            style = tag.get("style", "") or ""
            is_hidden_attr = tag.has_attr("hidden") or (
                str(tag.get("aria-hidden", "")).lower() == "true" and not tag.find("svg")
            )
            if is_hidden_attr or _is_hidden_style(str(style)):
                hidden_txt = tag.get_text(" ", strip=True)
                if hidden_txt:
                    hidden_chunks.append(hidden_txt)
                    hidden_node_count += 1
                tag.decompose()

        extracted_visible = soup.get_text(" ", strip=True)
        # Fallback if HTML had no visible body text
        if not extracted_visible and plain_text:
            extracted_visible = plain_text
    else:
        extracted_visible = plain_text or ""

    combined_raw = f"{subject or ''} {extracted_visible}".strip()
    hidden_joined = " ".join(hidden_chunks).strip()

    # Check prompt injection across BOTH visible and hidden text
    full_inspect_surface = f"{combined_raw} {hidden_joined}"
    prompt_hits: List[str] = []
    for pat in PROMPT_INJECTION_PATTERNS:
        m = pat.search(full_inspect_surface)
        if m:
            prompt_hits.append(m.group(0))

    # Normalize Unicode zero-width & homoglyph obfuscation
    normalized_visible, zw_count, homoglyph_count = normalize_unicode_confusables(combined_raw)
    normalized_visible = re.sub(r"\s+", " ", normalized_visible).strip()

    visible_len = max(1, len(normalized_visible))
    hidden_len = len(hidden_joined)
    obfuscation_ratio = round(min(1.0, hidden_len / (visible_len + hidden_len)), 4) if hidden_len > 0 else 0.0

    flags: List[str] = []
    if hidden_node_count > 0 and hidden_len > 10:
        flags.append("CSS_HIDDEN_TEXT_POISONING")
    if zw_count >= 3:
        flags.append("ZERO_WIDTH_OBFUSCATION")
    if homoglyph_count >= 2:
        flags.append("UNICODE_HOMOGLYPH_SPOOFING")
    if prompt_hits:
        flags.append("LLM_PROMPT_INJECTION_ATTEMPT")

    return DeobfuscationResult(
        visible_text=normalized_visible,
        hidden_text_removed=hidden_joined[:500],
        hidden_node_count=hidden_node_count,
        obfuscation_ratio=obfuscation_ratio,
        zero_width_count=zw_count,
        homoglyph_count=homoglyph_count,
        prompt_injection_hits=prompt_hits,
        adversarial_flags=flags,
    )
