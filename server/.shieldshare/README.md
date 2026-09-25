# .shieldshare

Server-side assets that are not user data.

- `canary/`: template content for canary (decoy) files (spec §14). Each file here is seeded
  into every user's workspace as a normal file flagged `isCanary`. The file name is the
  canary's name, so adding, removing or renaming a template changes the canaries new users
  receive (run `npm run canaries:backfill` for existing users). All content is fictional.
