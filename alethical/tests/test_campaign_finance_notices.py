"""Large-contribution notices and disclosure statements (#2347).

Each test is one way the committee page could say something false: a notice drawn
under a window that does not apply, a gift called unmatched because of letter case, a
statement attached to the wrong gift, a notice amount added into a figure, or a
statement listed as a filed report. Fixture texts are the real outputs of the Board's
PDFs as ``pypdf`` reads them, measured on 23 Sep 2026.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import text

from alethical.api.services import committee_notices as service
from alethical.db import models
from alethical.db.session import get_session_factory
from alethical.pipeline import campaign_finance_filings as filings
from alethical.pipeline import campaign_finance_notices as notices
from alethical.tests.test_campaign_finance_payments import Published, _receipt
from alethical.tests.test_campaign_finance_payments import _clear as _clear_release
from alethical.tests.test_committee_filings_list import (
    _clear as _clear_filings,
    _filer,
    _filings_snapshot,
    _report,
)

FilerKind = models.CampaignFinanceFilerKind
RESTORE_SANITY = "41412"

BOARD_LAYOUT = """
Large Contribution Notice
Committee Information
Committee: Restore Sanity (41412)
Treasurer: Gantt, Charles
Period: 07/21/2026 through 08/10/2026
Submission date: August 07, 2026
Received by the Board August 07, 2026
Contributor, Lender, or Endorser Information
Contribution received from
Name: HEAD, MARTHA M
Employer: INVESTOR
City: MINNETONKA State: MN Zip code: 55305
Date: 08/06/2026 Amount: 50,000.00
Inkind: No Description:
Loan: No
Campaign Finance Reporter Online 1.0.4439 XSD Version: 2.6 Printed 08/07/2026
Page 1
"""

SECOND_LAYOUT = """
24 Hour Notice
Committee: Keith Ellison for Attorney General
Treasurer: Dan McGrath
Period: 7/21/2026 through 8/11/2026
Contribution received from
Contributor, Lender, or Endorser Information
Submission Date: August 11, 2026
Candidate / Committee Information
Date: 8/10/2026 Amount: $1,787.50
Inkind: No Description:
Loan: No
Name: United Food & Commercial Workers Council
6
City: Itasca State: IL Zip Code: 60143
Name: United Food & Commercial Workers Council
6
"""

UNREGISTERED_LABEL = """
24 Hour Notice
Committee: Minnesota Leadership Committee
Treasurer: Emanuel Banks
Period: 7/21/2026 through 8/11/2026
Submission Date: August 11, 2026
Committee Information
Date: 8/10/2026 Amount: $142,000.00
Inkind: No Description:
Loan: No
Unregistered: Democratic Legislative Campaign
Committee
City: Washington State: DC Zip Code: 20005
"""

PERSONAL_FORM = """
2026 Large_Candidate_Contribution_Notice
REPORT OF LARGE PERSONAL CONTRIBUTION OR LOAN
Recipient principal campaign committee
Committee name Registration no.
Candidate name  Date of contribution or loan
Amount: $
John Krhin for Governor 19304
John Krhin 08/10/2026
3,000.00
krhin4gov@gmail.com
"""

IN_KIND = """
Large Contribution Notice
Committee: Some Committee (18001)
Received by the Board July 23, 2026
Contributor, Lender, or Endorser Information
Name: Goodno, Kevin P (Registered Id: 1786 )
City: Moorhead State: MN Zip code: 56560
Date: 07/23/2026 Amount: 66.91
Inkind: Yes Description: Coffee and
pasties
Loan: No
"""

NOTICE_PAGE = """
<h2>Complete a Filing</h2>
<h2 class="branded">Click on the date to view the notice</h2>
<div class="pdf-reports"><div class="candidate-reports col-md-6"><h2>Candidate Committee</h2><dl>
<dt>Bertschinger, Sara House Committee</dt><dd><a href="javascript:viewNoticePDF('26','notice','PrePrimary',0,19336,'260803_150925');">08/03/2026</a></dd>
</dl></div><div class="pcf-reports col-md-6"><h2>Political Committee/Political Fund</h2><dl>
<dt>Restore Sanity - 41412</dt>
<dd><a href="javascript:viewNoticePDF('26','notice','PrePrimary',0,41412,'260806_140546');">08/06/2026</a></dd>
<dd><a href="javascript:viewNoticePDF('26','notice','PrePrimary',0,41412,'260806_140546_N1');">08/06/2026</a></dd>
</dl></div></div>
<h2>Footer heading</h2>
"""


def _catalogue(registration: str = RESTORE_SANITY) -> dict:
    """Restore Sanity's 2026 catalogue shape, measured 23 Sep 2026: 4 reports, each
    listing its own statements numbered from 1, and every disclosure row saying
    ``ReportType: D`` whatever report it sits under."""

    def report(code: str, name: str, cut_off: str) -> dict:
        return {
            "RegisteredEntityID": registration,
            "ReportType": code,
            "FilingYear": "2026",
            "ReportName": name,
            "CutOffDate": f"{cut_off} 00:00:00",
            "SpecialElectionindicator": "0",
            "amendments": ["0"],
        }

    def statement(number: int, name: str) -> dict:
        return {
            "RegisteredEntityID": registration,
            "ReportType": "D",
            "FilingYear": "2026",
            "ReportName": name,
            "CutOffDate": "2026-09-15 00:00:00",
            "SpecialElectionindicator": "0",
            "fileName": f"{registration}_D{number}.pdf",
            "amendments": [str(number)],
        }

    q1, june = "2026 1st Quarter Report", "2026 June Report"
    pre, sept = "2026 Pre-Primary Report", "2026 September Report"
    return {
        "data": {
            "pdfs": {
                "a": report("A", q1, "2026-03-31"),
                "b": report("B", june, "2026-05-31"),
                "c": report("C", pre, "2026-07-20"),
                "d": report("D", sept, "2026-09-15"),
            },
            "notices": {
                "n1": {
                    "RegisteredEntityID": registration,
                    "FilingYear": "2026",
                    "ReportName": "2026 Pre-Primary Report",
                    "fileName": f"{registration}_260806_140546_N1.pdf",
                    "amendments": ["0"],
                },
                "placeholder": {
                    "RegisteredEntityID": registration,
                    "FilingYear": "2026",
                    "ReportName": "2026 Pre-General Report",
                    "fileName": "2026 Pre-General Report",
                },
            },
            "disclosure": {
                "q1-1": statement(1, q1),
                "q1-2": statement(2, q1),
                "june-1": statement(1, june),
                "sept-1": statement(1, sept),
                "sept-4": statement(4, sept),
                "orphan": statement(1, "2026 Report Nobody Catalogued"),
            },
        }
    }


# --- Reading the sources -----------------------------------------------------------


def test_the_notice_page_is_read_by_group_and_ignores_later_headings():
    listed, errors = notices.parse_notice_list(NOTICE_PAGE)
    assert errors == []
    assert [
        (n.filer_kind, n.registration_number, n.board_notice_id) for n in listed
    ] == [
        (FilerKind.candidate_committee, "19336", "260803_150925"),
        (FilerKind.political_committee_or_fund, RESTORE_SANITY, "260806_140546"),
        (FilerKind.political_committee_or_fund, RESTORE_SANITY, "260806_140546_N1"),
    ]
    assert listed[1].committee_name_as_listed == "Restore Sanity - 41412"
    assert listed[1].filing_year == 2026
    assert listed[1].listed_on == date(2026, 8, 6)
    assert listed[2].pdf_url == (
        "https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=notice"
        "&period=PrePrimary&se=0&regnum=41412&date=260806_140546_N1"
    )


def test_a_link_the_page_carries_but_the_reader_missed_is_an_error():
    page = NOTICE_PAGE.replace(
        "</dl></div></div>",
        "<p>javascript:viewNoticePDF('26','notice','PreGeneral',0,1,'x');</p></dl></div></div>",
    )
    _listed, errors = notices.parse_notice_list(page)
    assert errors and "3 were read" in errors[0]


def test_the_boards_own_layout_reads_every_field():
    notice = notices.parse_notice_text(BOARD_LAYOUT)
    assert notice.errors == []
    assert notice.contributor_name == "HEAD, MARTHA M"
    assert notice.employer == "INVESTOR"
    assert (notice.city, notice.state, notice.zip_code) == ("MINNETONKA", "MN", "55305")
    assert notice.contribution_date == date(2026, 8, 6)
    assert notice.received_on == date(2026, 8, 7)
    assert notice.amount == Decimal("50000.00")
    assert notice.in_kind is False and notice.loan is False
    assert notice.registration_number == RESTORE_SANITY
    assert notice.amended is False


def test_the_second_layout_joins_a_wrapped_name_and_leaves_received_blank():
    notice = notices.parse_notice_text(SECOND_LAYOUT)
    assert notice.errors == []
    assert notice.contributor_name == "United Food & Commercial Workers Council 6"
    assert notice.contribution_date == date(2026, 8, 10)
    assert notice.amount == Decimal("1787.50")
    # This layout prints no date received by the Board. It stays missing: the
    # submission date is a different fact and is never printed in its place.
    assert notice.received_on is None
    assert notice.submitted_on == date(2026, 8, 11)


def test_an_unregistered_donor_label_and_a_one_word_second_line():
    notice = notices.parse_notice_text(UNREGISTERED_LABEL)
    assert notice.errors == []
    assert notice.contributor_name == "Democratic Legislative Campaign Committee"


def test_a_candidates_personal_contribution_form_is_read():
    notice = notices.parse_notice_text(PERSONAL_FORM)
    assert notice.errors == []
    assert notice.contributor_name == "John Krhin"
    assert notice.amount == Decimal("3000.00")
    assert notice.contribution_date == date(2026, 8, 10)


def test_donated_goods_keep_their_description_and_registered_ids_are_split_off():
    notice = notices.parse_notice_text(IN_KIND)
    assert notice.in_kind is True
    assert notice.in_kind_description == "Coffee and pasties"
    assert notice.contributor_name == "Goodno, Kevin P"
    assert notice.contributor_registration_number == "1786"


def test_a_notice_missing_its_amount_is_an_error_and_never_served():
    notice = notices.parse_notice_text(BOARD_LAYOUT.replace("Amount: 50,000.00", ""))
    assert "could not read the amount" in notice.errors


def test_a_statement_is_its_report_and_number_and_takes_that_reports_period_code():
    statements, errors = notices.parse_catalogue_statements(
        _catalogue(), RESTORE_SANITY
    )
    assert [(s.report_period, s.number, s.report_name) for s in statements] == [
        ("A", 1, "2026 1st Quarter Report"),
        ("A", 2, "2026 1st Quarter Report"),
        ("B", 1, "2026 June Report"),
        ("D", 1, "2026 September Report"),
        ("D", 4, "2026 September Report"),
    ]
    # Statement 1 of 3 different reports is 3 different documents, and the code comes
    # from the matching report row, never from the disclosure row's own "D".
    assert statements[0].report_cut_off == date(2026, 3, 31)
    # A statement under a report the catalogue gives no period code is never guessed.
    assert len(errors) == 1 and "no period code" in errors[0]
    marks = notices.parse_catalogue_notice_amendments(_catalogue(), RESTORE_SANITY)
    assert marks == {(2026, "260806_140546_N1"): 0}


def test_2_reports_sharing_a_name_make_the_code_ambiguous():
    catalogue = _catalogue()
    catalogue["data"]["pdfs"]["dup"] = dict(
        catalogue["data"]["pdfs"]["b"], ReportType="S", CutOffDate="2026-06-30 00:00:00"
    )
    statements, errors = notices.parse_catalogue_statements(catalogue, RESTORE_SANITY)
    assert ("B", 1) not in {(s.report_period, s.number) for s in statements}
    assert any("2 period codes" in error for error in errors)


def test_filed_reports_never_list_a_statement_or_a_notice():
    """Q6: the Filed reports tab reads only ``data.pdfs``, so neither kind is a report."""
    reports, errors = filings.parse_catalogue_payload(_catalogue(), RESTORE_SANITY)
    assert errors == []
    assert sorted(r.report_name for r in reports) == [
        "2026 1st Quarter Report",
        "2026 June Report",
        "2026 Pre-Primary Report",
        "2026 September Report",
    ]


def test_statement_pdf_address():
    assert notices.statement_pdf_url(2026, RESTORE_SANITY, "A", 2) == (
        "https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF&year=26&type=disclosure"
        "&period=A&regnum=41412&disc=2"
    )


# --- Which windows apply -----------------------------------------------------------

PRIMARY = notices.parse_candidate_file(
    (
        "02270301;Brady Rouhoff;0227;State Representative District 20B;88;03;R\r\n"
        "02270302;Sara Bertschinger;0227;State Representative District 20B;88;03;R\r\n"
        "02270402;Steve Holm;0227;State Representative District 20B;88;04;DFL\r\n"
        "03310306;Lisa Demuth and Ryan Wilson;0331;Governor & Lt Governor;88;03;R\r\n"
        "03310304;Mike Lindell and Phillip C Parrish;0331;Governor & Lt Governor;88;03;R\r\n"
    ).encode("latin-1")
)
GENERAL = notices.parse_candidate_file(
    (
        "02270401;Steve Holm;0227;State Representative District 20B;88;04;DFL\r\n"
        "02270302;Sara Bertschinger;0227;State Representative District 20B;88;03;R\r\n"
        "03310303;Lisa Demuth and Ryan Wilson;0331;Governor & Lt Governor;88;03;R\r\n"
    ).encode("latin-1")
)


def _exclusions(office, district, name):
    return notices.window_exclusions_for_candidate(
        office=office,
        district=district,
        candidate_name=name,
        primary=PRIMARY,
        general=GENERAL,
    )


def test_a_primary_loser_has_no_october_window():
    assert [w for w, _, _ in _exclusions("House", "20B", "Rouhoff, Brady")] == [
        notices.PRE_GENERAL
    ]
    assert [w for w, _, _ in _exclusions("Governor", None, "Lindell, Mike")] == [
        notices.PRE_GENERAL
    ]


def test_an_unopposed_primary_candidate_has_no_primary_window():
    assert [w for w, _, _ in _exclusions("House", "20B", "Holm, Steve")] == [
        notices.PRE_PRIMARY
    ]


def test_a_nominee_keeps_both_and_an_unfound_candidate_keeps_both():
    assert _exclusions("House", "20B", "Bertschinger, Sara") == []
    assert _exclusions("Governor", None, "Demuth, Lisa") == []
    assert _exclusions("House", "20B", "Nobody, Someone") == []
    assert _exclusions("District Court", "1", "Judge, A") == []


# --- The collector and the page's service ------------------------------------------


class MemoryStore:
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def put_and_verify(self, key, path, expected_sha256):
        with open(path, "rb") as handle:
            self.objects[key] = handle.read()

    def get(self, key, destination, max_bytes=None):
        with open(destination, "wb") as handle:
            handle.write(self.objects[key])


NOTICE_TABLES = (
    "cf_disclosure_statement_source",
    "cf_disclosure_statement_reading",
    "cf_disclosure_statement",
    "cf_statement_scan",
    "cf_notice_window_exclusion",
    "cf_contribution_notice",
    "cf_notice_list_copy",
)


def _clear(session) -> None:
    session.rollback()
    for table in NOTICE_TABLES:
        session.execute(text(f"DELETE FROM {table}"))
    session.commit()
    _clear_release(session)
    _clear_filings(session)


@pytest.fixture()
def db(seed_database: None):
    session = get_session_factory()()
    _clear(session)
    try:
        yield session
    finally:
        _clear(session)
        session.close()


def _collect(db, monkeypatch, texts: dict[str, str], page: str = NOTICE_PAGE, now=None):
    monkeypatch.setattr(
        notices,
        "fetch_pdf",
        lambda http, url, cache, name: (url.encode() + b"%PDF", None),
    )
    monkeypatch.setattr(
        notices,
        "pdf_text",
        lambda body: texts[body.decode().split("date=")[1][: -len("%PDF")]],
    )
    store = MemoryStore()
    report = notices.collect_notices(
        db,
        None,
        store,
        dry_run=False,
        page_body=page.encode(),
        now=now or datetime(2026, 9, 23, 18, 0, tzinfo=UTC),
    )
    return report, store


RESTORE_TEXTS = {
    "260803_150925": BOARD_LAYOUT.replace(
        "Restore Sanity (41412)", "Bertschinger (19336)"
    ),
    "260806_140546": BOARD_LAYOUT,
    "260806_140546_N1": BOARD_LAYOUT.replace(
        "HEAD, MARTHA M", "MADURO DISTRIBUTORS INC"
    )
    .replace("Employer: INVESTOR\n", "")
    .replace("50,000.00", "15,000.00"),
}


def test_the_collector_keeps_each_pdf_once_and_dates_the_copy(db, monkeypatch):
    report, store = _collect(db, monkeypatch, RESTORE_TEXTS)
    assert report.ok and report.new == 3 and report.parse_failures == []
    assert len(store.objects) == 3
    copy = service.latest_notice_copy(db)
    assert copy.notice_count == 3 and copy.covered_years == [2026]

    calls = []
    monkeypatch.setattr(
        notices,
        "fetch_pdf",
        lambda *args: calls.append(args) or (None, "should not fetch"),
    )
    again = notices.collect_notices(
        db, None, store, dry_run=False, page_body=NOTICE_PAGE.encode()
    )
    assert again.already_held == 3 and again.new == 0 and calls == []


def test_a_failed_page_read_keeps_the_records_and_moves_no_copy_date(db, monkeypatch):
    _collect(db, monkeypatch, RESTORE_TEXTS)
    before = service.latest_notice_copy(db).fetched_at
    report = notices.collect_notices(
        db, None, MemoryStore(), dry_run=False, page_body=b"<html>maintenance</html>"
    )
    assert not report.ok
    assert service.latest_notice_copy(db).fetched_at == before
    assert db.execute(text("SELECT count(*) FROM cf_contribution_notice")).scalar() == 3


def test_a_dry_run_writes_nothing(db, monkeypatch):
    monkeypatch.setattr(notices, "fetch_pdf", lambda *a: (b"x%PDF", None))
    monkeypatch.setattr(notices, "pdf_text", lambda body: BOARD_LAYOUT)
    report = notices.collect_notices(
        db, None, None, dry_run=True, page_body=NOTICE_PAGE.encode()
    )
    assert report.new == 3
    assert db.execute(text("SELECT count(*) FROM cf_contribution_notice")).scalar() == 0
    assert service.latest_notice_copy(db) is None


def _restore_sanity_money(db, *, september_report=True):
    published = Published(db)
    _receipt(
        db,
        published.contributions,
        reg_num=RESTORE_SANITY,
        contributor="Head, Martha M",
        amount="50000",
        on=date(2026, 8, 6),
        year=2026,
        name="Restore Sanity",
    )
    db.commit()
    snapshot = _filings_snapshot(db)
    _filer(
        db,
        snapshot,
        RESTORE_SANITY,
        kind=FilerKind.political_committee_or_fund,
        name="Restore Sanity",
    )
    if september_report:
        _report(
            db,
            snapshot,
            RESTORE_SANITY,
            report_name="2026 September Report",
            cut_off=date(2026, 9, 15),
        )
    return published


def test_notice_status_matches_ignoring_case_and_says_so_when_it_cannot(
    db, monkeypatch, client
):
    _collect(db, monkeypatch, RESTORE_TEXTS)
    _restore_sanity_money(db)
    body = client.get(f"/api/v1/committees/{RESTORE_SANITY}/notices?year=2026").json()[
        "data"
    ]
    assert body["state"] == "listed"
    assert body["threshold"] == service.THRESHOLD_COMMITTEE
    assert body["copied_on"] == "2026-09-23"
    windows = body["windows"]
    assert [w["key"] for w in windows] == [notices.PRE_PRIMARY, notices.PRE_GENERAL]
    assert (windows[0]["start"], windows[0]["end"]) == ("2026-07-21", "2026-08-10")
    rows = {n["contributor"]: n for n in windows[0]["notices"]}
    head = rows["HEAD, MARTHA M"]
    assert head["status"] == "matched"
    assert head["matched_payment"]["contributor"] == "Head, Martha M"
    # Maduro's gift falls inside the September report and no row matches it exactly.
    assert rows["MADURO DISTRIBUTORS INC"]["status"] == "no_exact_match"
    assert windows[1]["notices"] == []
    # The officer is never served.
    assert "Gantt" not in json.dumps(body)
    assert "treasurer" not in json.dumps(body)


def test_a_gift_after_the_latest_report_is_not_yet_on_a_report(db, monkeypatch, client):
    _collect(db, monkeypatch, RESTORE_TEXTS)
    _restore_sanity_money(db, september_report=False)
    snapshot = filings.live_filings_snapshot(db)
    _report(db, snapshot, RESTORE_SANITY, cut_off=date(2026, 7, 20))
    body = client.get(f"/api/v1/committees/{RESTORE_SANITY}/notices?year=2026").json()[
        "data"
    ]
    assert body["report_covered_through"] == "2026-07-20"
    rows = {n["contributor"]: n["status"] for n in body["windows"][0]["notices"]}
    assert rows["MADURO DISTRIBUTORS INC"] == "not_yet_on_a_report"
    assert rows["HEAD, MARTHA M"] == "matched"


def test_without_a_known_report_end_no_notice_claims_to_follow_one(
    db, monkeypatch, client
):
    _collect(db, monkeypatch, RESTORE_TEXTS)
    _restore_sanity_money(db, september_report=False)
    body = client.get(f"/api/v1/committees/{RESTORE_SANITY}/notices?year=2026").json()[
        "data"
    ]
    assert body["report_covered_through"] is None
    rows = {n["contributor"]: n["status"] for n in body["windows"][0]["notices"]}
    assert rows["MADURO DISTRIBUTORS INC"] == "no_exact_match"


def test_the_card_is_absent_for_a_party_unit_and_for_an_uncovered_year(
    db, monkeypatch, client
):
    _collect(db, monkeypatch, RESTORE_TEXTS)
    _restore_sanity_money(db)
    snapshot = filings.live_filings_snapshot(db)
    _filer(db, snapshot, "20003", kind=FilerKind.party_unit, name="MN DFL")
    party = service.committee_notices(
        db,
        registration_number="20003",
        year=2026,
        contributions_snapshot_id=None,
        kind=FilerKind.party_unit,
        office=None,
    )
    assert party.state == "no_windows" and party.windows == ()
    body = client.get(f"/api/v1/committees/{RESTORE_SANITY}/notices?year=2025").json()[
        "data"
    ]
    assert body["state"] == "not_covered" and body["windows"] == []


def test_an_excluded_window_is_not_drawn(db, monkeypatch):
    _collect(db, monkeypatch, RESTORE_TEXTS)
    db.add(
        models.CampaignFinanceNoticeWindowExclusion(
            registration_number="99999",
            election_year=2026,
            window=notices.PRE_GENERAL,
            reason="not_on_general_ballot",
            source_url=notices.GENERAL_CANDIDATES_URL,
            determined_at=datetime(2026, 9, 23, tzinfo=UTC),
        )
    )
    db.commit()
    answer = service.committee_notices(
        db,
        registration_number="99999",
        year=2026,
        contributions_snapshot_id=None,
        kind=FilerKind.candidate_committee,
        office="House",
    )
    assert [w.key for w in answer.windows] == [notices.PRE_PRIMARY]
    assert answer.threshold == service.THRESHOLD_HALF_LIMIT


def test_no_route_adds_a_notice_amount_into_money_in(db, monkeypatch, client):
    _collect(db, monkeypatch, RESTORE_TEXTS)
    _restore_sanity_money(db)
    payments = client.get(
        f"/api/v1/committees/{RESTORE_SANITY}/payments?direction=received&year=2026"
    ).json()["data"]
    # The notice for this same gift exists; the list still holds exactly the 1 row.
    assert len(payments["payments"]) == 1
    assert Decimal(str(payments["payments"][0]["amount"])) == Decimal("50000")


# --- Statements --------------------------------------------------------------------


REPORTS = {
    "A": ("2026 1st Quarter Report", date(2026, 3, 31)),
    "B": ("2026 June Report", date(2026, 5, 31)),
    "C": ("2026 Pre-Primary Report", date(2026, 7, 20)),
    "D": ("2026 September Report", date(2026, 9, 15)),
}


def _statement(db, number, *, reading=None, held=True, period="D"):
    name, cut_off = REPORTS[period]
    row = models.CampaignFinanceDisclosureStatement(
        recipient_registration_number=RESTORE_SANITY,
        filing_year=2026,
        report_period=period,
        report_name=name,
        report_cut_off=cut_off,
        statement_number=number,
        listed_under_reports=[name],
        first_listed_at=datetime(2026, 9, 23, tzinfo=UTC),
        last_listed_at=datetime(2026, 9, 23, tzinfo=UTC),
        document_hash="a" * 64 if held else None,
        object_key=f"campaign-finance/disclosure-statement/{period}{number}.pdf.gz"
        if held
        else None,
        compressed_hash="b" * 64 if held else None,
    )
    db.add(row)
    db.flush()
    if reading is not None:
        reading.statement_id = row.id
        db.add(reading)
    db.commit()
    return row


def _read(donor, on, amount, *, state="read", repeat_of=None):
    reading = models.CampaignFinanceDisclosureStatementReading(
        state=models.DisclosureStatementReadingState(state),
        donor_name=donor,
        recipient_name="Restore Sanity",
        repeat_of_period=repeat_of[0] if repeat_of else None,
        repeat_of_number=repeat_of[1] if repeat_of else None,
        gift_date=on,
        gift_amount=Decimal(amount),
        reviewed_by="Alethical, LLC",
        evidence="test",
        document_hash_read="a" * 64,
    )
    if state == "read":
        reading.box = 3
        reading.line_a = Decimal(amount)
        reading.signed_on = date(2026, 9, 20)
        reading.received_on = date(2026, 9, 21)
        reading.sources.append(
            models.CampaignFinanceDisclosureStatementSource(
                position=1,
                name="Uihlein, Richard E.",
                city="Lake Bluff",
                state="IL",
                amount=Decimal(amount),
            )
        )
    return reading


def test_a_statement_attaches_only_to_the_gift_it_names(db, client):
    published = Published(db)
    kw = dict(
        reg_num=RESTORE_SANITY,
        year=2026,
        name="Restore Sanity",
        contributor_type="Other",
    )
    named = _receipt(
        db,
        published.contributions,
        contributor="RESTORATION OF AMERICA PAC",
        amount="5000000",
        on=date(2026, 8, 27),
        **kw,
    )
    _receipt(
        db,
        published.contributions,
        contributor="RESTORATION OF AMERICA PAC",
        amount="1095000",
        on=date(2026, 3, 17),
        **kw,
    )
    rslc = _receipt(
        db,
        published.contributions,
        contributor="Republican State Leadership Committee",
        amount="50000",
        on=date(2026, 8, 28),
        **kw,
    )
    db.commit()
    _statement(
        db, 2, reading=_read("Restoration of America PAC", date(2026, 8, 27), "5000000")
    )
    _statement(
        db,
        1,
        reading=_read(
            "Republican State Leadership Committee",
            date(2026, 8, 28),
            "50000",
            state="gift_identified",
        ),
    )
    # Listed but read by nobody: attaches to nothing.
    unread = _statement(db, 1, period="B")
    # A reading whose gift is dated a day off matches no row.
    off_by_a_day = _statement(
        db,
        1,
        period="A",
        reading=_read("Restoration of America PAC", date(2026, 3, 18), "1095000"),
    )
    # A repeat of an earlier document is kept and never shown, linked or not.
    _statement(
        db,
        2,
        period="C",
        reading=_read(
            "Restoration of America PAC",
            date(2026, 3, 18),
            "1095000",
            repeat_of=("A", 1),
        ),
    )
    db.add(
        models.CampaignFinanceStatementScan(
            started_at=datetime(2026, 9, 23, 17, tzinfo=UTC),
            completed_at=datetime(2026, 9, 23, 18, tzinfo=UTC),
            catalogues_read=1,
            statements_listed=4,
            scope="test",
        )
    )
    db.commit()

    body = client.get(
        f"/api/v1/committees/{RESTORE_SANITY}/payments?direction=received&year=2026"
    ).json()["data"]
    attached = {s["record_number"]: s for s in body["disclosure_statements"]}
    assert set(attached) == {named, rslc}
    assert attached[named]["state"] == "read"
    assert attached[named]["pdf_url"].endswith("period=D&regnum=41412&disc=2")
    assert attached[rslc]["state"] == "gift_identified"
    assert body["statements_copied_on"] == "2026-09-23"

    detail = client.get(
        f"/api/v1/campaign-finance/disclosure-statements/{attached[named]['statement_id']}"
    ).json()["data"]
    assert detail["box"] == 3
    assert [(s["name"], s["city"], s["state"]) for s in detail["sources"]] == [
        ("Uihlein, Richard E.", "Lake Bluff", "IL")
    ]
    assert Decimal(str(detail["sources"][0]["amount"])) == Decimal("5000000")
    assert detail["line_b"] is None and detail["line_c"] is None
    assert "zip" not in json.dumps(detail).lower()

    held = client.get(
        f"/api/v1/campaign-finance/disclosure-statements/{attached[rslc]['statement_id']}"
    ).json()["data"]
    assert held["state"] == "gift_identified"
    assert held["sources"] == [] and held["box"] is None

    # The statements that match no row, known without the payment list.
    listed = client.get(
        f"/api/v1/committees/{RESTORE_SANITY}/disclosure-statements?year=2026"
    ).json()["data"]
    assert listed["state"] == "listed"
    by_id = {item["id"]: item for item in listed["statements"]}
    assert set(by_id) == {str(unread.id), str(off_by_a_day.id)}
    assert by_id[str(unread.id)]["state"] == "not_read"
    assert by_id[str(unread.id)]["donor_name"] is None
    assert by_id[str(unread.id)]["gift_amount"] is None
    assert by_id[str(unread.id)]["pdf_url"].endswith("period=B&regnum=41412&disc=1")
    assert by_id[str(off_by_a_day.id)]["donor_name"] == "Restoration of America PAC"
    # Earliest report first.
    assert [item["report_period"] for item in listed["statements"]] == ["A", "B"]
    assert listed["copied_on"] == "2026-09-23"


def test_matching_reads_the_whole_year_not_the_page_a_reader_is_on(db, client):
    published = Published(db)
    kw = dict(
        reg_num=RESTORE_SANITY,
        year=2026,
        name="Restore Sanity",
        contributor_type="Other",
    )
    for day in range(1, 4):
        _receipt(
            db,
            published.contributions,
            contributor=f"Donor {day}",
            amount="10",
            on=date(2026, 1, day),
            **kw,
        )
    late = _receipt(
        db,
        published.contributions,
        contributor="SAM NUTRITION",
        amount="5000",
        on=date(2026, 4, 21),
        **kw,
    )
    db.commit()
    _statement(
        db, 1, period="B", reading=_read("SAM Nutrition", date(2026, 4, 21), "5000")
    )
    first_page = client.get(
        f"/api/v1/committees/{RESTORE_SANITY}/payments?direction=received&year=2026&limit=2&sort=amount"
    ).json()["data"]
    assert [s["record_number"] for s in first_page["disclosure_statements"]] == [late]
    later = client.get(
        f"/api/v1/committees/{RESTORE_SANITY}/payments?direction=received&year=2026&limit=2&offset=2&sort=amount"
    ).json()["data"]
    assert later["disclosure_statements"] == []
    listed = client.get(
        f"/api/v1/committees/{RESTORE_SANITY}/disclosure-statements?year=2026"
    ).json()["data"]
    assert listed["statements"] == [] and listed["copied_on"] is None


def test_with_no_payment_rows_every_statement_stays_listed(db):
    _statement(
        db, 2, reading=_read("Restoration of America PAC", date(2026, 8, 27), "5000000")
    )
    links = service.statement_links(db, RESTORE_SANITY, 2026, None)
    assert links.linked == {} and len(links.unlinked) == 1


def test_made_payments_carry_no_statements(db, client):
    _restore_sanity_money(db)
    _statement(db, 2, reading=_read("Head, Martha M", date(2026, 8, 6), "50000"))
    made = client.get(
        f"/api/v1/committees/{RESTORE_SANITY}/payments?direction=made&year=2026"
    )
    assert made.status_code == 200
    assert made.json()["data"]["disclosure_statements"] == []
    received = client.get(
        f"/api/v1/committees/{RESTORE_SANITY}/payments?direction=received&year=2026"
    ).json()["data"]
    assert len(received["disclosure_statements"]) == 1


def test_a_reading_is_refused_when_the_kept_images_differ(db):
    statement = _statement(db, 3)
    store = MemoryStore()
    reading = notices.reading_from_json(
        {
            "recipient_registration_number": RESTORE_SANITY,
            "filing_year": 2026,
            "report_period": "D",
            "statement_number": 3,
            "image_fingerprint": "not-the-images",
            "state": "gift_identified",
            "donor_name": "Restoration of America PAC",
            "gift_date": "2026-09-15",
            "gift_amount": "5000000.00",
            "evidence": "test",
        },
        "Alethical, LLC",
    )
    import gzip
    import hashlib

    body = gzip.compress(b"%PDF-1.4 not an image pdf", mtime=0)
    store.objects[statement.object_key] = body
    statement.compressed_hash = hashlib.sha256(body).hexdigest()
    db.commit()

    def fingerprint(_body):
        return "the-real-images"

    original = notices.statement_image_fingerprint
    notices.statement_image_fingerprint = fingerprint
    try:
        outcome = notices.record_statement_reading(db, store, reading, dry_run=False)
    finally:
        notices.statement_image_fingerprint = original
    assert outcome.startswith("refused") and "images" in outcome
    assert (
        db.execute(
            text("SELECT count(*) FROM cf_disclosure_statement_reading")
        ).scalar()
        == 0
    )


def test_a_read_statement_must_name_its_box():
    with pytest.raises(ValueError):
        notices.reading_from_json(
            {
                "recipient_registration_number": RESTORE_SANITY,
                "filing_year": 2026,
                "report_period": "D",
                "statement_number": 2,
                "image_fingerprint": "x",
                "state": "read",
                "donor_name": "Restoration of America PAC",
                "gift_date": "2026-08-27",
                "gift_amount": "5000000.00",
                "evidence": "test",
            },
            "Alethical, LLC",
        )


def test_the_launch_readings_file_is_well_formed():
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[1]
        / "pipeline"
        / "data"
        / "disclosure_statement_readings.json"
    )
    items = json.loads(path.read_text())["readings"]
    readings = {
        (r.report_period, r.statement_number): r
        for r in (notices.reading_from_json(item, "Alethical, LLC") for item in items)
    }
    assert set(readings) == {
        ("A", 1),
        ("A", 2),
        ("B", 1),
        ("B", 2),
        ("C", 1),
        ("C", 2),
        ("C", 3),
        ("D", 1),
        ("D", 2),
        ("D", 3),
        ("D", 4),
    }
    # Restoration of America PAC's 5 gifts each carry 1 read statement, and every one
    # prints its source exactly as the filing spells it.
    roa = [r for r in readings.values() if r.donor_name == "Restoration of America PAC"]
    assert sorted(r.gift_date for r in roa) == [
        date(2026, 3, 17),
        date(2026, 6, 17),
        date(2026, 7, 21),
        date(2026, 8, 27),
        date(2026, 9, 15),
    ]
    for reading in roa:
        assert reading.state == "read" and reading.box == 3
        assert reading.sources == (
            ("Uihlein, Richard, E.", "Lake Bluff", "IL", reading.gift_amount),
        )
        assert reading.line_a == reading.gift_amount
        assert reading.line_b is None and reading.line_c is None
    # The 2 copies of the North Metro statement are 1 statement, shown once.
    repeat = readings[("C", 2)]
    assert (repeat.repeat_of_period, repeat.repeat_of_number) == ("B", 2)
    assert notices.repeats_match(readings[("B", 2)], repeat)
    # Held, not read: the 2 Republican State Leadership Committee statements.
    assert readings[("D", 1)].state == "gift_identified"
    assert readings[("C", 1)].state == "gift_identified"
    # No read statement guesses a date the form does not state.
    assert (
        readings[("B", 2)].signed_on is None and readings[("B", 2)].received_on is None
    )
