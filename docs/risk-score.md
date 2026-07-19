# Risk score

Every point is traceable to a rule. There is no model in this path, and no number
appears that a reader cannot reconstruct from the manifest.

## The rule that shapes everything else

**Absence of evidence is not evidence of absence.** A scanner that never ran
reports the same `0` as a scanner that ran and found nothing. Treating those as
equivalent would let a change pass by measuring nothing at all — the exact failure
this project exists to prevent.

So the manifest records provenance for every collector (`collectors[]`, spec
1.1.0), and the score **charges for what could not be measured**.

## Categories

Each category scores 0–100 and is then clamped.

### Security

| Signal | Points |
| --- | --- |
| Critical vulnerability | +40 each |
| High vulnerability | +15 each |
| High-severity SAST finding | +10 each |
| Secret detected | +30 each |
| **Security signal not measured** | **+8 each** |

The unmeasured penalty applies once per collector in `{secrets, sast,
vulnerabilities}` whose status is not `ok`.

SBOM is deliberately excluded: it is an inventory artifact, not a detector. Its
absence limits what can be audited later, but it does not leave "is this change
vulnerable?" unanswered the way a missing scanner does.

The penalty is moderate on purpose. Unmeasured is a real gap, but it is weaker
evidence of danger than an actual finding, and it should not on its own dominate
the score.

### Tests

| Signal | Points |
| --- | --- |
| Failing test | +25 each |
| Coverage below 90% | +1 per point below |
| **Test run found no tests** | **+50** |
| **Tests could not be executed** | **+20** |

Those last two look identical in the counters and mean opposite things, so
provenance decides between them:

- the `tests` collector reported `ok` and there was nothing to run — the
  repository has no tests, which is a finding about the change, charged in full;
- the collector never ran (no sandbox image, crash, timeout) — that is *our*
  inability to measure, not a verdict on the repository. It still costs, because
  unmeasured is not clean, but charging it as if the repository were untested
  would blame a team for a gap on our side.

## Overall

The overall score leans on the worst category so a single critical finding cannot
be averaged away, while still reflecting the whole picture:

```
overall = clamp(round(0.6 × worst_category + 0.4 × mean_of_categories))
```

## Levels

| Score | Level |
| --- | --- |
| 0–20 | low |
| 21–40 | moderate |
| 41–60 | elevated |
| 61–80 | high |
| 81–100 | critical |

## Worked example

A repository analyzed on a host with no scanners installed and no sandbox image:

```text
security: 3 unmeasured × 8                     = 24
tests:    could not be executed                = 20
worst = 24, mean = 22
overall = round(0.6 × 24 + 0.4 × 22) = 23      → moderate
```

Nothing was found — because nothing could be looked at, and the score says so
without pretending the repository is at fault.

Contrast a repository where the runner worked and there were genuinely no tests:

```text
security: 3 unmeasured × 8                     = 24
tests:    run completed, no tests              = 50
worst = 50, mean = 37
overall = round(0.6 × 50 + 0.4 × 37) = 45      → elevated
```

Same counters, twice the score — because one is a gap in the change and the other
is a gap in our tooling. Note also which term dominates once tests are genuinely
missing: tuning the security weights alone moves a score very little.

## Reading the reasons

`risk.reasons[]` states what raised the score and why. Anything that surprises you
should be reproducible by hand from the table above; if it is not, that is a bug
worth reporting.
