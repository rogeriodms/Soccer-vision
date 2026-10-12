from app.services.sampling import select_sample_indices


def test_sampling_keeps_order_and_targets_three_fps():
    timestamps = [index * 33 for index in range(30)]
    selected = select_sample_indices(timestamps, 3)
    assert selected[0] == 0
    assert selected == sorted(selected)
    assert len(selected) == len(set(selected))
    assert 3 <= len(selected) <= 4


def test_sampling_does_not_burst_after_a_gap():
    selected = select_sample_indices([0, 10, 500, 510], 2)
    assert selected == [0, 2]


def test_sampling_rejects_non_positive_rate():
    try:
        select_sample_indices([0], 0)
    except ValueError:
        return
    raise AssertionError("sample_fps inválido deveria falhar")
