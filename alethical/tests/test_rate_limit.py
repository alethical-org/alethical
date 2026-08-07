from alethical.api.rate_limit import SlidingWindowLimiter


def test_limiter_reports_the_remaining_wait_without_extending_it():
    limiter = SlidingWindowLimiter(max_requests=2, window_seconds=10.0)
    assert limiter.allow("client-a", now=100.0) is True
    assert limiter.allow("client-a", now=100.5) is True

    assert limiter.allow("client-a", now=101.0) is False
    assert limiter.retry_after_seconds("client-a", now=101.0) == 9
    assert limiter.retry_after_seconds("client-a", now=109.9) == 1

    assert limiter.allow("client-a", now=110.0) is True
    assert limiter.retry_after_seconds("client-a", now=110.0) == 1
    assert limiter.retry_after_seconds("client-a", now=110.5) is None
