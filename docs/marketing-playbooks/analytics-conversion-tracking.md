# Analytics & Conversion Tracking Playbook — AdsCommand

**Version:** 1.0-local  
**Decision role:** source quality gate; never mutates provider state.

## Source checklist

- [ ] Meta spend/insights source is configured and recent.
- [ ] Google spend/insights source is configured and recent.
- [ ] GA4 source/property is identified where used.
- [ ] UTM source/medium/campaign conventions are valid.
- [ ] gclid/gbraid/wbraid/fbc fields are preserved where available.
- [ ] Date range and timezone are identical across sources.
- [ ] Zero is distinguished from unavailable/stale/partial.
- [ ] Attribution matched/unmatched rates are visible.

## Blocking rules

- Critical source unavailable → block AI/automation conclusion.
- Attribution coverage below policy → block profit optimization.
- Date ranges differ → block cross-source comparison.
- Missing click/UTM/campaign evidence → leave order unmatched.

## Output

Every check returns source, from, to, readAt, status, reason and policyVersion.
