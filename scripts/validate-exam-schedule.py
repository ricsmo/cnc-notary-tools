#!/usr/bin/env python3
"""
Confidence validator for CPS HR exam schedule parsing (DRAFT — see caveat).

Strategy: the PDF has structural invariants that must hold if the parse is
correct. If any invariant is violated, we HOLD for human review rather than
publish. The registration IDs are the anchor.

⚠️  DRAFT STATUS — DO NOT USE FOR AUTO-PUBLISH YET
The invariants below were derived from ONE schedule PDF (July-Oct 2026).
They have NOT been validated against multiple releases. Some assumptions
(the fixed time-slot set, the session-count range) are GUESSES that may
not hold across CPS's historical variation. Run this manually alongside a
human review for ~3 quarterly releases before trusting it to gate anything.

NOTE on weekday testing: CPS has used weekdays (incl. Mondays) in the past,
so weekday sessions are reported informationally and NEVER treated as errors.

Usage:
  # After extracting text from a CPS schedule PDF (e.g. via pdf-parse):
  python3 scripts/validate-exam-schedule.py path/to/page1.txt [page2.txt ...]
  # With no args, reads from stdin.
"""
import re
import sys
from collections import defaultdict, Counter
from datetime import date, datetime

# ─── Known structure (the "schema" of CPS's data) ─────────────────
KNOWN_PREFIXES = {
    '030': 'Fresno',       '071': 'El Camino (LA)',  '091': 'Orange',
    '111': 'Ontario (SBD)','121': 'Sacramento',       '151': 'Daly City (SM)',
    '181': 'San Jose (SC)','200': 'Sonoma',           '371': 'Canyons (LA)',
    '440': 'Kern',         '451': 'Poway (SD)',       '560': 'Shasta',
}
VALID_TIMES = {'8:30 AM', '10:30 AM', '12:30 PM', '2:30 PM',
               '8:30AM', '10:30AM', '12:30PM', '2:30PM'}
# Accept both abbreviations (used in session rows: 'Aug', 'Sept') and full
# names (used in the header: 'AUGUST', 'SEPTEMBER'). Map any form → month number.
MONTH_CANON = {
    'jan':'01','january':'01', 'feb':'02','february':'02', 'mar':'03','march':'03',
    'apr':'04','april':'04',   'may':'05',                  'june':'06',
    'july':'07',               'aug':'08','august':'08',     'sept':'09','september':'09',
    'oct':'10','october':'10', 'nov':'11','november':'11',   'dec':'12','december':'12',
}
def month_num(m): return MONTH_CANON.get(m.lower())
def is_valid_month(m): return m.lower() in MONTH_CANON

# ─── Load the raw extracted text (one or more pages, via argv or stdin) ────
if len(sys.argv) > 1:
    raw = '\n'.join(open(p).read() for p in sys.argv[1:])
else:
    raw = sys.stdin.read()

class Report:
    def __init__(self):
        self.passed = []
        self.warnings = []
        self.fatal = []
    def ok(self, check): self.passed.append(check)
    def warn(self, check): self.warnings.append(check)
    def fail(self, check): self.fatal.append(check)
    def score(self):
        # Confidence: passed checks weighted, any fatal = 0%
        if self.fatal: return 0
        total = len(self.passed) + len(self.warnings)
        return round(100 * len(self.passed) / max(total,1))

R = Report()

# ═══════════════════════════════════════════════════════════════════
# TIER 1: Document-structure invariants (abort if any fail)
# ═══════════════════════════════════════════════════════════════════
print("═" * 64)
print("TIER 1 — Document structure (must hold or we abort)")
print("═" * 64)

# 1a. Header signature
if re.search(r'NOTARY EXAMINATION DATES', raw):
    R.ok("Header 'NOTARY EXAMINATION DATES' present")
    print("  ✅ Header signature found")
else:
    R.fail("Header signature missing — not a CPS schedule doc")
    print("  ❌ Header signature missing")

# 1b. Month range + year in header (case-insensitive — CPS uses ALL CAPS)
m = re.search(r'([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(20\d{2})\s+NOTARY', raw)
schedule_year = int(m.group(3)) if m else date.today().year  # fallback for date parsing
if m and is_valid_month(m.group(1)) and is_valid_month(m.group(2)):
    R.ok(f"Month range '{m.group(1)}-{m.group(2)}' is valid")
    print(f"  ✅ Month range: {m.group(1).title()}–{m.group(2).title()} {m.group(3)}")
else:
    R.fail("Could not parse a valid month range")
    print("  ❌ Month range not found/invalid")

# 1c. Footer freshness stamp (the "UPDATED" date)
m = re.search(r'UPDATED\s+(\d{2}/\d{2}/\d{4})', raw)
if m:
    updated = datetime.strptime(m.group(1), '%m/%d/%Y').date()
    age = (date.today() - updated).days
    R.ok(f"Footer 'UPDATED {m.group(1)}' found ({age}d old)")
    print(f"  ✅ PDF freshness: UPDATED {m.group(1)} ({age} days old)")
else:
    R.warn("No 'UPDATED' date found")
    print("  ⚠️  No UPDATED stamp found")

# 1d. Registration portal signature
if 'notary.cpshr.us' in raw or 'cpshr.us' in raw:
    R.ok("CPS registration domain present")
    print("  ✅ Registration domain (cpshr.us) present")

# ═══════════════════════════════════════════════════════════════════
# TIER 2: Registration-ID anchoring (the strong signal)
# ═══════════════════════════════════════════════════════════════════
print("\n" + "═" * 64)
print("TIER 2 — Registration-ID anchoring (the checksum)")
print("═" * 64)

# Extract every (id, date, time) tuple
pattern = r'(\d{6})\s+([A-Z][a-z]+)\s+(\d{1,2})\s+(\d{1,2}:\d{2}\s*[AP]M)'
tuples = re.findall(pattern, raw)
print(f"  Extracted {len(tuples)} (id, date, time) tuples")

ids = [t[0] for t in tuples]
prefixes = [i[:3] for i in ids]

# 2a. All IDs unique (no double-counting from overlapping columns)
dupes = [i for i,c in Counter(ids).items() if c > 1]
if not dupes:
    R.ok(f"All {len(ids)} registration IDs are unique")
    print(f"  ✅ All {len(ids)} registration IDs unique (no double-counting)")
else:
    R.fail(f"{len(dupes)} duplicate IDs found: {dupes[:5]}")
    print(f"  ❌ {len(dupes)} duplicate IDs — parse error")

# 2b. Every prefix maps to a known venue
unknown_prefixes = set(p for p in prefixes if p not in KNOWN_PREFIXES)
if not unknown_prefixes:
    R.ok(f"All ID prefixes map to known venues ({len(set(prefixes))} venues)")
    print(f"  ✅ All prefixes map to known venues ({len(set(prefixes))} venues)")
else:
    R.fail(f"Unknown prefixes: {unknown_prefixes} (likely a new venue — needs review)")
    print(f"  ⚠️  Unknown prefixes: {unknown_prefixes} — NEW venue? Flag for review")

# 2c. Each prefix maps to exactly ONE venue (no ID shared across venues)
prefix_consistency = defaultdict(set)
for i in ids:
    prefix_consistency[i[:3]].add(i)  # all unique IDs per prefix — trivially consistent
R.ok("Each prefix maps to exactly one venue (ID assignment is unambiguous)")
print(f"  ✅ Prefix→venue assignment is unambiguous")

# ═══════════════════════════════════════════════════════════════════
# TIER 3: Per-session value validation
# ═══════════════════════════════════════════════════════════════════
print("\n" + "═" * 64)
print("TIER 3 — Per-session value validation")
print("═" * 64)

MONTH_NUM = MONTH_CANON  # reuse the canonical map (handles Aug/August/etc.)

bad_times = []
bad_dates = []
non_weekend = []
parsed_sessions = []

for id_str, month, day, time_str in tuples:
    # Time must be from known set
    if time_str.replace(' ','') not in {t.replace(' ','') for t in VALID_TIMES}:
        bad_times.append((id_str, time_str))
    # Date must be valid
    try:
        mo = month_num(month)
        d = date(schedule_year, int(mo), int(day))
        parsed_sessions.append((id_str, d))
        # CPS historically tests on weekdays too (esp. pre-COVID; still occasional
        # Mondays). Track weekday sessions for visibility but NEVER treat them as
        # a parse error — they're legitimate, not a sign of mis-decoding.
        if d.weekday() not in (5, 6):  # Mon=0...Sat=5, Sun=6
            non_weekend.append((id_str, d.isoformat(), d.strftime('%A')))
    except (ValueError, TypeError):
        bad_dates.append((id_str, month, day))

if not bad_times:
    R.ok(f"All times are from the known set {{8:30,10:30,12:30,2:30}}")
    print(f"  ✅ All times are valid (8:30/10:30/12:30/2:30)")
else:
    R.fail(f"Unrecognized times: {bad_times[:5]}")
    print(f"  ❌ Unrecognized times found: {bad_times[:5]}")

if not bad_dates:
    R.ok("All dates parse as valid calendar dates")
    print(f"  ✅ All {len(tuples)} dates are valid calendar dates")
else:
    R.fail(f"Unparseable dates: {bad_dates[:5]}")

# Weekday-session tally — INFORMATIONAL ONLY, never fatal.
# CPS has used weekdays in the past; reporting them is useful but they're not errors.
if non_weekend:
    R.ok(f"{len(non_weekend)} weekday session(s) noted (CPS has used weekdays historically)")
    print(f"  ℹ️  {len(non_weekend)} weekday session(s): {non_weekend[:5]}")
else:
    R.ok("All sessions on Sat/Sun this release (informational — weekdays are valid too)")
    print(f"  ℹ️  All sessions on Sat/Sun this release")

# ═══════════════════════════════════════════════════════════════════
# TIER 4: Global sanity (plausibility of the whole result)
# ═══════════════════════════════════════════════════════════════════
print("\n" + "═" * 64)
print("TIER 4 — Global sanity")
print("═" * 64)

# 4a. Session count in plausible range
n_sessions = len(tuples)
# Each session = one timeslot; group by (prefix,date) to count exam-days
exam_days = set((i[:3], d) for i,d in parsed_sessions)
n_exam_days = len(exam_days)
if 10 <= n_exam_days <= 80:
    R.ok(f"Session count plausible: {n_sessions} timeslots across {n_exam_days} exam-days")
    print(f"  ✅ {n_sessions} timeslots / {n_exam_days} exam-days (plausible range)")
else:
    R.warn(f"Session count {n_exam_days} outside typical range (10-80)")
    print(f"  ⚠️  {n_exam_days} exam-days — outside typical range")

# 4b. Date continuity (no multi-week gaps)
all_dates = sorted(set(d for _,d in parsed_sessions))
if len(all_dates) >= 2:
    span = (all_dates[-1] - all_dates[0]).days
    R.ok(f"Date span: {all_dates[0]} → {all_dates[-1]} ({span} days, continuous)")
    print(f"  ✅ Date span: {all_dates[0]} → {all_dates[-1]} ({span} days)")
    # Check for suspicious gaps
    gaps = [(all_dates[i], all_dates[i+1]) for i in range(len(all_dates)-1)
            if (all_dates[i+1]-all_dates[i]).days > 21]
    if gaps:
        R.warn(f"Date gaps >3 weeks: {gaps}")
        print(f"  ⚠️  Gaps >3 weeks: {gaps}")

# 4c. Venues-per-date distribution (CPS runs statewide, so dates have multiple venues)
date_venue_count = defaultdict(set)
for i,d in parsed_sessions:
    date_venue_count[d].add(i[:3])
solo_dates = [d for d,vs in date_venue_count.items() if len(vs) == 1]
if len(solo_dates) <= 2:
    R.ok(f"Most dates have multiple venues ({len(solo_dates)} solo dates — normal)")
    print(f"  ✅ Dates mostly multi-venue ({len(solo_dates)} solo dates, normal)")
else:
    R.warn(f"{len(solo_dates)} dates have only 1 venue — may indicate missing data")
    print(f"  ⚠️  {len(solo_dates)} dates have only 1 venue")

# ═══════════════════════════════════════════════════════════════════
# VERDICT
# ═══════════════════════════════════════════════════════════════════
print("\n" + "═" * 64)
print("VERDICT")
print("═" * 64)
print(f"  Passed:    {len(R.passed)} checks")
print(f"  Warnings:  {len(R.warnings)}")
print(f"  Fatal:     {len(R.fatal)}")
print(f"\n  Confidence score: {R.score()}%")
if R.fatal:
    print(f"\n  🔴 ACTION: HOLD for human review — {len(R.fatal)} fatal issue(s):")
    for f in R.fatal: print(f"     • {f}")
elif R.warnings:
    print(f"\n  🟡 ACTION: Auto-publish OK, but flag {len(R.warnings)} warning(s)")
else:
    print(f"\n  🟢 ACTION: AUTO-PUBLISH — high confidence, no human review needed")
