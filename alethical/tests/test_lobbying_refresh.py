from types import SimpleNamespace
import uuid

from alethical.db.models import SourceRefreshState
from alethical.pipeline import lobbying_refresh as refresh


class DB:
    def __init__(self):
        self.state = SimpleNamespace(token=uuid.uuid4(), progress={})
        self.live = SimpleNamespace(release_id=uuid.uuid4())

    def get(self, model, key, **kwargs):
        return self.state if model == SourceRefreshState else self.live

    def commit(self):
        pass

    def rollback(self):
        pass


def test_failed_purge_retries_the_same_published_release():
    db = DB()

    def failed(_):
        return SimpleNamespace(ok=False, armed=True)

    def good(_):
        return SimpleNamespace(ok=True, armed=True)

    assert not refresh.clear_pending(
        db, name="lobbying", token=db.state.token, target="production", purge=failed
    )
    assert not db.state.progress
    assert refresh.clear_pending(
        db, name="lobbying", token=db.state.token, target="production", purge=good
    )
    assert db.state.progress["cleared_release"] == str(db.live.release_id)


def test_disabled_purge_never_claims_production_copies_cleared():
    db = DB()
    assert not refresh.clear_pending(
        db,
        name="lobbying",
        token=db.state.token,
        target="production",
        purge=lambda _: SimpleNamespace(ok=True, armed=False),
    )
    assert not db.state.progress


def test_generation_change_during_purge_stays_pending():
    db = DB()
    old = db.live.release_id

    def purge(_):
        db.live.release_id = uuid.uuid4()
        return SimpleNamespace(ok=True, armed=True)

    refresh.clear_pending(
        db, name="lobbying", token=db.state.token, target="production", purge=purge
    )
    assert db.state.progress["cleared_release"] == str(old)
    assert db.state.progress["cleared_release"] != str(db.live.release_id)
