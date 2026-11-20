# Business Policy Template — AdsCommand

This template is the shared context for marketing playbooks and deterministic automation. Fill values through an approved settings/admin flow; do not put secrets here.

```yaml
version: "1.0"
status: draft
owner: ""
updatedAt: ""
companies:
  MBC:
    products: []
    targetAudience: []
    usp: []
    forbiddenClaims: []
    targetRoas: null
    targetCpa: null
    targetCpl: null
    minimumGrossMarginPct: null
    protectedCampaignIds: []
  MBI:
    products: []
    targetAudience: []
    usp: []
    forbiddenClaims: []
    targetRoas: null
    targetCpa: null
    targetCpl: null
    minimumGrossMarginPct: null
    protectedCampaignIds: []
automation:
  globalEnabled: false
  applyEnabled: false
  minObservedDays: 7
  minAttributionCoverage: 0.8
  maxIncreasePct: 10
  maxDecreasePct: 15
  cooldownHours: 24
  maxMutationsPerRun: 5
  maxMutationsPerDay: 5
approval:
  requiredForBudgetChange: true
  requiredForPause: true
  approvalTtlMinutes: 30
```

## Rules

- `status: draft` cannot enable automation.
- `minimumGrossMarginPct` and profit thresholds require BA approval.
- Protected campaigns cannot be changed by automatic rules.
- `globalEnabled` and `applyEnabled` default to false.
- Secrets/tokens never belong in this policy.
