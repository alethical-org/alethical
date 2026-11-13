"""Complete offered inventory must survive literal, hostile and lifecycle checks.

The HTML fixture retains the public Hennepin layout/scripts; the person and
cookie-measurement payload are synthetic. No browser/script execution or fetch.
"""

# ruff: noqa: F811 - pytest fixtures are imported and requested by name.
from copy import deepcopy
import pytest
from alethical.pipeline import election_local_context as local
from alethical.pipeline import election_external_finance as storage
from alethical.pipeline.election_comparison import ComparisonImportError

from types import SimpleNamespace
from datetime import date
import hashlib
import json
from alethical.pipeline import election_source_readings as readings
from alethical.pipeline import election_source_provenance as provenance
from alethical.pipeline import election_local_sources as source_adapter
from alethical.pipeline.election_comparison import archive_source, digest
from alethical.tests.test_election_local_reading_integration import db, local_generation  # noqa: F401
from alethical.tests.test_election_source_review_concurrency import isolated_engine  # noqa: F401
from alethical.tests.test_election_local_financial_form import native_pdf

URL = "https://www16.co.hennepin.mn.us/cfrs/getreports.do?filterBy=&searchBy=candidate&fullname=Example%2C+Candidate&ids=1237&alpha=&city=&office=&district=&ps=284"

CATALOGUE = '\n\n<!DOCTYPE html>\n<html lang=en>\n\n<head>\n \n<title>Campaign Finance Reporting System * version 2.3</title>\n\n\t<meta charset="utf-8">\n\t<meta name="robots" content="noindex">\n\t\n\t<meta name="viewport" content="width=device-width, initial-scale=1">\n\t<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">\n\t<meta name="description" content="">\n\t\n\t\n    <link rel="shortcut icon" href="favicon.ico" type="image/x-icon" />\n \n \n     <link href="assets/css/bootstrap.min.css" rel="stylesheet">\n     <link href="assets/css/bootstrap.min.css" rel="stylesheet">\n     <link rel="stylesheet"  href="assets/css/normalize.css">   \n     <link rel="stylesheet"  href="assets/css/main.css">\n     <link rel="stylesheet" href="assets/css/docs.min.css">\n     \n     \n     <link href="assets/css/bootstrap-table.css" rel="stylesheet">\n     \n   \n   <link rel="stylesheet" href="https://code.jquery.com/ui/1.11.4/themes/smoothness/jquery-ui.css">\n   <script src="https://code.jquery.com/ui/1.11.4/jquery-ui.js"></script>\n  \n   \n   <script src="assets/js/vendor/modernizr-2.6.2-respond-1.1.0.min.js"></script>\n   <script src="assets/js/jquery-1.11.3.min.js"></script>\n   \n   <script src="assets/js/bootstrap.min.js"></script>\n   <script src="assets/js/bootstrap-table.js"></script>\n   \n    \n\n\n    \n</head>\n\n\n\n<script>\n\tfunction onRowClick(id) {\n\t\tvar summaryIdentifier = "#doc" + id;\n\t\tvar hiddenStatus = !document.querySelector(summaryIdentifier).hidden\n\t\tdocument.querySelector(summaryIdentifier).hidden = hiddenStatus;\n\t\tvar rowIdentifier = "#rowExpStatus" +id;\n\t\tdocument.querySelector(rowIdentifier).innerHTML = hiddenStatus ? "+" : "-";\n\t};\n\tfunction fixFormat() {\n\t\tconst cells = document.querySelectorAll("#reports_2 .detailDocRow td");\n\t\tcells.forEach((cell) => {\n\t\t\tcell.style.borderTopColor =\'#FFFFFF\'\n\t\t});\n\t};\n</script>\n\n<body style="color:black" onload=fixFormat()>\n<div class="page-wrapper">\n\t\n\n\n\n\n\t\n\t<div class="main-nav" id="navigation" role="navigation">\n\t\t<nav class="page-nav">\n\t\t\t<ul class="main-nav-item">\t\t\n\t\t\t\n\t\t\t<li><a href="http://www.hennepin.us/"><span class="desktop icon-logo"></span>Home</a></li>\t\t\t\n\t\t\t<li><a class="main-nav-item__handle" href="http://www.hennepin.us/residents"><span class="desktop icon-residents"></span>Residents</a>\n\t\t\t\t<p class="desktop">Information and services</p>\n\t\t    </li>\n\t\t    <li>\n\t\t    \t<a class="main-nav-item__handle" href="http://www.hennepin.us/business"><span class="desktop icon-business"></span>Business</a>\n\t\t        <p class="desktop">Regulations and opportunities</p>\n\t\t    </li>\n\t\t    <li>\n\t\t    \t<a class="main-nav-item__handle two-line" href="http://www.hennepin.us/your-government"><span class="desktop icon-your-government"></span>Your government</a>\n\t\t        <p class="desktop">Leadership and engagement</p>\n\t\t    </li>\n\t\t    <li>\n\t\t    \t<a class="main-nav-item__handle two-line" href="http://www.hennepin.us/services"><span class="desktop icon-online-services"></span>Online services</a>\n\t\t        <p class="desktop">Transactions and applications</p>\n\t\t    </li>\n\t\t</ul>\n\t\t</nav>\n\t\t<div class="topbar">\n\t\t\t<nav class="topbar__nav">\n\t\t\t\t<ul>\n\t\t\t\t\t<li><a href="https://public.govdelivery.com/accounts/MNHENNE/subscriber/new " target="new">Subscribe</a></li>\n\t\t\t\t\t<li><a href="http://www.hennepin.us/jobs">Jobs</a></li>\n\t\t\t\t\t<li><a href="http://www.hennepin.us/employees">Employees</a></li>\n\t\t\t\t\t<li><a href="http://www.hennepin.us/media">Media</a></li>\n\t\t\t\t\t<li><a href="https://www.hennepin.us/contact">Contact</a></li>\n\t\t\t\t\t\t\t\t\t\n\t\t\t\t\t\n\t\t\t\t</ul>\n\t\t\t</nav>\n\t\t</div>\t\t\n\t</div>\n\n\n\n\t\n    \n    <header class="site-header">\n\t<a class="popout-nav--trigger" href="#navigation">Navigation</a>\n\t<h1 class="site-title">Hennepin County, MN</h1>\n\t\t</header>\n\t\t\n\t\n\t\n<section class="page" style="padding-top: 0px;">\n\n\t\n<div class="content-wrapper"> <div class="container-fluid">\n\n\n\n\n\n\n<div>\n<p><a href="http://www.hennepin.us/">Home</a>&gt;<a href="search_options.do">Campaign finance</a> &gt; <a href="#" onclick="window.history.back();">\nCandidate\n</a> &gt;Example, Candidate\n</p>\n</div> \n\n\n\n\n<form action="getreport.pdf">\n\n<br />\n        <p class="lead">Documents for viewing</p>\n         <p>\n              Listed below are campaign finance documents for <strong>\n              Example, Candidate\n              </strong>. \n              To view these .pdf documents, click on them. Note: You must have \n              <a href="http://www.adobe.com/products/acrobat/readermain.html">Adobe \n              Acrobat&reg; Reader</a> to view these documents.</p>\n        \n  \n\n<div class="table-responsive">\n<table id="reports_2" class="table table-hover table-condensed" style="padding: 1px;">\n<thead>\n<tr>\n<th scope="col" data-field="exp"> </th>\n<th scope="col" data-field="name"> Report Name </th>\n<th scope="col" data-field="contributions"> Contributions </th>\n<th scope="col" data-field="expenditures"> Expenditures </th>\n<th scope="col" data-field="bal"> End Balance </th>\n</tr>\n</thead>\n\n<tbody>\n\n\t\n\t\t     \n\t\n\t<tr id="4" onClick="onRowClick(4)" style = "border-bottom-color: #FFFFFF;">\n\t\t<td align="left" valign="middle" id="rowExpStatus4"> + </td>\n\t    <td align="left" valign="top" >\n\t        \n\t         \n\t\n\t        \n\t            2026 \n\t        \n\t        \tPre-general report\n\t       \n\n\t    </td>\n\t    <td >\n\t    \t55867.47\n\t    </td>\n\t    <td>\n\t    \t38529.25\n\t    </td>\n\t    <td>\n\t    \t45491.47\n\t    </td>\n\t    </tr>\n\n\t\t<tr id="doc4" hidden=true class="detailDocRow">\n\t\t<td></td>\n\t\t\n\t\t<td >\n\t       \t<a style= "font-weight: normal" target="new" download href="getReport.pdf?seq=1&ids=1237">\n\t\t\tDownload Document\n\t\t\t</a>\n\t\t</td>\n\t\t</tr>\n\t   \n    \t\t\n\n\t \n\t\n    \n    \t            \n\n\t\n\t\t     \n\t\n\t<tr id="3" onClick="onRowClick(3)" style = "border-bottom-color: #FFFFFF;">\n\t\t<td align="left" valign="middle" id="rowExpStatus3"> + </td>\n\t    <td align="left" valign="top" >\n\t        \n\t         \n\t\n\t        \n\t            2026 \n\t        \n\t        \tPre-primary report\n\t       \n\n\t    </td>\n\t    <td >\n\t    \t76595.59\n\t    </td>\n\t    <td>\n\t    \t70625.94\n\t    </td>\n\t    <td>\n\t    \t28153.00\n\t    </td>\n\t    </tr>\n\n\t\t<tr id="doc3" hidden=true class="detailDocRow">\n\t\t<td></td>\n\t\t\n\t\t<td >\n\t       \t<a style= "font-weight: normal" target="new" download href="getReport.pdf?seq=2&ids=1237">\n\t\t\tDownload Document\n\t\t\t</a>\n\t\t</td>\n\t\t</tr>\n\t   \n    \t\t\n\n\t \n\t\n    \n    \t            \n\n\t\n\t\t     \n\t\n\t<tr id="2" onClick="onRowClick(2)" style = "border-bottom-color: #FFFFFF;">\n\t\t<td align="left" valign="middle" id="rowExpStatus2"> + </td>\n\t    <td align="left" valign="top" >\n\t        \n\t         \n\t\n\t        \n\t            2025 \n\t        \n\t        \tAnnual report\n\t       \n\n\t    </td>\n\t    <td >\n\t    \t35555.33\n\t    </td>\n\t    <td>\n\t    \t13371.98\n\t    </td>\n\t    <td>\n\t    \t22183.35\n\t    </td>\n\t    </tr>\n\n\t\t<tr id="doc2" hidden=true class="detailDocRow">\n\t\t<td></td>\n\t\t\n\t\t<td >\n\t       \t<a style= "font-weight: normal" target="new" download href="getReport.pdf?seq=3&ids=1237">\n\t\t\tDownload Document\n\t\t\t</a>\n\t\t</td>\n\t\t</tr>\n\t   \n    \t\t\n\n\t \n\t\n    \n    \t            \n\n\t\n\t\t     \n\t\n\t<tr id="1" onClick="onRowClick(1)" style = "border-bottom-color: #FFFFFF;">\n\t\t<td align="left" valign="middle" id="rowExpStatus1"> + </td>\n\t    <td align="left" valign="top" >\n\t        \n\t         \n\t\n\t        \n\t             \n\t        \n\t        \tInitial report\n\t       \n\n\t    </td>\n\t    <td >\n\t    \t-\n\t    </td>\n\t    <td>\n\t    \t-\n\t    </td>\n\t    <td>\n\t    \t-\n\t    </td>\n\t    </tr>\n\n\t\t<tr id="doc1" hidden=true class="detailDocRow">\n\t\t<td></td>\n\t\t\n\t\t<td >\n\t       \t<a style= "font-weight: normal" target="new" download href="getReport.pdf?seq=4&ids=1237">\n\t\t\tDownload Document\n\t\t\t</a>\n\t\t</td>\n\t\t</tr>\n\t   \n    \t\t\n\n\t \n\t\n    \n    \t            \n \n</tbody>\n</table> \n</div>\n\n<br />\n<button type="button" class="btn btn-primary" onclick="javascript:document.location.href=\'search_options.do\';">\n\t<span class="glyphicon glyphicon-repeat" aria-hidden="true"></span> Search again\n</button>\n\n\n\n        \n      \n  \n\n\n</form>\n\n</div>\n</div>\n\n\n\n</section>\n\t\n\n\n <aside class="module tert-lvl-sidebar">\n        <h5 class="heading-module">Related Pages</h5>\n        <ul>\n            <li><a href="http://www.hennepin.us/residents/elections/campaign-finance">Campaign finance information </a></li>\n            <li><a href="http://www.hennepin.us/residents/elections/file-for-office">File for office </a></li>\n            <li><a href="http://www.hennepin.us/residents/elections/campaign-finance#campaign-contrib-limits">Contribution limits</a></li>\n        </ul>\n    </aside>\n\n\n\t\n\t<script src="https://ajax.googleapis.com/ajax/libs/jquery/1.11.2/jquery.min.js"></script>\n</div>\n\t\n\n\n\n\n<footer class="site-footer">\n\t<h1 class="site-footer__heading desktop">Hennepin County, Minnesota</h1>\t\n\t<ul class="site-footer__social-links">\n\t\t<li><a class="social-icon icon-facebook" href="https://www.facebook.com/hennepin" target="_blank"><span\tclass="visuallyhidden">Facebook</span></a></li>\n\t\t<li><a class="social-icon icon-twitter" href="https://twitter.com/Hennepin" target="_blank"><span class="visuallyhidden">Twitter</span></a></li>\n\t\t<li><a class="social-icon icon-youtube"\thref="http://www.youtube.com/user/HennepinMN" target="_blank"><span\tclass="visuallyhidden">YouTube</span></a></li>\n\t\t<li><a class="social-icon icon-linkedin" href="http://www.linkedin.com/company/hennepin-county" target="_blank"><span class="visuallyhidden">LinkedIn</span></a></li>\n\t</ul>\n\t<p class="site-footer__site-legal"><a href="http://www.hennepin.us/your-government/open-government/accessibility-privacy-security.aspx">Privacy</a>|&nbsp; &nbsp;Copyright <script>document.write(new Date().getFullYear());</script></p>\n</footer>\n<a class="top-reminder icon-btn-top-arrow" href="#">Top</a>\n      \n\n<script>window.jQuery || document.write(\'<script src="/cfrs/assets/js/vendor/jquery-1.11.3.min.js"><\\/script>\')</script>\n<script src="/cfrs/assets/js/plugins.js"></script>\n<script src="/cfrs/assets/js/main.js"></script>\n\n\n<script>\n\n  (function(i,s,o,g,r,a,m){i[\'GoogleAnalyticsObject\']=r;i[r]=i[r]||function(){\n  (i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),\n  m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)\n  })(window,document,\'script\',\'//www.google-analytics.com/analytics.js\',\'ga\');\n\n  ga(\'create\', \'UA-75832919-1\', \'auto\');\n  ga(\'send\', \'pageview\');\n\n</script>\n\n\n\n</body>\n</html>\n\n<script id="f5_cspm">(function(){var f5_cspm={f5_p:\'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\',setCharAt:function(str,index,chr){if(index>str.length-1)return str;return str.substr(0,index)+chr+str.substr(index+1);},get_byte:function(str,i){var s=(i/16)|0;i=(i&15);s=s*32;return((str.charCodeAt(i+16+s)-65)<<4)|(str.charCodeAt(i+s)-65);},set_byte:function(str,i,b){var s=(i/16)|0;i=(i&15);s=s*32;str=f5_cspm.setCharAt(str,(i+16+s),String.fromCharCode((b>>4)+65));str=f5_cspm.setCharAt(str,(i+s),String.fromCharCode((b&15)+65));return str;},set_latency:function(str,latency){latency=latency&0xffff;str=f5_cspm.set_byte(str,40,(latency>>8));str=f5_cspm.set_byte(str,41,(latency&0xff));str=f5_cspm.set_byte(str,35,2);return str;},wait_perf_data:function(){try{var wp=window.performance.timing;if(wp.loadEventEnd>0){var res=wp.loadEventEnd-wp.navigationStart;if(res<60001){var cookie_val=f5_cspm.set_latency(f5_cspm.f5_p,res);window.document.cookie=\'f5avr1234567890aaaaaaaaaaaaaaaa_cspm_=\'+encodeURIComponent(cookie_val)+\';path=/;\'+\'\';}\nreturn;}}\ncatch(err){return;}\nsetTimeout(f5_cspm.wait_perf_data,100);return;},go:function(){var chunk=window.document.cookie.split(/\\s*;\\s*/);for(var i=0;i<chunk.length;++i){var pair=chunk[i].split(/\\s*=\\s*/);if(pair[0]==\'f5_cspm\'&&pair[1]==\'1234\')\n{var d=new Date();d.setTime(d.getTime()-1000);window.document.cookie=\'f5_cspm=;expires=\'+d.toUTCString()+\';path=/;\'+\';\';setTimeout(f5_cspm.wait_perf_data,100);}}}}\nf5_cspm.go();}());</script><script id="f5_cspm">(function(){var f5_cspm={f5_p:\'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\',setCharAt:function(str,index,chr){if(index>str.length-1)return str;return str.substr(0,index)+chr+str.substr(index+1);},get_byte:function(str,i){var s=(i/16)|0;i=(i&15);s=s*32;return((str.charCodeAt(i+16+s)-65)<<4)|(str.charCodeAt(i+s)-65);},set_byte:function(str,i,b){var s=(i/16)|0;i=(i&15);s=s*32;str=f5_cspm.setCharAt(str,(i+16+s),String.fromCharCode((b>>4)+65));str=f5_cspm.setCharAt(str,(i+s),String.fromCharCode((b&15)+65));return str;},set_latency:function(str,latency){latency=latency&0xffff;str=f5_cspm.set_byte(str,40,(latency>>8));str=f5_cspm.set_byte(str,41,(latency&0xff));str=f5_cspm.set_byte(str,35,2);return str;},wait_perf_data:function(){try{var wp=window.performance.timing;if(wp.loadEventEnd>0){var res=wp.loadEventEnd-wp.navigationStart;if(res<60001){var cookie_val=f5_cspm.set_latency(f5_cspm.f5_p,res);window.document.cookie=\'f5avr1234567890aaaaaaaaaaaaaaaa_cspm_=\'+encodeURIComponent(cookie_val)+\';path=/;\'+\'\';}\nreturn;}}\ncatch(err){return;}\nsetTimeout(f5_cspm.wait_perf_data,100);return;},go:function(){var chunk=window.document.cookie.split(/\\s*;\\s*/);for(var i=0;i<chunk.length;++i){var pair=chunk[i].split(/\\s*=\\s*/);if(pair[0]==\'f5_cspm\'&&pair[1]==\'1234\')\n{var d=new Date();d.setTime(d.getTime()-1000);window.document.cookie=\'f5_cspm=;expires=\'+d.toUTCString()+\';path=/;\'+\';\';setTimeout(f5_cspm.wait_perf_data,100);}}}}\nf5_cspm.go();}());</script>'


def test_complete_offered_inventory_preserves_every_selector():
    result = local.hennepin_offered_inventory(CATALOGUE.encode(), URL, "1237")
    assert [m["source_report_id"] for m in result["members"]] == ["1", "2", "3", "4"]
    assert [m["label"] for m in result["members"]] == [
        "2026 Pre-general report",
        "2026 Pre-primary report",
        "2025 Annual report",
        "Initial report",
    ]
    assert result["account_name_as_source"] == "Example, Candidate"
    assert all(m["line"] > 0 for m in result["members"])
    assert "version_as_of" not in result  # Only verified acquisition may supply it.


@pytest.mark.parametrize(
    "mutation",
    [
        lambda s: (
            s + "<script>document.querySelector('#reports_2').innerHTML='';</script>"
        ),
        lambda s: s + '<script src="https://example.test/page2.js"></script>',
        lambda s: s.replace('id="reports_2"', 'id="reports_2" data-url="page2.json"'),
        lambda s: s.replace("</tbody>", "<tr><td>More documents</td></tr></tbody>"),
        lambda s: s.replace(
            "getReport.pdf?seq=4&ids=1237", "getReport.pdf?seq=3&ids=1237"
        ),
        lambda s: s.replace(
            "getReport.pdf?seq=4&ids=1237", "getReport.pdf?seq=4&ids=1247"
        ),
        lambda s: s.replace("onRowClick(4)", "unknownToggle(4)"),
        lambda s: s.replace('id="4" onClick=', 'id="4" hidden onClick='),
        lambda s: s.replace("</form>", "<button>Next page</button></form>"),
        lambda s: s.replace(
            "</form>", '<a href="getreports.do?page=2">Next</a></form>'
        ),
        lambda s: s.replace("function onRowClick(id)", "function otherRowClick(id)"),
    ],
)
def test_unknown_or_incomplete_offered_inventory_refuses(mutation):
    with pytest.raises(ComparisonImportError):
        local.hennepin_offered_inventory(mutation(CATALOGUE).encode(), URL, "1237")


def inventory_locator():
    return {
        "kind": "offered_inventory_version",
        "profile": local.HENNEPIN_INVENTORY_PROFILE,
        "receipt_sha256": "a" * 64,
        "members": [
            {"source_report_id": "1", "receipt_sha256": "a" * 64},
            {"source_report_id": "2", "receipt_sha256": "b" * 64},
        ],
    }


@pytest.mark.parametrize("field", ["url", "copied_at"])
def test_catalogue_metadata_must_match_checked_inventory_capture(
    db, inventory_generation, field
):
    item = inventory_generation
    payload = deepcopy(item.g)
    payload.pop("id")
    catalogue_hash = item.report["version_binding"]["facts"]["version_sources"][0][
        "source_sha256"
    ]
    source = next(s for s in payload["sources"] if s["sha256"] == catalogue_hash)
    source[field] = (
        URL.replace("ids=1237", "ids=1247")
        if field == "url"
        else "2026-11-13T00:00:00+00:00"
    )
    proposed = storage.prepare_generation(payload)
    with pytest.raises(ComparisonImportError, match="Inventory source metadata"):
        storage.stage_generation(db, item.store, proposed, item.originals)


def test_companions_are_discovered_only_in_closed_locator():
    locator = inventory_locator()
    binding = {"adapter": "local_checked_reading:v1", "locator": locator}
    assert storage.local_reading_ids(binding) == {"a" * 64, "b" * 64}
    assert storage.local_reading_ids({"receipt_sha256": "c" * 64}) == set()
    locator["members"][1]["anything_else"] = "c" * 64
    with pytest.raises(ComparisonImportError):
        storage.local_reading_ids(binding)


@pytest.mark.parametrize(
    "change",
    [
        lambda v: v["members"].reverse(),
        lambda v: v["members"].append(deepcopy(v["members"][0])),
        lambda v: v.update(receipt_sha256="c" * 64),
        lambda v: v.update(effective=True),
        lambda v: v.update(profile="invented:v1"),
        lambda v: v["members"][1].update(receipt_sha256="a" * 64),
        lambda v: v["members"][1].update(source_report_id="01"),
        lambda v: v.update(members=[]),
    ],
)
def test_ambiguous_or_caller_decided_inventory_locators_refuse(change):
    locator = inventory_locator()
    change(locator)
    with pytest.raises(ComparisonImportError):
        storage.inventory_reading_ids(locator)


def family_inputs():
    return (
        {"label": "2026 Pre-general report"},
        {
            "document_role": "primary",
            "report": {
                "period_start": "2026-07-28",
                "period_end": "2026-10-19",
                "report_type": None,
            },
        },
        {"fields": []},
    )


def test_catalogue_family_does_not_fill_raw_report_type_or_initial_year():
    from alethical.pipeline.election_local_sources import _inventory_family

    row, values, receipt = family_inputs()
    assert _inventory_family(row, values, receipt) == ("2026", "Pre-general")
    assert values["report"]["report_type"] is None
    row["label"] = "Initial report"
    values["report"].update(period_start="2025-11-16", period_end="2026-03-09")
    assert _inventory_family(row, values, receipt) == (None, "Initial")


@pytest.mark.parametrize(
    "change",
    [
        lambda r, v, f: r.update(label="2026 Amended pre-general report"),
        lambda r, v, f: v.update(document_role="supplement"),
        lambda r, v, f: v["report"].update(period_end=None),
        lambda r, v, f: v["report"].update(period_start="2027-01-01"),
        lambda r, v, f: v["report"].update(
            period_end="2025-10-19", period_start="2025-01-01"
        ),
        lambda r, v, f: v["report"].update(report_type="Amended pre-general"),
        lambda r, v, f: v["report"].update(report_type="Pre-primary"),
        lambda r, v, f: f["fields"].append(
            {
                "field_id": "cover.report_type.amended",
                "record_type": "cover",
                "label": "Amended",
                "literal": "X",
                "state": "value",
                "value_type": "mark",
                "normalized": "marked",
            }
        ),
        lambda r, v, f: f["fields"].append(
            {
                "field_id": "cover.report_type.pre_general",
                "record_type": "cover",
                "label": "Pre-general",
                "literal": "?",
                "state": "ambiguous",
                "value_type": "mark",
                "normalized": None,
            }
        ),
    ],
)
def test_potential_competitor_uncertainty_never_becomes_an_effective_family(change):
    from alethical.pipeline.election_local_sources import _inventory_family

    row, values, receipt = family_inputs()
    change(row, values, receipt)
    with pytest.raises(ComparisonImportError):
        _inventory_family(row, values, receipt)


# Normal database fixtures below use invented source bytes and actual retained
# provenance/reading APIs. They never forge verifier seals or approve real data.


@pytest.fixture
def inventory_generation(db, local_generation):  # noqa: F811
    old = local_generation
    store = old.store
    originals, metadata = {}, {}
    copied = "2026-11-12T00:00:00+00:00"
    entry = "https://www16.co.hennepin.mn.us/cfrs/search_options.do"
    parameters = [
        ("filterBy", ""),
        ("searchBy", "candidate"),
        ("fullname", ""),
        ("ids", ""),
        ("alpha", ""),
        ("city", ""),
        ("office", ""),
        ("district", ""),
        ("ps", "284"),
    ]
    controls = "".join(
        f'<input type="hidden" name="{k}" id="{k}" value="{v}">' for k, v in parameters
    )
    account_html = (
        f'<form action="search.do">{controls}<table><thead><tr>'
        '<th data-field="candidate_name">Name</th><th data-field="location">Location</th>'
        '<th data-field="office">Office</th><th data-field="district">District</th></tr></thead>'
        "<tbody><tr><td><a href=\"#\" onclick=\"document.getElementById('fullname').value='Example, Candidate';document.getElementById('ids').value='1237';sub();\">Example, Candidate</a></td>"
        "<td>Crow Wing County</td><td>County Commissioner</td><td>3</td></tr></tbody></table></form>"
        '<script>function sub(){frm = document.forms[0];frm.action="getreports.do"\nfrm.submit();}</script>'
    ).encode()
    county = b"18;Crow Wing;62\n"
    county_url = "https://electionresultsfiles.sos.mn.gov/20261103/Cntytbl.txt"
    directory_url = local.DIRECTORIES["mn_cfb_local_directory"]
    directory = (
        '<div class="link-list"><h2>County</h2><ul class="link-list">'
        f'<li class="link-item"><a href="{entry}">Crow Wing</a></li></ul></div>'
    ).encode()

    def capture(body, url, media, *, captured_at=None):
        captured_at = captured_at or copied
        h = hashlib.sha256(body).hexdigest()
        originals[h] = body
        archive_source(db, store, body)
        metadata[h] = dict(
            sha256=h,
            url=url,
            media_type=media,
            copied_at=captured_at,
            authority=None if url == county_url else "local:county:18",
        )
        evidence = json.dumps(
            dict(
                requested_url=url,
                final_url=url,
                state="captured",
                redirects=[],
                sha256=h,
                bytes=len(body),
                fetched_at=captured_at,
                content_type=media,
            )
        ).encode()
        receipt = provenance.prepare_acquisition(evidence)
        row = provenance.record_provenance(
            db,
            store,
            receipt=receipt,
            evidence_body=evidence,
            decision="checked",
            reviewed_by="PRIVATE_TEST_REVIEWER",
            reason="Synthetic capture",
            expected_previous_id=None,
        )
        return row

    directory_row = capture(directory, directory_url, "text/html")
    county_row = capture(county, county_url, "text/plain")
    entry_row = capture(account_html, entry, "text/html")
    catalogue_row = capture(CATALOGUE.encode(), URL, "text/html")
    directory_hash = hashlib.sha256(directory).hexdigest()
    county_hash = hashlib.sha256(county).hexdigest()
    entry_hash = hashlib.sha256(account_html).hexdigest()
    catalogue_hash = hashlib.sha256(CATALOGUE.encode()).hexdigest()
    root = dict(
        schema=provenance.RECIPIENT,
        original_routing_group="mn-local:county:18",
        election_date="2026-11-03",
        recipient=dict(
            namespace="county",
            source_id="18",
            county_ids=["18"],
            district_type=None,
            municipality_type=None,
        ),
        sos_rows=[
            dict(
                source_sha256=county_hash,
                line=1,
                literal=county.decode().strip(),
                kind="county",
                acquisition_receipt_id=county_row.receipt_sha256,
            )
        ],
        directory=dict(
            family="mn_cfb_local_directory",
            source_sha256=directory_hash,
            source_url=directory_url,
            acquisition_receipt_id=directory_row.receipt_sha256,
            anchor_index=1,
            line=1,
            label="Crow Wing",
            category="County",
            href=entry,
            base_href=None,
            shared_target_entries=[],
        ),
        publisher_namespace="synthetic-hennepin",
        entry_url=entry,
        claim_scope="official_publisher_for_typed_recipient",
    )
    root_row = provenance.record_provenance(
        db,
        store,
        receipt=root,
        decision="checked",
        reviewed_by="PRIVATE_TEST_REVIEWER",
        reason="Synthetic root",
        expected_previous_id=None,
    )
    portal = local._HTML(account_html)
    account_edge = dict(
        kind="hennepin_account_form",
        source_sha256=entry_hash,
        anchor_index=1,
        line=portal.all("a")[0].line,
        name_as_source="Example, Candidate",
        account_id="1237",
        target_url=URL,
    )
    assert (
        local.replay_hennepin_account_form(account_html, entry, account_edge)[0] == URL
    )
    catalogue = local._HTML(CATALOGUE.encode())
    documents = []
    for seq, kind, start, end in [
        ("1", "Pre-general", "07/28/26", "10/19/26"),
        ("2", "Pre-primary", "01/01/26", "07/27/26"),
        ("3", "Annual", "01/01/25", "12/31/25"),
        ("4", "Initial", "08/17/25", "08/18/25"),
    ]:
        body = native_pdf(
            {
                "office": "County Commissioner District 3",
                "period": (395, 184, 10, f"From {start} to {end}"),
                "candidate_mark": (30, 157, 10, "X Candidate"),
                "report_mark": (330, 155, 10, "X"),
                "report_type": (345, 155, 10, kind),
            }
        )
        url = f"https://www16.co.hennepin.mn.us/cfrs/getReport.pdf?seq={seq}&ids=1237"
        pdf_row = capture(
            body,
            url,
            "application/pdf",
            captured_at="2026-11-12T01:00:00+00:00" if seq == "3" else None,
        )
        fields = [
            readings.field_proposal(
                "cover." + key,
                page=1,
                bounds=bounds,
                label=label,
                literal=literal,
                value_type=value_type,
                currency="USD" if value_type == "money" else None,
            )
            for key, label, literal, value_type, bounds in [
                (
                    "name",
                    "Name of candidate or committee",
                    "Synthetic Candidate",
                    "text",
                    [197, 98, 585, 115],
                ),
                (
                    "office",
                    "Office sought",
                    "County Commissioner District 3",
                    "text",
                    [97, 121, 585, 137],
                ),
                ("candidate_mark", "Candidate", "X", "mark", [20, 145, 45, 165]),
                ("period_start", "From", start, "date", [420, 170, 480, 188]),
                ("period_end", "To", end, "date", [500, 170, 585, 188]),
                ("report_type", kind, "X", "mark", [320, 145, 340, 165]),
                (
                    "total_received",
                    "TOTAL AMOUNT RECEIVED",
                    "1482.11",
                    "money",
                    [258, 347, 305, 364],
                ),
            ]
        ]
        href = f"getReport.pdf?seq={seq}&ids=1237"
        anchor = next(
            (i, n)
            for i, n in enumerate(catalogue.all("a"), 1)
            if n.attrs.get("href") == href
        )
        context = dict(
            kind=local.CONTEXT_KIND,
            root_receipt_id=root_row.receipt_sha256,
            recipient_binding=None,
            edges=[
                dict(kind="acquisition", receipt_id=entry_row.receipt_sha256),
                account_edge,
                dict(kind="acquisition", receipt_id=catalogue_row.receipt_sha256),
                dict(
                    kind="html_anchor",
                    source_sha256=catalogue_hash,
                    anchor_index=anchor[0],
                    line=anchor[1].line,
                    href=href,
                    label="Download Document",
                    base_href=None,
                    target_url=url,
                ),
                dict(kind="acquisition", receipt_id=pdf_row.receipt_sha256),
            ],
            publisher_account=dict(
                kind=local.HENNEPIN_ACCOUNT,
                namespace="synthetic-hennepin",
                issued_id=True,
                account_id="1237",
                name_as_source="Example, Candidate",
                location="Crow Wing County",
                office="County Commissioner",
                district="3",
            ),
            document_role="primary",
            fields=dict(
                name="cover.name",
                office="cover.office",
                candidate_name="cover.name",
                candidate_mark="cover.candidate_mark",
                period_start="cover.period_start",
                period_end="cover.period_end",
                report_type=["cover.report_type"],
            ),
        )
        receipt = readings.prepare_receipt(
            body,
            fields=fields,
            document_kind="financial_report",
            source_context=context,
            reading_scope=dict(
                cover=dict(page=1, bounds=[0, 0, 612, 792]),
                regions=[dict(page=1, bounds=[0, 0, 612, 792], role="cover")],
            ),
        )
        row = readings.record_reading(
            db,
            store,
            receipt=receipt,
            decision="checked",
            reviewed_by="PRIVATE_TEST_REVIEWER",
            reason="Synthetic visible fields",
            expected_previous_id=None,
        )
        documents.append(
            SimpleNamespace(
                seq=seq, receipt=receipt, row=row, pdf_row=pdf_row, body=body
            )
        )
    ids = [d.row.receipt_sha256 for d in documents]
    proof = readings.load_verified_reading_context(
        db,
        store,
        ids,
        allowed_source_hashes=set(originals),
        election_date=old.race.payload.get("election_date") or date(2026, 11, 3),
    )
    selected = documents[0]
    rid = selected.row.receipt_sha256
    info = metadata[selected.receipt["original_sha256"]]
    values = proof.local_values(rid)

    def binding(kind, field=None):
        locator = dict(kind=kind, receipt_sha256=rid)
        if field is not None:
            locator["field_id"] = field
        if kind == "offered_inventory_version":
            locator.update(
                profile=local.HENNEPIN_INVENTORY_PROFILE,
                members=[
                    dict(source_report_id=d.seq, receipt_sha256=d.row.receipt_sha256)
                    for d in documents
                ],
            )
        extracted = source_adapter.extract_local_reading(
            selected.body, info, locator, context=proof
        )
        return dict(
            source_sha256=info["sha256"],
            adapter="local_checked_reading:v1",
            locator=locator,
            quote=extracted.quote,
            facts=extracted.facts,
        )

    report = values["report"] | dict(
        report_key=digest("synthetic inventory selected report"),
        source_sha256=info["sha256"],
        check_status="checked",
        binding=binding("report"),
        figures=[],
        version_binding=binding("offered_inventory_version"),
    )
    figure = binding("figure", "cover.total_received")
    report["figures"] = [
        {
            k: v
            for k, v in figure["facts"].items()
            if k not in {"authority", "account_id", "source_report_id"}
        }
        | {"binding": figure}
    ]
    sources = {s["sha256"]: s for s in old.g["sources"]} | metadata
    payload = {k: deepcopy(v) for k, v in old.g.items() if k != "id"}
    payload.update(
        sources=list(sources.values()),
        authorities=[
            values["authority"] | dict(status="checked", binding=binding("authority"))
        ],
        accounts=[
            values["account"] | dict(status="checked", binding=binding("account"))
        ],
        reports=[report],
        payments=[],
    )
    generation = storage.prepare_generation(payload)
    return SimpleNamespace(
        g=generation,
        report=report,
        store=store,
        originals=old.originals | originals,
        documents=documents,
        proof=proof,
        info=info,
        catalogue_row=catalogue_row,
        base=old,
    )


def test_normal_version_stage_publish_keeps_companions_out_of_report_rows(
    db, inventory_generation
):  # noqa: F811
    item = inventory_generation
    storage.stage_generation(db, item.store, item.g, item.originals)
    storage.publish_generation(db, item.store, item.g["id"], expected_previous=None)
    _, loaded = storage.load_generation(db, item.g["id"])
    assert len(loaded["reports"]) == 1
    report = loaded["reports"][0]
    assert report["effective"] is None and report["report_type"] == "Pre-general"
    assert report["version_binding"]["facts"]["effective"] is True
    assert (
        report["version_binding"]["facts"]["version_as_of"]
        == "2026-11-12T00:00:00+00:00"
    )
    assert len(report["version_binding"]["facts"]["version_sources"]) == 5
    assert "PRIVATE_TEST" not in report["version_binding"]["quote"]
    assert "receipt_sha256" not in report["version_binding"]["quote"]


def test_companion_withdrawal_refuses_version_without_erasing_selected_raw_reading(
    db, inventory_generation
):  # noqa: F811
    item = inventory_generation
    companion = item.documents[2]
    readings.record_reading(
        db,
        item.store,
        receipt=companion.receipt,
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST_REVIEWER",
        reason="Withdraw companion proof",
        expected_previous_id=companion.row.id,
    )
    ids = [d.row.receipt_sha256 for d in item.documents]
    proof = readings.load_verified_reading_context(
        db, item.store, ids, allowed_source_hashes=set(item.originals), partial=True
    )
    selected = item.documents[0]
    rid = selected.row.receipt_sha256
    raw = source_adapter.extract_local_reading(
        selected.body, item.info, dict(kind="report", receipt_sha256=rid), context=proof
    )
    assert raw.facts["effective"] is None
    with pytest.raises(ComparisonImportError):
        source_adapter.extract_local_reading(
            selected.body,
            item.info,
            item.report["version_binding"]["locator"],
            context=proof,
        )
    with pytest.raises(ComparisonImportError):
        storage.stage_generation(db, item.store, item.g, item.originals)


@pytest.mark.parametrize(
    "changed",
    [
        lambda s: s.replace(
            'download href="getReport.pdf?seq=1',
            'download onclick="window.history.back();" href="getReport.pdf?seq=1',
        ),
        lambda s: s.replace("</body>", "</body><body></body>"),
        lambda s: s.replace(
            'href="assets/css/main.css"', 'href="assets/css/main.css" media="print"'
        ),
        lambda s: s + '<a href="getreports.do?page=2">Next</a>',
    ],
)
def test_closed_navigation_and_style_profile_cannot_borrow_an_allowed_handler(changed):
    with pytest.raises(ComparisonImportError):
        local.hennepin_offered_inventory(changed(CATALOGUE).encode(), URL, "1237")


@pytest.mark.parametrize("change", ["quote", "asof", "omission", "wrong_original"])
def test_normal_stage_rejects_forged_or_incomplete_optional_version(
    db, inventory_generation, change
):
    item = inventory_generation
    payload = deepcopy(item.g)
    report = payload["reports"][0]
    binding = report["version_binding"]
    if change == "quote":
        binding["quote"] = "Trust this label"
    elif change == "asof":
        binding["facts"]["version_as_of"] = "2026-11-13T00:00:00+00:00"
    elif change == "omission":
        binding["locator"]["members"].pop()
    else:
        binding["source_sha256"] = item.documents[2].receipt["original_sha256"]
    payload.pop("id")
    with pytest.raises(ComparisonImportError):
        proposed = storage.prepare_generation(payload)
        storage.stage_generation(db, item.store, proposed, item.originals)


@pytest.mark.parametrize("target", ["doc1", "rowExpStatus1"])
@pytest.mark.parametrize("position", ["before", "after"])
def test_disclosure_selectors_resolve_to_only_the_expected_document_node(
    target, position
):
    collision = f'<div id="{target}" hidden></div>'
    if position == "before":
        body = CATALOGUE.replace(
            '<body style="color:black" onload=fixFormat()>',
            '<body style="color:black" onload=fixFormat()>' + collision,
        )
    else:
        body = CATALOGUE.replace("</body>", collision + "</body>")
    assert body != CATALOGUE
    with pytest.raises(ComparisonImportError):
        local.hennepin_offered_inventory(body.encode(), URL, "1237")


def test_identity_review_plans_only_raw_report_receipts(monkeypatch):
    """Exercise the real review entry path, stopping before source/DB access."""

    def binding(letter):
        return {
            "adapter": "local_checked_reading:v1",
            "source_sha256": "1" * 64,
            "locator": {"kind": "report", "receipt_sha256": letter * 64},
        }

    report = {
        "report_key": "report-key",
        "binding": binding("a"),
        "status_binding": binding("b"),
        "figures": [{"binding": binding("c")}],
        "version_binding": {
            **binding("a"),
            "locator": {
                "kind": "offered_inventory_version",
                "profile": local.HENNEPIN_INVENTORY_PROFILE,
                "receipt_sha256": "a" * 64,
                "members": [
                    {"source_report_id": "1", "receipt_sha256": "a" * 64},
                    {"source_report_id": "2", "receipt_sha256": "d" * 64},
                ],
            },
        },
    }
    publisher = {"binding": binding("e")}
    account = {"binding": binding("f")}
    evidence = [
        {
            "kind": "report_cover",
            "report_key": "report-key",
            "generation_id": "9" * 64,
            "binding": binding("a"),
        }
    ]
    generation = {"id": "9" * 64, "snapshot_id": "s", "election_key": "election"}
    indexes = {
        "authorities": {"local:test": publisher},
        "accounts": {("local:test", "1237"): account},
        "reports": {"report-key": report},
    }
    monkeypatch.setattr(
        storage, "cached_review_generation", lambda *a: (None, generation)
    )
    monkeypatch.setattr(storage, "_review_indexes", lambda *a: indexes)
    planned = set()

    class Planned(Exception):
        pass

    def stop_after_planning(db, g, ids, cache):
        planned.update(ids)
        raise Planned

    monkeypatch.setattr(storage, "plan_readings", stop_after_planning)
    with pytest.raises(Planned):
        storage.validate_account_review(
            None,
            None,
            snapshot=SimpleNamespace(id="s", election_key="election"),
            race=None,
            candidate=None,
            registration_number="1237",
            authority="local:test",
            period_start=None,
            period_end=None,
            evidence=evidence,
            decision="withdrawn",
        )
    assert planned == {letter * 64 for letter in "abcef"}
    assert storage.local_reading_ids(report) == {letter * 64 for letter in "abcd"}


def publish_inventory_account(db, item):
    from alethical.pipeline import election_account_reviews as reviews

    storage.stage_generation(db, item.store, item.g, item.originals)
    storage.publish_generation(db, item.store, item.g["id"], expected_previous=None)
    account = item.g["accounts"][0]
    publisher = item.g["authorities"][0]
    args = deepcopy(item.base.args)
    args.update(
        registration_number=account["account_id"],
        authority=account["authority"],
        period_start=date.fromisoformat(item.report["period_start"]),
        period_end=date.fromisoformat(item.report["period_end"]),
    )
    args["evidence"] = [
        next(e for e in args["evidence"] if e["kind"] == "ballot"),
        *[
            {
                "kind": kind,
                "sha256": binding["source_sha256"],
                "generation_id": item.g["id"],
                "binding": binding,
                **extra,
            }
            for kind, binding, extra in [
                ("authority", publisher["binding"], {}),
                ("committee_register", account["binding"], {}),
                (
                    "report_cover",
                    item.report["binding"],
                    {"report_key": item.report["report_key"]},
                ),
            ]
        ],
    ]
    return reviews.record_decision(db, **args)


def test_companion_withdrawal_preserves_normal_recorded_candidate_identity(
    db, inventory_generation
):
    item = inventory_generation
    decision = publish_inventory_account(db, item)
    assert storage.account_review_available(
        db, decision, item.base.race, item.base.candidate, store=item.store
    )
    companion = item.documents[2]
    readings.record_reading(
        db,
        item.store,
        receipt=companion.receipt,
        decision="withdrawn",
        reviewed_by="PRIVATE_TEST_REVIEWER",
        reason="Withdraw unrelated version companion",
        expected_previous_id=companion.row.id,
    )
    assert storage.account_review_available(
        db, decision, item.base.race, item.base.candidate, store=item.store
    )
    # Strict publication still requires every companion; it must not reuse
    # the surviving raw identity decision as proof of inventory completeness.
    with pytest.raises(ComparisonImportError):
        storage.publish_generation(
            db, item.store, item.g["id"], expected_previous=item.g["id"]
        )


def test_disclosure_numeric_argument_cannot_alias_a_noncanonical_row_identifier():
    body = (
        CATALOGUE.replace(
            'id="1" onClick="onRowClick(1)"', 'id="01" onClick="onRowClick(01)"'
        )
        .replace('id="doc1"', 'id="doc01"')
        .replace('id="rowExpStatus1"', 'id="rowExpStatus01"')
    )
    assert body != CATALOGUE
    with pytest.raises(ComparisonImportError):
        local.hennepin_offered_inventory(body.encode(), URL, "1237")
