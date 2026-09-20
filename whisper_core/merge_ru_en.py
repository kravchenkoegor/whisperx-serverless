"""Merge the Russian and English WhisperX passes of one mixed RU/EN recording into one timeline.

The forced language does not fix the output language: WhisperX decodes ~30 s chunks, and a chunk
that starts in Russian stays Russian in both passes, translating any English inside it (and vice
versa). So neither pass is reliably in its own language, and the language is decided per speaker
turn instead:
  * Units = pyannote turns; same-speaker turns closer than merge_gap are joined, each unit
    capped at max_unit seconds (the window Whisper's language ID looks at).
  * Every unit gets Whisper language ID on its own audio, restricted to ru vs en.
  * A unit's language is the first rule that applies:
      1. lid      confident language ID on a unit of at least min_lid_sec;
      2. script   a pass wrote the other language's alphabet (Cyrillic in the EN pass means
                  Russian was heard, Latin in the RU pass means English), without contradiction;
      3. speaker  the speaker's language over their confident units, if one-sided;
      4. neighbor the nearest confidently identified unit;
      5. argmax   raw language-ID probability.
  * Text: words whose midpoint falls inside the unit, from whichever pass wrote them in the
    unit's alphabet, own pass first. English text must be free of Cyrillic (any Cyrillic there
    is a translation); Russian text may carry Latin terms. If neither pass fits, the unit was
    translated in both: units of at least min_lid_sec are re-transcribed alone with the right
    language and the prompt's sentences in that language; shorter ones keep their own pass.
  * Prompt-echo segments are dropped and repetition loops collapsed.
Greedy decoding and argmax only: the same inputs always give the same output.
"""
from __future__ import annotations

import bisect
import json
import math
import re
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .text import collapse_repeats, fmt_ts

SAMPLE_RATE = 16000
TOKEN = re.compile(r"\w+")
LATIN = re.compile(r"[A-Za-z]")
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
OTHER = {"RU": "EN", "EN": "RU"}


@dataclass(frozen=True)
class RuEnConfig:
    merge_gap: float = 1.0
    max_unit: float = 30.0
    min_lid_sec: float = 1.5
    lid_confident: float = 0.80
    cyrillic_min: float = 0.25
    latin_min: float = 0.75
    en_max_cyrillic: float = 0.02
    speaker_one_sided: float = 0.85
    echo_ngram: int = 5
    prompt_echo_thresh: float = 0.50


@dataclass
class MergeStats:
    units: int
    turns: int
    langs: Counter
    rules: Counter
    sources: Counter
    speaker_en_shares: dict[str, float]
    lid_computed: int
    redecoded: int


class _Context:
    def __init__(
        self,
        cfg: RuEnConfig,
        prompt: str,
        audio: Path | None,
        whisper: Callable[[], object] | None,
        lid_cache: Path,
        redecode_cache: Path,
    ):
        self.cfg = cfg
        self.prompt = prompt
        self.lid_cache = lid_cache
        self.redecode_cache = redecode_cache
        self.lid_computed = 0
        self.redecoded = 0
        self._audio = audio
        self._whisper = whisper
        self._samples = None

    def whisper(self):
        if self._whisper is None:
            raise RuntimeError("a Whisper model is needed for language ID / re-decoding")
        return self._whisper()

    def samples(self):
        if self._samples is None:
            if self._audio is None or not Path(self._audio).is_file():
                raise FileNotFoundError(
                    f"No such file: {self._audio} (needed for language ID / re-decoding)"
                )
            from faster_whisper import decode_audio

            self._samples = decode_audio(str(self._audio), sampling_rate=SAMPLE_RATE)
        return self._samples

    def unit_audio(self, u: dict):
        return self.samples()[int(u["start"] * SAMPLE_RATE):int(u["end"] * SAMPLE_RATE)]


def tokens(text: str) -> list[str]:
    return TOKEN.findall(text.lower())


def prompt_ngrams(prompt: str, cfg: RuEnConfig) -> set[tuple[str, ...]]:
    ws = tokens(prompt)
    n = cfg.echo_ngram
    return {tuple(ws[i:i + n]) for i in range(len(ws) - n + 1)}


def is_prompt_echo(text: str, ngrams: set[tuple[str, ...]], cfg: RuEnConfig) -> bool:
    ws = tokens(text)
    n = cfg.echo_ngram
    if len(ws) < n:
        return False
    covered = [False] * len(ws)
    for i in range(len(ws) - n + 1):
        if tuple(ws[i:i + n]) in ngrams:
            covered[i:i + n] = [True] * n
    return sum(covered) / len(ws) >= cfg.prompt_echo_thresh


def script(text: str, cfg: RuEnConfig) -> str | None:
    letters = sum(1 for c in text if c.isalpha())
    if letters < 2:
        return None
    if len(CYRILLIC.findall(text)) / letters >= cfg.cyrillic_min:
        return "RU"
    if len(LATIN.findall(text)) / letters >= cfg.latin_min:
        return "EN"
    return None


def fits(text: str, lang: str, cfg: RuEnConfig) -> bool:
    letters = sum(1 for c in text if c.isalpha())
    if letters < 2:
        return False
    cyrillic = len(CYRILLIC.findall(text)) / letters
    if lang == "RU":
        return cyrillic >= cfg.cyrillic_min
    return cyrillic <= cfg.en_max_cyrillic and len(LATIN.findall(text)) / letters >= cfg.latin_min


def heard_from_script(ru_text: str, en_text: str, cfg: RuEnConfig) -> str | None:
    ru_script, en_script = script(ru_text, cfg), script(en_text, cfg)
    if ru_script == "EN":
        return None if en_script == "RU" else "EN"
    if en_script == "RU":
        return "RU"
    return None


def finite(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


def segment_words(seg: dict) -> list[dict]:
    seg_start = seg.get("start") if finite(seg.get("start")) else 0.0
    seg_end = seg.get("end") if finite(seg.get("end")) else seg_start
    words = [w for w in seg.get("words") or [] if (w.get("word") or "").strip()]
    if not words:
        text = collapse_repeats((seg.get("text") or "").strip())
        return [{"start": seg_start, "end": seg_end, "text": text}] if text else []
    out, t = [], seg_start
    for w in words:
        start, end = w.get("start"), w.get("end")
        if not (finite(start) and finite(end)):
            start = end = t
        t = end
        out.append({"start": start, "end": end, "text": w["word"].strip()})
    return out


def load_words(path: Path, ngrams: set[tuple[str, ...]], cfg: RuEnConfig) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    words: list[dict] = []
    for seg in data.get("segments", []):
        if not is_prompt_echo(seg.get("text") or "", ngrams, cfg):
            words += segment_words(seg)
    return words


def build_units(turns: list[dict], cfg: RuEnConfig) -> list[dict]:
    joined: list[dict] = []
    for t in sorted(turns, key=lambda t: (t["start"], t["end"])):
        last = joined[-1] if joined else None
        if (
            last
            and last["speaker"] == t["speaker"]
            and t["start"] - last["end"] < cfg.merge_gap
            and max(last["end"], t["end"]) - last["start"] <= cfg.max_unit
        ):
            last["end"] = max(last["end"], t["end"])
        else:
            joined.append({"start": t["start"], "end": t["end"], "speaker": t["speaker"]})
    units: list[dict] = []
    for u in joined:
        n = max(1, math.ceil((u["end"] - u["start"]) / cfg.max_unit))
        step = (u["end"] - u["start"]) / n
        units += [
            {**u, "start": u["start"] + i * step, "end": u["start"] + (i + 1) * step}
            for i in range(n)
        ]
    return units


def assign_text(words: list[dict], units: list[dict], cfg: RuEnConfig) -> list[str]:
    starts = [u["start"] for u in units]
    buckets: list[list[dict]] = [[] for _ in units]
    for w in words:
        mid = (w["start"] + w["end"]) / 2
        lo = max(0, bisect.bisect_left(starts, mid - cfg.max_unit) - 1)
        hi = min(len(units), bisect.bisect_right(starts, mid) + 1)

        def rank(j: int, mid: float = mid) -> tuple[float, int]:
            u = units[j]
            return max(0.0, u["start"] - mid, mid - u["end"]), j

        buckets[min(range(lo, hi), key=rank)].append(w)
    return [" ".join(w["text"] for w in sorted(b, key=lambda w: w["start"])) for b in buckets]


def unit_key(u: dict) -> str:
    return f"{u['start']:.3f}-{u['end']:.3f}"


def load_cache(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def detect_languages(units: list[dict], ctx: _Context) -> dict[str, dict[str, float]]:
    cache = load_cache(ctx.lid_cache)
    missing = [u for u in units if unit_key(u) not in cache]
    if not missing:
        return cache
    print(f"[*] language ID for {len(missing)} units…")
    for u in missing:
        clip = ctx.unit_audio(u)
        probs: dict[str, float] = {}
        if len(clip) >= SAMPLE_RATE // 10:
            _, _, all_probs = ctx.whisper().detect_language(audio=clip)
            probs = {lang: float(p) for lang, p in all_probs}
        cache[unit_key(u)] = {"ru": probs.get("ru", 0.0), "en": probs.get("en", 0.0)}
    ctx.lid_cache.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    ctx.lid_computed = len(missing)
    return cache


def prompt_in(lang: str, ctx: _Context) -> str | None:
    sentences = [s for s in SENTENCE_END.split(ctx.prompt) if script(s, ctx.cfg) == lang]
    return " ".join(sentences) or None


def redecode(jobs: list[tuple[dict, str]], ctx: _Context) -> dict[str, str]:
    cache = load_cache(ctx.redecode_cache)
    missing = [(u, lang) for u, lang in jobs if f"{unit_key(u)}|{lang}" not in cache]
    if not missing:
        return cache
    print(f"[*] re-transcribing {len(missing)} units translated in both passes…")
    for u, lang in missing:
        segments, _ = ctx.whisper().transcribe(
            ctx.unit_audio(u),
            language=lang.lower(),
            task="transcribe",
            beam_size=5,
            temperature=0.0,
            condition_on_previous_text=False,
            initial_prompt=prompt_in(lang, ctx),
            without_timestamps=True,
            vad_filter=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        cache[f"{unit_key(u)}|{lang}"] = collapse_repeats(text)
    ctx.redecode_cache.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    ctx.redecoded = len(missing)
    return cache


def en_share(probs: dict[str, float]) -> float:
    total = probs["ru"] + probs["en"]
    return probs["en"] / total if total > 0 else 0.5


def speaker_en_shares(units: list[dict]) -> dict[str, float]:
    en, total = defaultdict(float), defaultdict(float)
    for u in units:
        if u.get("rule") == "lid":
            dur = u["end"] - u["start"]
            total[u["speaker"]] += dur
            if u["lang"] == "EN":
                en[u["speaker"]] += dur
    return {s: en[s] / total[s] for s in total if total[s] > 0}


def decide(units: list[dict], cfg: RuEnConfig) -> dict[str, float]:
    for u in units:
        if u["end"] - u["start"] < cfg.min_lid_sec:
            continue
        if u["p_en"] >= cfg.lid_confident:
            u["lang"], u["rule"] = "EN", "lid"
        elif u["p_en"] <= 1 - cfg.lid_confident:
            u["lang"], u["rule"] = "RU", "lid"

    shares = speaker_en_shares(units)
    confident = [u for u in units if u.get("rule") == "lid"]
    confident_mids = [(u["start"] + u["end"]) / 2 for u in confident]
    one_sided = cfg.speaker_one_sided

    for u in units:
        if u.get("rule"):
            continue
        heard = heard_from_script(u["texts"]["RU"], u["texts"]["EN"], cfg)
        share = shares.get(u["speaker"])
        if heard:
            u["lang"], u["rule"] = heard, "script"
        elif share is not None and (share >= one_sided or share <= 1 - one_sided):
            u["lang"], u["rule"] = ("EN" if share >= one_sided else "RU"), "speaker"
        elif confident:
            mid = (u["start"] + u["end"]) / 2
            i = bisect.bisect_left(confident_mids, mid)
            near = min(
                (j for j in (i - 1, i) if 0 <= j < len(confident)),
                key=lambda j: (abs(confident_mids[j] - mid), j),
            )
            u["lang"], u["rule"] = confident[near]["lang"], "neighbor"
        else:
            u["lang"], u["rule"] = ("EN" if u["p_en"] >= 0.5 else "RU"), "argmax"
    return shares


def needs_redecode(u: dict, cfg: RuEnConfig) -> bool:
    lang, texts = u["lang"], u["texts"]
    return (
        not fits(texts[lang], lang, cfg)
        and not fits(texts[OTHER[lang]], lang, cfg)
        and bool(texts[lang] or texts[OTHER[lang]])
        and u["end"] - u["start"] >= cfg.min_lid_sec
    )


def pick_text(units: list[dict], ctx: _Context) -> None:
    cfg = ctx.cfg
    redecoded = redecode([(u, u["lang"]) for u in units if needs_redecode(u, cfg)], ctx)
    for u in units:
        lang, texts = u["lang"], u["texts"]
        if fits(texts[lang], lang, cfg):
            u["text"], u["source"] = texts[lang], lang.lower()
        elif fits(texts[OTHER[lang]], lang, cfg):
            u["text"], u["source"] = texts[OTHER[lang]], OTHER[lang].lower()
        elif needs_redecode(u, cfg):
            u["text"], u["source"] = redecoded[f"{unit_key(u)}|{lang}"], "redecode"
        else:
            u["text"], u["source"] = texts[lang], lang.lower()
            u["lang"] = script(texts[lang], cfg) or lang


def write_merged(units: list[dict], out: Path) -> int:
    lines: list[str] = []
    cur = None

    def flush(turn):
        text = collapse_repeats(" ".join(turn["parts"]))
        lines.extend([f"[{turn['speaker']} {fmt_ts(turn['start'])} | {turn['lang']}]", text, ""])

    turns = 0
    for u in units:
        if not u["text"]:
            continue
        if cur and cur["speaker"] == u["speaker"] and cur["lang"] == u["lang"]:
            cur["parts"].append(u["text"])
            continue
        if cur:
            flush(cur)
        cur = {"speaker": u["speaker"], "start": u["start"], "lang": u["lang"], "parts": [u["text"]]}
        turns += 1
    if cur:
        flush(cur)
    out.write_text("\n".join(lines), encoding="utf-8")
    return turns


def merge_ru_en(
    *,
    ru_json: Path,
    en_json: Path,
    diarization_json: Path,
    out: Path,
    lid_cache: Path,
    redecode_cache: Path,
    prompt_text: str = "",
    audio: Path | None = None,
    whisper: Callable[[], object] | None = None,
    cfg: RuEnConfig | None = None,
) -> MergeStats:
    cfg = cfg or RuEnConfig()
    for path in (ru_json, en_json, diarization_json):
        if not path.is_file():
            raise FileNotFoundError(f"No such file: {path}")
    turns = json.loads(diarization_json.read_text(encoding="utf-8"))
    if not turns:
        raise ValueError(f"{diarization_json.name} has no speaker turns")

    ctx = _Context(cfg, prompt_text.strip(), audio, whisper, lid_cache, redecode_cache)
    ngrams = prompt_ngrams(ctx.prompt, cfg)
    units = build_units(turns, cfg)
    ru_texts = assign_text(load_words(ru_json, ngrams, cfg), units, cfg)
    en_texts = assign_text(load_words(en_json, ngrams, cfg), units, cfg)
    lid = detect_languages(units, ctx)
    for u, ru_text, en_text in zip(units, ru_texts, en_texts, strict=True):
        u["texts"] = {"RU": ru_text, "EN": en_text}
        u["p_en"] = en_share(lid[unit_key(u)])

    shares = decide(units, cfg)
    pick_text(units, ctx)
    n_turns = write_merged(units, out)

    spoken = [u for u in units if u["text"]]
    return MergeStats(
        units=len(spoken),
        turns=n_turns,
        langs=Counter(u["lang"] for u in spoken),
        rules=Counter(u["rule"] for u in spoken),
        sources=Counter(u["source"] for u in spoken),
        speaker_en_shares=shares,
        lid_computed=ctx.lid_computed,
        redecoded=ctx.redecoded,
    )
