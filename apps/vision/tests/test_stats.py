from app.services.stats import Observation, compute_track_stats


def test_track_stats_are_descriptive_only():
    observations = [
        Observation(7, 0, 0, 1, 2, 10, 20, 0.5),
        Observation(7, 10, 500, 2, 2, 12, 22, 0.7),
        Observation(7, 40, 2000, 3, 4, 14, 24, 0.9),
    ]
    stats = compute_track_stats(observations, sampled_frame_count=10, gap_threshold=750)
    assert len(stats) == 1
    assert stats[0].observation_count == 3
    assert stats[0].observed_duration_ms == 2000
    assert stats[0].average_confidence == 0.7
    assert stats[0].detection_ratio == 0.3
    assert stats[0].gap_count == 1


def test_duplicate_frame_keeps_the_higher_confidence():
    observations = [
        Observation(1, 4, 100, 0, 0, 5, 5, 0.4),
        Observation(1, 4, 100, 1, 1, 6, 6, 0.8),
    ]
    stats = compute_track_stats(observations, sampled_frame_count=4, gap_threshold=750)
    assert stats[0].observation_count == 1
    assert stats[0].average_confidence == 0.8
