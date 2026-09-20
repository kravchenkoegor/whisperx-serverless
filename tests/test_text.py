from whisper_core.text import collapse_repeats, fmt_srt_ts, fmt_ts, segment_speaker


def test_fmt_srt_ts_keeps_milliseconds():
    assert fmt_srt_ts(3661.5) == "01:01:01,500"
    assert fmt_srt_ts(None) == "00:00:00,000"


def test_fmt_ts_drops_milliseconds():
    assert fmt_ts(3661.5) == "01:01:01"
    assert fmt_ts(None) == "00:00:00"


def test_collapse_repeats_collapses_a_looping_phrase():
    assert collapse_repeats("okay sounds good sounds good sounds good but") == "okay sounds good but"


def test_collapse_repeats_keeps_two_repetitions():
    text = "thank you thank you for coming"
    assert collapse_repeats(text) == text


def test_collapse_repeats_works_on_phrases_of_two_or_more_words():
    text = "no no no no no no"
    assert collapse_repeats(text, min_repeats=3) == "no no"


def test_segment_speaker_prefers_the_explicit_field():
    assert segment_speaker({"speaker": "SPEAKER_01", "words": [{"speaker": "SPEAKER_00"}]}) == "SPEAKER_01"


def test_segment_speaker_falls_back_to_word_majority():
    words = [{"speaker": "SPEAKER_00"}, {"speaker": "SPEAKER_01"}, {"speaker": "SPEAKER_01"}, {}]
    assert segment_speaker({"words": words}) == "SPEAKER_01"
    assert segment_speaker({"words": []}) is None
