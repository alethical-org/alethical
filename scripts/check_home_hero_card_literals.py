"""Verify every bill fact the signed-out Home hero card states in app code.

The hero card (``AnswerCard`` in
``apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx``) is a designed
teaser for one enacted law, HF 4138, and it writes that law's facts as literals:
the signing date, the effective date, the chief author, both chamber vote
totals, and three excerpts quoted from the enacted text. That is deliberate -
the card's wording and its three quoted passages are editorial choices no API
response can make (the lasting behavior is recorded in
``docs/product-onboarding/home-screen-guide.md``).

The risk a literal carries is silence: if the record is corrected, the homepage
keeps stating the old fact and nothing in the product looks wrong (#1444). So
this check reads the card's own literals out of the TSX and confirms each one
against the published record, and the workflow that runs it
(``.github/workflows/home-hero-card-facts.yml``) files an issue when one drifts.

It fails in two directions on purpose:

* a literal the record no longer supports - the card is stating something stale;
* a literal this check cannot find in the TSX any more - the card was edited, so
  the check has stopped covering the fact it was written to cover. A check that
  quietly verifies nothing is worse than no check.

Reads only the public API. No database, no credentials, no paid call.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_API_BASE = "https://api.alethical.com/api/v1"
BILL_KEY = "94-2026-HF4138"
CARD_PATH = Path("apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx")

# The card's own strings. Each must appear in the TSX and hold up against the
# record. The en dashes in the vote totals are the card's; keep them exact.
CARD_CODE = "HF 4138"
CARD_SIGNED = "May 26, 2026"
CARD_EFFECTIVE = "July 1, 2027"
CARD_AUTHOR = "Rep. Peggy Scott"
CARD_HOUSE_VOTE = "132–2"
CARD_SENATE_VOTE = "66–0"
CARD_QUOTES = (
    "A covered social media platform may not create an account for a user "
    "identified as a child … without first obtaining verifiable parental consent.",
    "A covered social media platform may not present addictive interface features "
    "in the display or feed of any account of a child.",
    "An account for a child shall have all privacy settings set by default at the "
    "most private levels.",
)

# The card says "Signed <date>". The record carries that date on the Governor's
# approval action, formatted by the Legislature as MM/DD/YY or MM/DD/YYYY.
_APPROVAL_ACTION = "governor approval"
_APPROVAL_ACTION_ALT = "governor's action approval"
_DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")
_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def fetch(api_base: str, path: str) -> dict:
    url = f"{api_base.rstrip('/')}{path}"
    # The public API rejects a request with no User-Agent, so send one that names
    # this check - a 403 here would otherwise read as "the record is unreachable".
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "alethical-home-hero-card-check/1.0 (+https://github.com/alethical-org/alethical)",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def normalize(text: str) -> str:
    """Collapse whitespace so a quote spanning source lines still matches."""
    return re.sub(r"\s+", " ", text).strip()


def spoken_date(raw: str) -> str | None:
    """Turn a Legislature action date (05/26/2026) into the card's wording."""
    match = _DATE_RE.search(raw)
    if not match:
        return None
    month, day, year = (int(part) for part in match.groups())
    if year < 100:
        year += 2000
    if not 1 <= month <= 12:
        return None
    return f"{_MONTHS[month - 1]} {day}, {year}"


def card_source() -> str:
    if not CARD_PATH.exists():
        raise SystemExit(
            f"{CARD_PATH} is missing. Run this from the repository root, or update "
            "CARD_PATH if the hero card moved."
        )
    return CARD_PATH.read_text(encoding="utf-8")


def check_card_still_states(source: str, failures: list[str]) -> None:
    """Every literal below is what this check exists to verify. If the card has
    stopped stating one, the check has stopped covering it - say so loudly."""
    flat = normalize(source)
    expected = {
        "bill code": CARD_CODE,
        "signing date": CARD_SIGNED,
        "effective date": CARD_EFFECTIVE,
        "chief author": CARD_AUTHOR,
        "House vote": CARD_HOUSE_VOTE,
        "Senate vote": CARD_SENATE_VOTE,
    }
    for label, value in expected.items():
        if value not in flat:
            failures.append(
                f"The hero card no longer states the {label} ({value!r}), so this "
                "check no longer covers it. Update this script to match the card."
            )
    for quote in CARD_QUOTES:
        if normalize(quote) not in flat:
            failures.append(
                "The hero card no longer carries this quoted passage, so this check "
                f"no longer covers it: {quote[:60]}…"
            )


def check_record_agrees(api_base: str, failures: list[str]) -> None:
    # The featured-cards response is the one that carries the bill code, the
    # effective date and the chief authors in a single payload.
    cards = fetch(api_base, f"/bills/featured?bill_id={BILL_KEY}")["data"]
    if not cards:
        failures.append(f"The record no longer has a bill under the key {BILL_KEY}.")
        return
    bill = cards[0]

    code = f"{bill['file_type']} {bill['file_number']}"
    if code != CARD_CODE:
        failures.append(f"Card shows {CARD_CODE}; the record says {code}.")

    effective = bill.get("effective_date")
    if effective != CARD_EFFECTIVE:
        failures.append(
            f"Card shows the law taking effect {CARD_EFFECTIVE}; the record says "
            f"{effective or 'no effective date'}."
        )

    authors = bill.get("chief_sponsors") or []
    author_names = [author.get("name", "") for author in authors]
    if not any(CARD_AUTHOR.removeprefix("Rep. ") == name for name in author_names):
        failures.append(
            f"Card names {CARD_AUTHOR} as chief author; the record's chief authors "
            f"are {author_names or 'empty'}."
        )

    actions = fetch(api_base, f"/bills/{BILL_KEY}/actions")["data"]
    approvals = [
        spoken_date(
            f"{action.get('action_text') or ''} {action.get('action_description') or ''}"
        )
        for action in actions
        if any(
            marker in normalize(f"{action.get('action_text') or ''}").lower()
            for marker in (_APPROVAL_ACTION, _APPROVAL_ACTION_ALT)
        )
    ]
    if CARD_SIGNED not in [date for date in approvals if date]:
        failures.append(
            f"Card shows the law signed {CARD_SIGNED}; the record's Governor-approval "
            f"actions say {[date for date in approvals if date] or 'nothing'}."
        )

    votes = fetch(api_base, f"/bills/{BILL_KEY}/votes")["data"]
    tallies = {
        chamber: {
            f"{vote.get('yes_count')}–{vote.get('no_count')}"
            for vote in votes
            if vote.get("chamber") == chamber
        }
        for chamber in ("house", "senate")
    }
    for chamber, shown in (("house", CARD_HOUSE_VOTE), ("senate", CARD_SENATE_VOTE)):
        if shown not in tallies[chamber]:
            failures.append(
                f"Card shows the {chamber} voting {shown}; the record's {chamber} roll "
                f"calls are {sorted(tallies[chamber]) or 'empty'}."
            )

    versions = fetch(api_base, f"/bills/{BILL_KEY}/versions")["data"]
    current = next(
        (version for version in versions if version.get("is_current")),
        None,
    )
    if current is None:
        failures.append(
            "The record has no current text version, so the quoted passages cannot be verified."
        )
        return
    text = fetch(
        api_base,
        f"/bills/{BILL_KEY}/versions/{current['version_code']}/text?format=structured",
    )["data"]
    enacted = normalize(
        " ".join(section.get("text") or "" for section in text.get("sections") or [])
    )
    if not enacted:
        failures.append(
            "The record's current version has no stored text, so the quoted passages cannot be verified."
        )
        return
    for quote in CARD_QUOTES:
        # A quote may elide a clause with "…". Every part around it must still be
        # verbatim, in order, so the ellipsis cannot hide a change of meaning.
        cursor = 0
        for part in (normalize(piece) for piece in quote.split("…")):
            if not part:
                continue
            found = enacted.find(part, cursor)
            if found < 0:
                failures.append(
                    "This quoted passage is no longer verbatim in the enacted text: "
                    f"{part[:70]}…"
                )
                break
            cursor = found + len(part)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--api-base",
        default=DEFAULT_API_BASE,
        help=f"Public API base URL (default {DEFAULT_API_BASE}).",
    )
    args = parser.parse_args()

    failures: list[str] = []
    check_card_still_states(card_source(), failures)
    try:
        check_record_agrees(args.api_base, failures)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
        print(f"Could not reach the public API ({error}). Not treating that as drift.")
        return 0

    if failures:
        print("The Home hero card and the published record disagree:\n")
        for failure in failures:
            print(f"  - {failure}")
        print(
            "\nFix the card in apps/frontend/src/screens/redesign/HomeSignedOutScreen.tsx, "
            "or point it at a different bill. Every fact it shows must match the record."
        )
        return 1

    print("The Home hero card's stated facts all match the published record.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
