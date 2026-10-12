from app.services.timestamps import assign_timestamps, gap_threshold_ms


def test_decoder_pts_are_rounded_without_using_sample_fps():
    timestamps, method, uncertainty, _warnings = assign_timestamps([0.0, 0.0333, 0.0666], 30)
    assert method == "decoder_pts"
    assert uncertainty == 1
    assert timestamps == [0, 33, 67]


def test_missing_pts_falls_back_to_nominal_fps():
    timestamps, method, uncertainty, warnings = assign_timestamps([0.0, None, 0.066], 30)
    assert method == "nominal_fps_fallback"
    assert timestamps == [0, 33, 67]
    assert uncertainty == 33
    assert warnings


def test_regressive_pts_falls_back():
    timestamps, method, _uncertainty, _warnings = assign_timestamps([0.2, 0.1], 10)
    assert method == "nominal_fps_fallback"
    assert timestamps == [0, 100]


def test_gap_threshold_matches_the_documented_formula():
    assert gap_threshold_ms(3, 2) == 750
