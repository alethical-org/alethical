# Joel Carlson contribution-record investigation, September 19, 2026

Scope: read-only comparison of Alethical's September 1 contribution copy and the user’s downloaded September 19 CSV, followed by primary-report checks. No production records or application code changed.

## Count reconciliation
- Live registration 8692 profile: 1,194 records.
- Downloaded CSV registration 8692, Lobbyist, Contribution: 1,203 records.
- Downloaded CSV Joel Carlson name variants: 1,221 records, including 18 without registration numbers.
- Full-row comparison: 56 old rows removed, 65 new rows added. The 56 removed rows used “Joel, Carlson”; replacements use “Carlson, Joel”. They do not increase the registration-matched count.
- The net 9 added registration matches comprise 3 existing DFL House Caucus payments reclassified with registration 8692; 2 identical Callais records; 4 older special-election-related records.

## Primary report findings
1. DFL House Caucus (20006), 2025 YE original (amend=0) and amendment 1: page 8 in each lists $500 July 2, $500 July 22, and $2,000 September 25. Original received Feb 2, 2026 lists Carlson, Joel D without registration. Amendment received Apr 3, 2026 lists Lobbyist Carlson, Joel D registration 8692. Only the corrected forms occur in the newer CSV. This is a correction, not 3 newly made donations and not double counting those 3 in the newer CSV.
2. Callais (19013), 2023: all 5 published report versions inspected (special pre-primary original and amendment 1; special cycle final original and amendment 1; regular YE original). Each contains exactly one September 7, 2023 $500 Carlson registration 8692 entry. The special cycle final and regular YE versions cover Jan 1–Dec 20, 2023. The regular YE report is marked No Change Since Last Report and repeats the schedule. The CSV has two fully identical rows. Evidence supports one reported payment repeated in the download, not two distinct payments. PDF page 5 in all versions.
3. Four older entries remain unresolved: Munson 18194 $250 Feb 5, 2018 (file Year 2017); Abeler 17868 $250 Sep 30, 2015 and $250 Feb 10, 2016 (both Year 2015); Jordan 18470 $250 Jan 20, 2020 (Year 2019). Catalogues show special election cycles extending into the following calendar year, so the year difference alone is not a data error. Original and amended report requests redirect to the Board’s removal notice. No conclusion that these are corrections, duplicates or distinct additions can be made from unavailable PDFs.

## Other identical records
The CSV has 6 exact duplicate pairs overall. They must not be automatically collapsed. Latest PDFs explicitly list both payments and include both in subtotals for Bakeberg 18905 (two $250 October 3, 2023 payments, page 7), Senate Victory Fund 20013 (two $100 August 8, 2024 payments, page 8), DFL House Caucus 20006 (two $250 Jan 23, 2024 and two $500 July 30, 2024, page 12). The remaining pair is DFL Senate Caucus 20011, two $1,000 October 5, 2016 entries; the older report is outside the available PDF range and was not resolved. This is a records audit, not independent proof of actual cash movements.

## Source routes
Report catalogues: https://cfb.mn.gov/reports-and-data/viewers/campaign-finance/candidates/api (or party-unit/api), POST id, year, year_data[ElectionSegmentStartDate], year_data[ElectionSegmentEndDate], tabname=reports_data. The report parameters below identify each source version.
PDFs: https://cfb.mn.gov/rptViewer/Main.php?do=viewPDF with searchType=Candidate, downloadpdf=true, year=two-digit year, type=pcc/ptu, period=YE or C, se=0/1, regnum, amend, show=0. Both GET and POST serve the 2023 Callais PDF. Filenames encode registration, full year, period, special election flag, amendment number.
Unavailable historical reports notice: https://cfb.mn.gov/reports-and-data/campaign-finance/ . Reports temporarily removed while street addresses are removed under 2026 law; pre-2022 republishing target Jan 1, 2028, potentially earlier.

## Conclusion
1,203 is a correct count of registration-matched source rows, but not a verified count of distinct donations. At least the Callais pair repeats one reported contribution. Do not announce 1,202 as a fully validated unique total, because older records and other possible non-identical corrections have not been fully reconciled. Preserve source rows; label records accurately; obtain redacted older reports or a Board explanation before deducing a unique total. No Board inquiry sent.

## Reconciliation of Claude’s later findings
Live name-variant API rows total 1,215 / $484,799.30; the downloaded CSV totals 1,221 / $486,799.30. After normalizing only the demonstrated reversed-name correction, every live row survives; precisely 6 additional rows total $2,000. This reconciles with +9 registration matches: 6 additional source rows plus 3 existing rows gaining registration 8692. The 18 blank-registration name matches total $8,500 (including Ellison $2,500, DFL House Caucus $2,250, MN DFL State Central $500). These are name matches, not proven identity matches. CSV recipient mappings: 20006 DFL House Caucus; 20010 HRCC; 20011 DFL Senate Caucus; 20013 Senate Victory Fund (SVF). Alethical’s local backend architecture also lists these correct mappings. Claude’s reported erroneous hardcode was not provided, so its location/impact cannot be established from that claim alone.
