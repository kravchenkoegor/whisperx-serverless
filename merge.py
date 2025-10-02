#!/usr/bin/env python3
"""Deterministically merge the English and Korean WhisperX passes into one timeline.

Reads <STEM>.en.json (diarized English pass) and <STEM>.ko.json (Korean pass) and writes
<STEM>.merged.txt: one chronological transcript where each region is shown in the language
actually spoken — English from the EN pass, Korean (original) from the KO pass — with
speaker labels carried over from the EN diarization.

No translation, no model, no randomness: pure rule-based selection, so the same inputs
always produce the same output. Run:  python merge.py

How a region's language is decided (deterministic):
  * EN segment is kept as English when its text is mostly Latin AND is not a regurgitation
    of the initial_prompt (prompt-echo is Whisper's hallucination on Korean/uncertain audio).
  * Everywhere the EN pass produced prompt-echo or Hangul, the region counts as Korean, and
    we take the time-overlapping Korean text from the KO pass instead.
  * Immediate repetition loops are collapsed (same rule as transcribe.py).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ---- CONFIG ----------------------------------------------------------------------
STEM = "meeting"                                 # base name, without .en / .ko
EN_JSON = HERE / f"{STEM}.en.json"
KO_JSON = HERE / f"{STEM}.ko.json"
PROMPT_FILE = HERE / "prompts/korean_meeting.txt"  # to detect prompt-echo hallucinations
OUT = HERE / f"{STEM}.merged.txt"

ENGLISH_MAX_HANGUL = 0.30   # EN seg counts as English if hangul ratio below this
KOREAN_MIN_HANGUL = 0.50    # KO seg counts as Korean content if hangul ratio above this
PROMPT_ECHO_THRESH = 0.80   # EN seg is prompt-echo if >=80% of its words are prompt words
KO_MAX_EN_OVERLAP = 0.50    # drop KO seg if it overlaps English regions by more than this
# ----------------------------------------------------------------------------------

HANGUL = re.compile(r"[가-힣]")
WORD = re.compile(r"[a-zA-Z]+")


def fmt_ts(seconds) -> str:
    if seconds is None:
        seconds = 0.0
    t = int(round(seconds * 1000))
    return f"{t // 3600000:02d}:{(t // 60000) % 60:02d}:{(t // 1000) % 60:02d}"


def collapse_repeats(text: str, min_repeats: int = 3) -> str:
    """Collapse a phrase (>=2 words) immediately repeated >=min_repeats times to one."""
    words = text.split()
    n = len(words)
    if n < 2 * min_repeats:
        return text
    out: list[str] = []
    i = 0
    while i < n:
        done = False
        for p in range((n - i) // min_repeats, 1, -1):
            block = words[i:i + p]
            reps, j = 1, i + p
            while j + p <= n and words[j:j + p] == block:
                reps += 1
                j += p
            if reps >= min_repeats:
                out.extend(block)
                i = j
                done = True
                break
        if not done:
            out.append(words[i])
            i += 1
    return " ".join(out)


def hangul_ratio(text: str) -> float:
    letters = sum(1 for c in text if c.isalpha())
    return len(HANGUL.findall(text)) / letters if letters else 0.0


def is_prompt_echo(text: str, prompt_words: set[str]) -> bool:
    ws = [w.lower() for w in WORD.findall(text)]
    if len(ws) < 4:
        return False
    return sum(1 for w in ws if w in prompt_words) / len(ws) >= PROMPT_ECHO_THRESH


def seg_speaker(seg: dict):
    if seg.get("speaker"):
        return seg["speaker"]
    spks = [w.get("speaker") for w in (seg.get("words") or []) if w.get("speaker")]
    return max(set(spks), key=spks.count) if spks else None


def overlap(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def load_segments(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    segs = []
    for s in data.get("segments", []):
        text = collapse_repeats((s.get("text") or "").strip())
        if not text:
            continue
        segs.append({"start": s.get("start") or 0.0, "end": s.get("end") or 0.0,
                     "text": text, "speaker": seg_speaker(s)})
    return segs


def main() -> int:
    prompt_words = {w.lower() for w in WORD.findall(PROMPT_FILE.read_text(encoding="utf-8"))}
    en = load_segments(EN_JSON)
    ko = load_segments(KO_JSON)

    # 1) English-spoken regions = EN segments that are Latin and not prompt-echo.
    chosen: list[dict] = []
    english_intervals: list[tuple[float, float]] = []
    for s in en:
        if hangul_ratio(s["text"]) < ENGLISH_MAX_HANGUL and not is_prompt_echo(s["text"], prompt_words):
            chosen.append({**s, "lang": "EN"})
            english_intervals.append((s["start"], s["end"]))

    # 2) Korean-spoken regions = KO segments that are Hangul and don't sit on English regions.
    #    Speaker is carried over from whichever EN segment overlaps them in time.
    for s in ko:
        if hangul_ratio(s["text"]) < KOREAN_MIN_HANGUL:
            continue
        dur = max(1e-6, s["end"] - s["start"])
        en_overlap = sum(overlap(s["start"], s["end"], a, b) for a, b in english_intervals)
        if en_overlap / dur > KO_MAX_EN_OVERLAP:
            continue
        best_spk, best_ov = None, 0.0
        for e in en:
            ov = overlap(s["start"], s["end"], e["start"], e["end"])
            if ov > best_ov:
                best_ov, best_spk = ov, e["speaker"]
        chosen.append({**s, "speaker": best_spk, "lang": "KO"})

    # 3) Sort by time, group consecutive same-speaker same-language turns, write out.
    chosen.sort(key=lambda s: s["start"])
    lines: list[str] = []
    cur = None

    def flush(turn):
        # collapse repeats again on the JOINED turn to catch loops split across segments
        text = collapse_repeats(" ".join(turn["parts"]))
        lines.extend([f"[{turn['speaker']} {fmt_ts(turn['start'])} | {turn['lang']}]", text, ""])

    for s in chosen:
        spk = s["speaker"] or "SPEAKER_?"
        if cur and cur["speaker"] == spk and cur["lang"] == s["lang"]:
            cur["parts"].append(s["text"])
        else:
            if cur:
                flush(cur)
            cur = {"speaker": spk, "start": s["start"], "lang": s["lang"], "parts": [s["text"]]}
    if cur:
        flush(cur)

    OUT.write_text("\n".join(lines), encoding="utf-8")
    n_en = sum(1 for s in chosen if s["lang"] == "EN")
    n_ko = sum(1 for s in chosen if s["lang"] == "KO")
    print(f"[✓] {OUT.name}: {n_en} English + {n_ko} Korean segments, "
          f"{len([l for l in lines if l.startswith('[')])} turns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
