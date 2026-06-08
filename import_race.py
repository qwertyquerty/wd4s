#!/usr/bin/env python3
"""
Import a racetime.gg race into the runs table.

Usage:
    python import_race.py <race_url> <event_id> <phase>

Example:
    python import_race.py https://racetime.gg/tp/quick-mewtwo-2574 2 1

Phase values: 0=seeding, 1=pooling, 2=bracket
"""

import sys
import json
import re
import sqlite3
from urllib.request import urlopen

RUN_FLAG_DNF = 1 << 0


def parse_duration(s):
    """Parse ISO 8601 duration to total seconds. Handles P0DT... and PT... forms."""
    if not s:
        return None
    m = re.search(r'T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?', s)
    if not m:
        return None
    return (int(m.group(1) or 0) * 3600
            + int(m.group(2) or 0) * 60
            + float(m.group(3) or 0))


def strip_discrim(name):
    """Remove #XXXX discriminator from a racetime.gg username."""
    return re.sub(r'#\d+$', '', name)


def build_api_url(url):
    url = url.rstrip('/')
    if not url.startswith('http'):
        url = 'https://racetime.gg/' + url.lstrip('/')
    if not url.endswith('/data'):
        url += '/data'
    return url


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)

    api_url = build_api_url(sys.argv[1])
    event_id = int(sys.argv[2])
    phase = int(sys.argv[3])

    print(f"Fetching {api_url} ...")
    from urllib.request import Request
    req = Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(req) as resp:
        data = json.load(resp)

    race_date = data['started_at'][:10]
    print(f"Race date: {race_date}\n")

    conn = sqlite3.connect('data.sqlite3')
    cur = conn.cursor()

    players = {
        row[0].lower(): row[0]
        for row in cur.execute('SELECT id FROM players').fetchall()
    }

    # Sort finishers first (by time), then DNFs
    entrants = sorted(
        data['entrants'],
        key=lambda e: (e['status']['value'] != 'finished',
                       parse_duration(e.get('finish_time')) or 99999)
    )

    next_id = cur.execute('SELECT MAX(id)+1 FROM runs').fetchone()[0] or 0
    inserted = 0
    skipped = []

    for entrant in entrants:
        rt_name = strip_discrim(entrant['user']['name'])
        status = entrant['status']['value']
        finish_time = int(parse_duration(entrant.get('finish_time')) or 99999)

        player_id = players.get(rt_name.lower())
        if not player_id:
            skipped.append(rt_name)
            continue

        if status == 'done' and finish_time is not None:
            flags = 0
            time = finish_time
            h = int(time // 3600)
            m = int(time % 3600 // 60)
            s = int(time % 60)
            label = f"{h}:{m:02d}:{s:02d}"
        else:
            flags = RUN_FLAG_DNF
            time = 99999
            label = "DNF"

        run_id = next_id + inserted
        cur.execute(
            'INSERT INTO runs (id,player,time,date,flags,phase,event) '
            'VALUES (?,?,?,?,?,?,?)',
            (run_id, player_id, time, race_date, flags, phase, event_id)
        )
        print(f"  #{run_id:<4} {player_id:<22} {label}  flags={flags}")
        inserted += 1

    conn.commit()
    conn.close()

    print(f"\nInserted {inserted} runs "
          f"(event={event_id}, phase={phase}, date={race_date})")
    if skipped:
        print(f"Skipped (no DB match): {', '.join(skipped)}")


if __name__ == '__main__':
    main()
