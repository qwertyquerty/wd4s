#!/usr/bin/env python3
"""
Repair PB flags and player PB times.

For each player:
  - Sets RUN_FLAG_PB on every non-DNF run that beats their current Players.pb.
  - Clears RUN_FLAG_PB on runs that don't beat it.
  - Updates Players.pb to the fastest run's time if it improves on the stored value.

Usage:
    python fix_pbs.py [--dry-run]
"""

import sys
from wd4 import db, Players, Runs, RUN_FLAG_DNF, RUN_FLAG_PB

DRY_RUN = "--dry-run" in sys.argv


def fix_pbs():
    players = list(Players.select())
    dry = "  (DRY RUN)" if DRY_RUN else ""
    print(f"Processing {len(players)} players{dry}\n")

    total_runs_flagged = 0
    total_pbs_updated = 0

    with db.atomic():
        for player in players:
            current_pb = player.pb
            runs = list(
                Runs.select()
                .where(
                    Runs.player == player.id,
                    (Runs.flags.bin_and(RUN_FLAG_DNF)) == 0,
                )
                .order_by(Runs.time.asc())
            )

            if not runs:
                print(
                    f"[{player.id}]  pb={current_pb:.0f}"
                    "  no finished runs, skipping"
                )
                continue

            fastest_time = runs[0].time
            print(
                f"[{player.id}]  pb={current_pb:.0f}"
                f"  fastest={fastest_time:.0f}"
                f"  ({len(runs)} finished runs)"
            )

            for run in runs:
                should_be_pb = run.time < current_pb
                is_pb = bool(run.flags & RUN_FLAG_PB)

                if should_be_pb and not is_pb:
                    action = "SET  pb flag"
                    total_runs_flagged += 1
                    if not DRY_RUN:
                        (Runs.update(flags=run.flags | RUN_FLAG_PB)
                             .where(Runs.id == run.id)
                             .execute())
                elif should_be_pb:
                    action = "ok   pb flag already set"
                elif is_pb:
                    action = "ok   pb flag kept (existing)"
                else:
                    action = "ok   no flag (not a pb)"

                print(f"  run #{run.id:<4} {run.time:.0f}s  {action}")

            if fastest_time < current_pb:
                print(
                    f"  => UPDATE Players.pb"
                    f"  {current_pb:.0f} -> {fastest_time:.0f}"
                )
                total_pbs_updated += 1
                if not DRY_RUN:
                    (Players.update(pb=fastest_time)
                            .where(Players.id == player.id)
                            .execute())
            else:
                print(f"  => Players.pb unchanged ({current_pb:.0f})")

            print()

    print("Done.")
    print(f"  Run PB flags set:   {total_runs_flagged}")
    print(f"  Player PBs updated: {total_pbs_updated}")


if __name__ == "__main__":
    fix_pbs()
