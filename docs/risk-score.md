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
| **Security signal not measured** | **+12 each** |

The unmeasured penalty applies once per collector in `{secrets, sast,
vulnerabilities, sbom}` whose status is not `ok`.

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
security: 4 unmeasured × 12                    = 48
tests:    no test evidence                     = 50
worst = 50, mean = 49
overall = round(0.6 × 50 + 0.4 × 49) = 50      → elevated
```

Nothing was found — because nothing was looked at, and the score says so. Install
the collectors and the same commit scores far lower, on evidence rather than
silence.

## Reading the reasons

`risk.reasons[]` states what raised the score and why. Anything that surprises you
should be reproducible by hand from the table above; if it is not, that is a bug
worth reporting.
