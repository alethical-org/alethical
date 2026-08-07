from alethical.api.routers.public import authored_issue_areas


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class _Session:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, _statement):
        return _Rows(self.rows)


def test_authored_issue_areas_ranks_distinct_bills_and_breaks_ties_alphabetically():
    legislator_id = "legislator-1"
    result = authored_issue_areas(
        _Session(
            [
                (
                    legislator_id,
                    "bill-1",
                    {
                        "policy_areas": [
                            "transportation",
                            "health",
                            "healthcare",
                            "housing",
                        ]
                    },
                ),
                (
                    legislator_id,
                    "bill-2",
                    {"policy_areas": ["transportation", "health", "housing"]},
                ),
                (
                    legislator_id,
                    "bill-3",
                    {"policy_areas": ["transportation", "education"]},
                ),
                (legislator_id, "bill-4", {"policy_areas": ["education"]}),
            ]
        ),
        [legislator_id],
    )

    assert result == {
        legislator_id: ["Transportation", "Education", "Health", "Housing"]
    }
