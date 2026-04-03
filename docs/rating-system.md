# Rating System

Uses [OpenSkill](https://github.com/philihp/openskill.js) (Bradley-Terry model, similar to [TrueSkill](https://www.moserware.com/2010/03/computing-your-skill.html)).

## Player Ratings

Each player has three core values stored in the `ratings` table:

- **μ (mu)** — estimated average skill (default 25 for new players)
- **σ (sigma)** — uncertainty about that estimate (default 25/3 ≈ 8.33, decreases with more matches)
- **ordinal** — conservative estimate = μ − 3σ (used for leaderboard ranking)

### Rating Calculation

Ratings are recalculated by `calculateRatings()` in `packages/scraper/src/calculate-ratings.ts`. It processes all matches chronologically, updates μ/σ via OpenSkill's `rate()`, and stores results in the `ratings` table.

## Displayed Rating Score

The score shown in the UI (e.g. "44") is a **min-max normalized ordinal** mapped to 0–100 across all rated players:

```
score = (ordinal - minOrdinal) / (maxOrdinal - minOrdinal) × 100
```

**Reliability** is a saturating curve based on match count:

```
reliability = matches / (matches + K) × 100    (K = 5)
```

A player with 5 matches has 50% reliability; 20 matches → 80%; 95 matches → 95%.

Computed in `batchGetRatings()` in `packages/db/src/queries/matches.ts` and `computeRating()` in `packages/db/src/queries/players.ts`.

## Win Probability

Predicts upcoming match outcomes. Implemented in `computeWinProbability()` in both:
- `packages/db/src/queries/matches.ts` (player profile upcoming matches)
- `packages/db/src/queries/tournaments.ts` (tournament upcoming matches)

### Formula

```
P(A wins) = Φ((ordA − ordB) / √(n · β² + σA² + σB²))
```

Where:
- **ordA / ordB** = sum of (μ − 1·σ) for each player on side A / B
- **β²** = (25/3/2)² ≈ 17.36 (OpenSkill default performance variance)
- **n** = 2 (number of teams)
- **σA² / σB²** = sum of σ² for each player on side A / B
- **Φ** = standard normal CDF (approximated via error function)

### Why μ − σ instead of raw μ?

Standard TrueSkill prediction uses raw μ, but this creates a UX contradiction: new players with default μ ≈ 25 appear stronger in predictions than proven players who've been rated below 25 through many matches — even though the displayed rating scores (ordinal-based) show the opposite.

Using μ − 1·σ as the conservative skill estimate makes win probability a function of **both skill and reliability**:

| Scenario | Result |
|---|---|
| Two proven players (low σ) | Pure skill comparison |
| Proven vs new, same μ | Proven player favored (~75%) |
| Two new players (high σ) | Fair 50/50 |

This keeps win probability **consistent with the displayed rating scores**.

### Comparison of approaches

Using the example: Sandra C. (μ=21.4, σ=3.5, 97 matches) + Ana Rita (μ=24.9, σ=3.5, 91 matches) vs Kseniya (μ=26.6, σ=8.2, 1 match) + Ekaterina (μ=25.6, σ=7.9, 3 matches):

| Method | Sandra+Ana Rita win% | Problem |
|---|---|---|
| Raw μ, old denominator | 32% | Wrong formula AND contradicts displayed ratings |
| Raw μ, correct β² (pure TrueSkill) | 27% | Mathematically correct but contradicts displayed ratings |
| μ − 1·σ, correct β² (our approach) | 63% | Consistent with displayed ratings (44, 49 vs 32, 32) |
| μ − 3·σ (full ordinal), correct β² | 99% | Too extreme — implies new players can never win |

We chose **z=1** as the sweet spot: meaningful uncertainty penalty without being too harsh on new players.

### OpenSkill constants

From OpenSkill defaults (no custom options passed):
- `mu = 25`
- `sigma = mu / z = 25 / 3 ≈ 8.333`
- `beta = sigma / 2 ≈ 4.167`
- `betaSq = beta² ≈ 17.36`
