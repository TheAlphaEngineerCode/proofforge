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
| **No test evidence collected** | **+50** |

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

```
security: 3 unmeasured × 8                     = 24
tests:    no test evidence                     = 50
worst = 50, mean = 37
overall = round(0.6 × 50 + 0.4 × 37) = 45      → elevated
```

Nothing was found — because nothing was looked at, and the score says so.

Note which term dominates: the missing test evidence (+50), not the missing
scanners (+24). Even with every scanner running clean, a change with no tests
still scores 40. That ordering is deliberate — tests are the primary evidence
that a change behaves as intended — but it means tuning the security weights
alone will not move a score much. The test weight is the lever that does.

## Reading the reasons

`risk.reasons[]` states what raised the score and why. Anything that surprises you
should be reproducible by hand from the table above; if it is not, that is a bug
worth reporting.
