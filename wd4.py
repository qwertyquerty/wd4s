from flask import Flask, render_template, request, send_from_directory
from datetime import timedelta, date, datetime
import numpy as np
from cachetools import TTLCache
import time

cache = TTLCache(maxsize=65536, ttl=50)

from peewee import *

from stats import *

RUN_FLAG_DNF = 1 << 0
RUN_FLAG_PB  = 1 << 1

PHASE_SEEDING = 0
PHASE_POOLING = 1
PHASE_BRACKET = 2

POOL_SIZE = 4

db = SqliteDatabase("data.sqlite3")
db.connect()


def serpentine_pool(seed, num_pools):
    round_number = seed // num_pools
    index_in_round = seed % num_pools
    
    if round_number % 2 == 0:
        return index_in_round
    else:
        return num_pools - 1 - index_in_round

class BaseModel(Model):
    class Meta:
        database = db

def format_time(time):
    return str(timedelta(seconds=time))

def format_goats_time(t):
    return f"{t:.2f}"

def get_pb_race_players():
    key = "pb_race_players"
    if key in cache: return cache[key]
    result = set(
        run.player for run in
        Runs.select(Runs.player).where(
            Runs.flags.bin_and(RUN_FLAG_PB) != 0,
            Runs.phase != PHASE_SEEDING
        )
    )
    cache[key] = result
    return result

def get_top_run_players():
    key = "top_run_players"
    if key in cache: return cache[key]
    runs = (Runs.select()
            .where((Runs.flags.bin_and(RUN_FLAG_DNF)) == 0)
            .order_by(Runs.time.asc()))
    seen = []
    for run in runs:
        if run.player not in seen:
            seen.append(run.player)
        if len(seen) == 3:
            break
    while len(seen) < 3:
        seen.append(None)
    cache[key] = seen
    return seen

def get_fastest_player():
    return get_top_run_players()[0]

def get_second_fastest_player():
    return get_top_run_players()[1]

def get_third_fastest_player():
    return get_top_run_players()[2]

def get_gorge_player():
    key = "gorge_player"
    if key in cache: return cache[key]
    runs = list(Runs.select().where(Runs.gorge_void.in_([0, 1])))
    if not runs:
        cache[key] = None
        return None
    from collections import defaultdict
    stats = defaultdict(lambda: {'success': 0, 'total': 0})
    for run in runs:
        stats[run.player]['total'] += 1
        if run.gorge_void == 1:
            stats[run.player]['success'] += 1

    def sort_key(player):
        s = stats[player]
        rate = s['success'] / s['total']
        pb = (Players.get_or_none(Players.id == player) or type('', (), {'pb': float('inf')})()).pb
        return (-rate, -s['total'], pb)

    result = sorted(stats.keys(), key=sort_key)[0]
    cache[key] = result
    return result

def get_pool_completed_players():
    key = "pool_completed_players"
    if key in cache: return cache[key]
    runs = Runs.select(Runs.player, Runs.flags).where(Runs.phase == PHASE_POOLING)
    result = {run.player for run in runs if not run.dnf()}
    cache[key] = result
    return result

def get_goats_player():
    key = "goats_player"
    if key in cache: return cache[key]
    r = Runs.select(Runs.player).where(Runs.goats_time.is_null(False)).order_by(Runs.goats_time.asc()).first()
    result = r.player if r else None
    cache[key] = result
    return result

def get_zelda_player():
    key = "zelda_player"
    if key in cache: return cache[key]
    r = Runs.select(Runs.player).where(Runs.zelda_cycles.is_null(False)).order_by(Runs.zelda_cycles.desc()).first()
    result = r.player if r else None
    cache[key] = result
    return result
    

class Pools(BaseModel):
    id = IntegerField()
    players = CharField()
    name = CharField()

    def players_list(self):
        return [Players.get_or_none(Players.id == player) for player in self.players.split(",")]

    def run_from_rank(self, rank):
        lb = list(Runs.select().where(Runs.event == self.event_id(), Runs.phase == PHASE_POOLING).order_by(Runs.time.asc()))
        return lb[rank-1] if len(lb) else None
    
    def event_id(self):
        return self.id

    def leaderboard(self):
        return Runs.select().where(Runs.event == self.event_id(), Runs.phase == PHASE_POOLING).order_by(Runs.time.asc())

class Players(BaseModel):
    id = CharField(32)
    pb = FloatField()
    twitch = CharField(32)
    flags = IntegerField()
    eliminated = IntegerField()
    speedruncom = CharField(null=True)

    def runs(self, finished=False):
        if finished:
            return Runs.select().where((Runs.flags.bin_and(RUN_FLAG_DNF)) == 0, Runs.player == self.id)
        else:
            return Runs.select().where(Runs.player == self.id)
    
    def stats(self):
        key = ("stats", self.id)

        if key in cache: return cache[key]

        runs = list(self.runs(finished=True))
        all_runs = list(self.runs(finished=False))
        zelda_runs = [run.zelda() for run in all_runs if run.zelda()]
        goats_runs = [run.goats_time for run in all_runs if run.goats_time is not None]
        gorge_runs = [run.gorge_void for run in all_runs if run.gorge_void is not None]
        stats = {
            "mean": int(sum([run.time for run in runs])/len(runs)) if len(runs) else None,
            "std": int(np.std([run.time for run in runs], ddof=1)) if (len(runs) > 1) else None,
            "completion": len(runs)/self.runs().count() if self.runs().count() else None,
            "mean_zelda": sum(zelda_runs) / len(zelda_runs) if zelda_runs else None,
            "mean_goats": sum(goats_runs) / len(goats_runs) if goats_runs else None,
            "gorge_void_rate": gorge_runs.count(1) / len(gorge_runs) if gorge_runs else None,
        }

        stats["pbdiff"] = (stats["mean"] - self.pb) if stats["mean"] else None

        cache[key] = stats
        return stats

    def match_win_prob(self, other):
        key = ("mwp", self.id, other.id)

        if key in cache: return cache[key]
        
        s = self.stats()
        o = other.stats()

        p = p_a_beats_b((s["mean"] if s["mean"] else None, s["std"]), (o["mean"] if o["mean"] else None, o["std"]))

        cache[key] = p
        return p
    
    @classmethod
    def _get_pool_expected_ranking(cls, pool_id):
        pool = Pools.get_or_none(Pools.id == pool_id)

        if pool is None:
            # LC pools have no DB record; derive members from source pool #3 finishers
            lc_sources = {9: [1, 3, 5, 7], 10: [2, 4, 6, 8]}
            if pool_id not in lc_sources:
                return []
            pool_players = [
                cls._get_pool_expected_ranking(src)[2]
                for src in lc_sources[pool_id]
                if len(cls._get_pool_expected_ranking(src)) >= 3
            ]
        else:
            pool_players = [p for p in pool.players_list() if p]

        pool_players = [p for p in pool_players if not p.eliminated]

        if not pool_players:
            return []

        completed = {run.player: run.time
                     for run in Runs.select().where(
                         Runs.event == pool_id,
                         Runs.phase == PHASE_POOLING,
                         (Runs.flags.bin_and(RUN_FLAG_DNF)) == 0)}
        dnfs = {run.player
                for run in Runs.select().where(
                    Runs.event == pool_id,
                    Runs.phase == PHASE_POOLING,
                    Runs.flags.bin_and(RUN_FLAG_DNF) != 0)}

        def sort_key(p):
            if p.id in completed:
                return (0, completed[p.id])
            if p.id in dnfs:
                return (2, 0.0)
            s = p.stats()
            return (1, s["mean"] or (p.pb * 1.05 if p.pb else float('inf')))

        return sorted(pool_players, key=sort_key)

    @classmethod
    def _main_bracket_seeding(cls):
        """Returns main bracket players in seed order.
        Complete pools contribute their top 2; incomplete pools contribute all members."""
        key = "main_bracket_seeding"
        if key in cache:
            return cache[key]

        rankings = {i: cls._get_pool_expected_ranking(i) for i in range(1, 11)}

        def is_complete(pool_id):
            members = rankings[pool_id]
            if not members:
                return True
            ran = Runs.select().where(
                Runs.event == pool_id, Runs.phase == PHASE_POOLING
            ).count()
            return ran >= len(members)

        complete = {i: is_complete(i) for i in range(1, 11)}

        seeded = []
        added = set()

        def add(p):
            if p is not None and p.id not in added:
                seeded.append(p)
                added.add(p.id)

        for i in range(1, 9):   # Pool 1-8 #1
            r = rankings[i]
            add(r[0] if r else None)
        for i in range(1, 9):   # Pool 1-8 #2
            r = rankings[i]
            add(r[1] if len(r) > 1 else None)
        # LC-A #1, LC-B #1, LC-A #2, LC-B #2
        for pool_id in [9, 10]:
            r = rankings[pool_id]
            add(r[0] if r else None)
        for pool_id in [9, 10]:
            r = rankings[pool_id]
            add(r[1] if len(r) > 1 else None)

        # For incomplete pools, append remaining members sorted by expected time
        extra = []
        for i in range(1, 11):
            if not complete[i]:
                for p in rankings[i]:
                    if p and p.id not in added:
                        extra.append(p)
        extra.sort(key=lambda p: (p.stats()["mean"] or (p.pb * 1.05 if p.pb else float('inf'))))
        for p in extra:
            add(p)

        cache[key] = seeded
        return seeded

    @classmethod
    def _tourney_win_probs_seeded(cls):
        key = "tourney_win_probs_seeded"
        if key in cache:
            return cache[key]

        seeded = [p for p in cls._main_bracket_seeding() if p is not None]
        n = len(seeded)

        if n == 0:
            cache[key] = {}
            return {}
        if n == 1:
            result = {seeded[0].id: 1.0}
            cache[key] = result
            return result

        stats_map = {p.id: p.stats() for p in seeded}
        ids = [p.id for p in seeded]

        def eff_mean(p):
            s = stats_map[p.id]
            return s["mean"] or (p.pb * 1.05 if p.pb else float('inf'))

        def eff_std(p):
            return max(stats_map[p.id]["std"] or 240, 120)

        wp = np.zeros((n, n))
        for i in range(n):
            ma, sa_std = eff_mean(seeded[i]), eff_std(seeded[i])
            for j in range(n):
                if i != j:
                    wp[i, j] = p_a_beats_b((ma, sa_std), (eff_mean(seeded[j]), eff_std(seeded[j]))) or 0.5

        size = 1 << max(n - 1, 1).bit_length()

        def make_slots(sz):
            if sz == 1:
                return [1]
            half = make_slots(sz // 2)
            return [x for s in half for x in (s, sz + 1 - s)]

        current = [({seed - 1: 1.0} if seed <= n else None) for seed in make_slots(size)]

        while len(current) > 1:
            next_round = []
            for i in range(0, len(current), 2):
                a, b = current[i], current[i + 1] if i + 1 < len(current) else None
                if a is None:
                    next_round.append(b)
                elif b is None:
                    next_round.append(a)
                else:
                    match = {}
                    for ai, pa in a.items():
                        for bj, pb in b.items():
                            p = wp[ai, bj]
                            match[ai] = match.get(ai, 0.0) + pa * pb * p
                            match[bj] = match.get(bj, 0.0) + pa * pb * (1.0 - p)
                    next_round.append(match)
            current = next_round

        result = {ids[i]: prob for i, prob in (current[0] or {}).items()}
        cache[key] = result
        return result

    def tourney_win_prob(self):
        if self.eliminated:
            return None
        return Players._tourney_win_probs_seeded().get(self.id, None)

    @classmethod
    def stats_leaderboard(cls, sort):
        keys = {
            "player": lambda p: p[1].id.lower(),
            "avg": lambda p: (p[0]["mean"] or float('infinity'), p[1].pb or float('infinity')),
            "rank": lambda p: (p[0]["mean"] or float('infinity'), p[1].pb or float('infinity')),
            "odds": lambda p: (1 if p[2] is None else 0, -(p[2] or 0)),
            "completion": lambda p: (-(p[0]["completion"] if p[0]["completion"] is not None else float('-infinity')), p[1].pb or float('infinity')),
            "pb": lambda p: p[1].pb or float('infinity'),
            "std": lambda p: (p[0]["std"] or float('infinity'), p[1].pb or float('infinity')),
            "pbdiff": lambda p: (p[0]["pbdiff"] if p[0]["pbdiff"] is not None else float('infinity'), p[1].pb or float('infinity')),
            "zelda": lambda p: (p[0]["mean_zelda"] if p[0]["mean_zelda"] is not None else float('infinity')),
            "goats": lambda p: (p[0]["mean_goats"] if p[0]["mean_goats"] is not None else float('infinity')),
            "gorge": lambda p: (-(p[0]["gorge_void_rate"] if p[0]["gorge_void_rate"] is not None else float('-infinity')))
        }

        return sorted([
            (player.stats(),player,player.tourney_win_prob()) for player in Players.select()
        ], key=keys[sort])


class RunnerProfiles(BaseModel):
    player = CharField(32, primary_key=True)
    versions = CharField(null=True)
    twitch = CharField(null=True)
    sr_tenure = TextField(null=True)
    fav_dungeon_sr = CharField(null=True)
    fav_dungeon_casual = CharField(null=True)
    fav_zelda = CharField(null=True)
    other_games = TextField(null=True)
    fav_ice_cream = TextField(null=True)
    former_wr_holder = IntegerField(default=0)
    wr_holder = IntegerField(default=0)
    organizer = IntegerField(default=0)
    former_wd_top3 = IntegerField(default=0)
    former_rb_winner = IntegerField(default=0)

    class Meta:
        table_name = 'runner_profiles'


class Runs(BaseModel):
    player = CharField(32)
    time = FloatField()
    id = IntegerField()
    date = DateField()
    flags = IntegerField()
    phase = IntegerField()
    event = IntegerField()
    zelda_cycles = IntegerField(null=True)
    gorge_void = IntegerField(null=True)
    goats_time = FloatField(null=True)

    @classmethod
    def get_seeding_runs(cls):
        return cls.select().where(
            cls.phase == PHASE_SEEDING
        ).order_by(
            cls.time.asc()
        )

    def format_time(self):
        return format_time(self.time) if not self.dnf() else "DNF"
    
    def format_phase(self):
        return ["Seeding", "Pooling", "Bracket"][self.phase]

    def dnf(self):
        return self.flags & RUN_FLAG_DNF

    def pb(self):
        return self.flags & RUN_FLAG_PB

    def zelda(self):
        return self.zelda_cycles

    @classmethod
    def completion_stats(cls):
        runs = list(Runs.select())
        return {
            "completed": len([run for run in runs if not run.dnf()]),
            "dnf": len([run for run in runs if run.dnf()]),
            "pb": len([run for run in runs if run.pb()])
        }

class Races(BaseModel):
    id = TextField()
    players = TextField()
    timestamp = IntegerField()
    vod = TextField()

    def get_players(self):
        if self.players != None:
            return [Players.get_by_id(player) for player in self.players.split(",")]
        elif self.id == "seeding":
            return [Players.get_by_id(run.player) for run in Runs.select().where(Runs.phase == PHASE_SEEDING)]
        elif self.id.split(" ")[0] == "pool":
            return Pools.get_by_id(int(self.id.split(" ")[1])).players_list()
        
        return []        

    def get_timestamp(self):
        return datetime.fromtimestamp(self.timestamp)

app = Flask(__name__)

class ScriptNameMiddleware:
    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        script_name = environ.get('HTTP_X_SCRIPT_NAME', '')
        if script_name:
            environ['SCRIPT_NAME'] = script_name
        return self.app(environ, start_response)

app.wsgi_app = ScriptNameMiddleware(app.wsgi_app)

app.jinja_env.globals.update(
    Players=Players,
    RunnerProfiles=RunnerProfiles,
    Runs=Runs,
    Pools=Pools,
    Races=Races,
    format_time=format_time,
    format_goats_time=format_goats_time,
    get_goats_player=get_goats_player,
    get_zelda_player=get_zelda_player,
    get_gorge_player=get_gorge_player,
    get_pb_race_players=get_pb_race_players,
    get_fastest_player=get_fastest_player,
    get_second_fastest_player=get_second_fastest_player,
    get_third_fastest_player=get_third_fastest_player,
)

@app.route("/")
def page_index():
    return render_template("index.html", **globals())

@app.route("/runs")
def page_runs():
    sort = request.args.get("sort", default="id")

    runs = Runs.select()

    if sort in Runs._meta.sorted_field_names:
        runs = runs.order_by(
            getattr(Runs, sort).asc()
        )

    return render_template("runs.html", **globals(), runs=runs, sort=sort)

@app.route("/players")
def page_players():
    sort = request.args.get("sort", default="avg")
    leaderboard = Players.stats_leaderboard(sort)
    return render_template("players.html", **globals(), leaderboard=leaderboard, sort=sort)

@app.route("/runners")
def page_runners():
    profiles = (RunnerProfiles
                .select(RunnerProfiles, Players)
                .join(Players, on=(RunnerProfiles.player == Players.id))
                .order_by(Players.pb.asc()))

    return render_template("runners.html", **globals(), profiles=profiles,
                           goats_player=get_goats_player(),
                           zelda_player=get_zelda_player(),
                           gorge_player=get_gorge_player(),
                           pool_completed_players=get_pool_completed_players())

@app.route("/stats")
def page_stats():
    return render_template("stats.html", **globals())

@app.route("/schedule")
def page_schedule():
    return render_template("schedule.html", **globals())

@app.route('/static/<path:path>')
def page_static(path):
    return send_from_directory('static', path)

if __name__ == "__main__":
    app.run("localhost", debug=True, port=7141)
