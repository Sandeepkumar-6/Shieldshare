# ML feature contract

The Node backend is the source of truth (`server/src/security/features.js`). Features are sent in this exact order:

1. `ops_per_min` — write operation count divided by the configured window length in minutes.
2. `mods_per_min` — modify operation count divided by the configured window length in minutes.
3. `renames_per_min` — rename operation count divided by the configured window length in minutes.
4. `deletes_per_min` — delete operation count divided by the configured window length in minutes.
5. `dirs_affected` — distinct source and destination folders touched by writes.
6. `ext_changes` — distinct files renamed to a different extension.
7. `entropy_delta_mean` — mean non-negative entropy increase across measured modifications.
8. `entropy_delta_max` — maximum non-negative entropy increase across those modifications.
9. `hash_change_ratio` — distinct files with a changed hash divided by all distinct files touched.
10. `mean_interarrival_ms` — mean elapsed milliseconds between adjacent writes; zero for fewer than two.

Rates use the configured window duration, so a single event does not imply an infinite burst rate.
