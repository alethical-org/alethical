# Refund card fixtures

- `refunds-17868-2026-09-12.json` is committee 17868's refund block from the public
  [Jim Abeler campaign-money response](https://api.alethical.com/api/v1/legislators/jim-abeler/campaign-finance?year=2025),
  read on September 12, 2026. The 2025 row has 180 contributions and $14,216.47;
  the 2024 amount is $10,508.22 and its count is null. Its 2015 row is not matched.
- `refunds-15667-2026-09-12.json` is committee 15667's refund block from the public
  [D Scott Dibble campaign-money response](https://api.alethical.com/api/v1/legislators/5c0c43f8-f595-4ca8-a77a-58c628046c0a/campaign-finance?year=2025),
  read on September 12, 2026. Its matched 2015 and 2017 rows surround the missing
  2016 summary, so it can test the accepted rule for a gap between matching years.
- `refunds-source-notes-2026-09-12.json` contains the source metadata extracted from
  the 12 held, published candidate PDFs. Every compressed and decompressed file
  passed its saved hash before the text was read. These fields were added to the
  saved summaries on September 12, 2026 without changing a figure, match, copy
  date or missing-year classification. The old public response did not yet serve
  these fields when the 2 refund blocks above were copied.

The Board's [historical refund program page](https://cfb.mn.gov/citizen-resources/board-programs/public-subsidy-of-campaigns/historical-use-of-public-subsidy-program/)
links the PDFs. The accepted drawing contains invented figures outside its 2025
and 2021 Abeler examples; these fixtures retain the source figures instead.
