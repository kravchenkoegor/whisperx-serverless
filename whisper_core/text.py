from __future__ import annotations


def fmt_srt_ts(seconds) -> str:
    if seconds is None:
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    s = (total_ms // 1000) % 60
    m = (total_ms // 60000) % 60
    h = total_ms // 3600000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def fmt_ts(seconds) -> str:
    if seconds is None:
        seconds = 0.0
    t = int(round(seconds * 1000))
    return f"{t // 3600000:02d}:{(t // 60000) % 60:02d}:{(t // 1000) % 60:02d}"


def segment_speaker(seg: dict):
    if seg.get("speaker"):
        return seg["speaker"]
    spks = [w.get("speaker") for w in (seg.get("words") or []) if w.get("speaker")]
    if spks:
        return max(set(spks), key=spks.count)
    return None


def collapse_repeats(text: str, min_repeats: int = 3) -> str:
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
