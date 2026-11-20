# Ads & Attribution Playbook — AdsCommand

**Version:** 1.0-local  
**Decision role:** structured review over existing source snapshots; no provider writes.

## Campaign review

- [ ] Campaign has stable provider ID and company scope.
- [ ] Campaign status is current.
- [ ] Budget source is identified as campaign budget, not account balance.
- [ ] Learning phase is known.
- [ ] Spend/ROAS/CPA window is declared.
- [ ] Forecast confidence meets policy.
- [ ] Profit inputs are complete before profit claims.
- [ ] Attribution coverage meets policy before revenue claims.

## Attribution review

- Exact click ID takes precedence.
- Exact UTM campaign is the next evidence level.
- Exact campaign label is the fallback evidence level.
- Ambiguous and duplicate orders remain unmatched.
- Identity fields alone never assign advertising revenue.

## Recommendation output

```text
campaign
company
current budget
proposed change (if deterministic evaluator produced one)
reason code
confidence
source references
approval required
```

The playbook may format a recommendation. Only the deterministic evaluator may produce the action and budget delta.
