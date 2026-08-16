"""Real first-person quotes for the two quote-rich legislators.

Every quote below is a direct quotation attributed to that legislator on
their own official House/Senate profile page (fetched and verified live on
2026-08-15 -- see the URL and date on each entry). No quote is invented, and
none is paraphrased from a news article about the legislator.

Contamination control: exemplar and held-out quotes for the same legislator
always come from two different press releases (different URLs, different
dates), never split out of one document. This is a stronger separation than
picking different sentences from the same release, which risks the two
"separate" pools quietly restating the same rhetorical point. Exemplar
quotes are the only ones the Variant B style block may see; held-out quotes
are reserved for scoring linguistic/style fidelity against real held-out
statements and must never be shown to the model.

Jim Abeler has no entry here at all -- see legislators.py for why his style
corpus is deliberately empty rather than backfilled from a weaker source.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Quote:
    text: str
    source_url: str
    published: str  # ISO date, as shown on the source page


@dataclass(frozen=True)
class StyleCorpus:
    legislator_id: str  # str(uuid) -- matches LegislatorProfile.id
    exemplars: tuple[Quote, ...]
    held_out: tuple[Quote, ...]

    def exemplar_block(self) -> str:
        """Text handed to Variant B as its style reference (see prompts.py)."""
        return "\n".join(f'- "{q.text}"' for q in self.exemplars)


SCHULTZ_QUOTES = StyleCorpus(
    legislator_id="da8ee5cc-0f9d-4854-b5bc-1b0fd8307f78",
    exemplars=(
        Quote(
            text="We demand our money back!",
            source_url="https://www.house.mn.gov/members/profile/news/15597/51584",
            published="2026-02-18",
        ),
        Quote(
            text="The time is now for action on property tax relief.",
            source_url="https://www.house.mn.gov/members/profile/news/15597/51584",
            published="2026-02-18",
        ),
        Quote(
            text="Establishing an Office of the Inspector General is imperative for "
            "deterring future fraud.",
            source_url="https://www.house.mn.gov/members/profile/news/15597/51584",
            published="2026-02-18",
        ),
        Quote(
            text="The passage of state employee accountability measures would go a "
            "long way in reestablishing public trust in government.",
            source_url="https://www.house.mn.gov/members/profile/news/15597/51584",
            published="2026-02-18",
        ),
    ),
    held_out=(
        Quote(
            text="Democrats in the Minnesota Legislature continue to display their "
            "economic illiteracy as they have turned our nearly 20 billion dollar "
            "surplus from last year into an additional 10 billion in new taxes and "
            "now a structural shortfall on the horizon in the next biennium.",
            source_url="https://www.house.mn.gov/members/profile/news/15597/48948",
            published="2023-12-06",
        ),
        Quote(
            text="With record high inflation obliterating family budgets at a cost "
            "of nearly $13,000 per year, this legislature should be focusing on "
            "meaningful tax relief.",
            source_url="https://www.house.mn.gov/members/profile/news/15597/48948",
            published="2023-12-06",
        ),
    ),
)

HOWARD_QUOTES = StyleCorpus(
    legislator_id="498f83f6-5b27-4bab-9b26-464719a46606",
    exemplars=(
        Quote(
            text="Too many Minnesota families are being priced out of the American "
            "Dream by a housing shortage that is worsening by the day.",
            source_url="https://www.house.mn.gov/members/profile/news/15518/40529",
            published="2025-04-29",
        ),
        Quote(
            text="Today's action takes necessary strides to prevent homelessness, "
            "build more homes, and continue to press toward a vision of Minnesota "
            "where everyone can find a safe and affordable home in a community "
            "where they want to live.",
            source_url="https://www.house.mn.gov/members/profile/news/15518/40529",
            published="2025-04-29",
        ),
    ),
    held_out=(
        Quote(
            text="I want to thank Nicole Smith-Holt and the fierce insulin "
            "advocates in Minnesota that fought Big Pharma and won.",
            source_url="https://www.house.mn.gov/members/profile/news/15518/39969",
            published="2025-01-27",
        ),
        Quote(
            text="Every Minnesotan should be able to afford the medications they "
            "need to survive and thrive.",
            source_url="https://www.house.mn.gov/members/profile/news/15518/39969",
            published="2025-01-27",
        ),
    ),
)

STYLE_CORPORA: dict[str, StyleCorpus] = {
    SCHULTZ_QUOTES.legislator_id: SCHULTZ_QUOTES,
    HOWARD_QUOTES.legislator_id: HOWARD_QUOTES,
}


def corpus_for(legislator_id: str) -> StyleCorpus | None:
    return STYLE_CORPORA.get(legislator_id)
