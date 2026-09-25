# Client portal: architecture overview

Maintained by Lena. Describes release 2.0. Acme Studio is a fictional demo company.

## Components
- **Web client**: single-page application, served as static files.
- **API**: stateless service behind a load balancer, two instances in production.
- **Database**: document store for projects, files, versions and comments.
- **File storage**: object storage; files are stored under random keys, never under their names.
- **Worker**: generates previews and thumbnails from uploaded files.

## Request flow
1. The browser calls the API with a short-lived access token.
2. The API checks the session and the user's role on every request.
3. File uploads stream to storage while their SHA-256 is computed.
4. A preview job is queued; the worker writes the preview next to the original.

## Environments
| Environment | Purpose | Data |
| --- | --- | --- |
| Local | development | generated sample data |
| Staging | testing before release | anonymised copy, refreshed weekly |
| Production | clients | live data, daily backups kept 30 days |

## Deployment
- Every merge to main builds and deploys to staging automatically.
- Production deploys are manual, on Tuesdays and Thursdays, after the staging checklist.
- Database changes ship as scripts that can run twice without harm.

## Security notes
- Share links store only a hash of their token.
- Every file version keeps its checksum; restores are verified before they complete.
- Administrator actions are written to an append-only audit log.

## Open questions
- Should previews move to a separate storage bucket?
- Do we need a second worker for large PDF files?
