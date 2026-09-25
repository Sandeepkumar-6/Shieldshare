# Demo seed data (controlled simulator, spec §30)

Original content about a fictional company, "Acme Studio". No real people, companies or
copyrighted text.

The simulator reads seed files only from `documents/`, `finance/` and `projects/` in this
directory (paths are resolved with `realpath` and must stay inside it) and uploads them to
the demo account through `POST /api/files`. It never writes here.

- Mostly low-entropy text (`.md`, `.txt`, `.csv`, `.json`, about 4–5 bits/byte), so the
  change to about 7.9 bits/byte after the simulator's transform is visible (spec §13).
- Two PDFs and one DOCX, which are already compressed (about 7.0–7.7 bits/byte) and change
  little, the contrast the entropy signal has to handle.

This README is not uploaded (only the three folders are seeded).
