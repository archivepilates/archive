# Employment contract monthly schedule revision

- Branch: `codex/mini/employment-monthly-hours`
- eformsign account: `archivepilates@gmail.com`
- Existing template: `9776da78193c45609263b65289701474`
- New title: 아카이브필라테스 정규직 근로계약서 (2026)
- Source: `scripts/documents/create_fulltime_contract_2026_v7.py`
- PDF: `output/pdf/아카이브필라테스_정규직_근로계약서_2026_v7.pdf`

## Implemented and verified

- Changed title, body brand references, footer and PDF metadata to Korean at the user's request.
- Removed daily time table and 16 eformsign time input widgets. Nine date, identity and signature widgets remain.
- Retained Monday-Saturday, 40 hours per week. Daily hours and breaks are provided in an agreed monthly schedule before application and retained as an attachment.
- Preserved contract period and signature field positions. No changes to pay, lesson count, restrictive covenants or intellectual property clauses.
- Rendered and visually checked all three PDF pages; text extraction confirms no English brand phrase in PDF.
- Saved existing eformsign template and checked persisted title and nine widgets after editor reload.
- Existing signed documents were not edited; no document was sent or signed.

## Deployment verification

- User approved publication in this chat on 2026-09-28.
- Published saved eformsign version 5 with use-start date 2026-09-28. Template management now shows `v.5` and `사용 가능`.
- Local PDF revision v7 and eformsign version v5 are separate version sequences.
- Evidence: `output/pdf/eform-contract-v5-deployed.png`. Task-owned browser tab closed; user tabs preserved.
- No Firebase or CORE software deployment required for this standalone eformsign template. CORE operating rules were not updated in this task; the monthly-schedule procedure is documented here and in the contract, not yet in CORE.
- Source and this deployment record are scoped to the task branch; rendered PDF and screenshots remain local artifacts.
