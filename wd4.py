from flask import Flask, render_template, request, send_from_directory
from datetime import timedelta, date
import numpy as np
from cachetools import TTLCache

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
    

class Pools():
    def __init__(self, id, players):
        self.id = id
        self.players = players

    @classmethod
    def get_pools(cls):
        pools = []

        players = Players.select().order_by(Players.pb.asc())

        for i in range(players.count() // POOL_SIZE):
            pools.append(Pools(i, []))
        
        for i,player in enumerate(players):
            pools[serpentine_pool(i, len(pools))].players.append(player)
        
        return pools

    def rank(self, player):
        return None

    def time(self, player):
        return None

class Players(BaseModel):
    id = CharField(32)
    pb = FloatField()
    twitch = CharField(32)
    flags = IntegerField()

    def runs(self, finished=False):
        if finished:
            return Runs.select().where((Runs.flags.bin_and(RUN_FLAG_DNF)) == 0, Runs.player == self.id)
        else:
            return Runs.select().where(Runs.player == self.id)
    
    def stats(self):
        key = ("stats", self.id)

        if key in cache: return cache[key]

        runs = list(self.runs(finished=True))
        stats = {
            "mean": sum([run.time for run in runs])/len(runs) if len(runs) else None,
            "std": np.std([run.time for run in runs]) if (len(runs) > 1) else None,
            "completion": len(runs)/self.runs().count() if self.runs().count() else None
        }

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
    
    def all_match_win_prob(self):
        key = ("amwp", self.id)

        if key in cache: return cache[key]
        
        p = 1

        s = self.stats()

        for other in Players.select().where(Players.id != self.id):
            o = other.stats()
            pm = p_a_beats_b((s["mean"] if s["mean"] else None, s["std"]), (o["mean"] if o["mean"] else None, o["std"]))

            if pm is None: return None

            p *= pm
        
        cache[key] = p
        return p
    
    def tourney_win_prob(self):
        key = ("twp", self.id)

        if key in cache: return cache[key]

        amwp = self.all_match_win_prob()

        if amwp is None:
            return None

        p = amwp / sum([other.all_match_win_prob() for other in Players.select()])

        cache[key] = p
        return p

    @classmethod
    def stats_leaderboard(cls, sort):
        keys = {
            "player": lambda p: p[1].id.lower(),
            "avg": lambda p: (p[0]["mean"] or float('infinity'), p[1].pb or float('infinity')),
            "rank": lambda p: (p[0]["mean"] or float('infinity'), p[1].pb or float('infinity')),
            "odds": lambda p: (-(p[2] or float('-infinity')), p[1].pb or float('infinity')),
            "completion": lambda p: (-(p[0]["completion"] if p[0]["completion"] is not None else float('-infinity')), p[1].pb or float('infinity')),
            "pb": lambda p: p[1].pb or float('infinity'),
            "std": lambda p: (p[0]["std"] or float('infinity'), p[1].pb or float('infinity')),
        }

        return sorted([
            (player.stats(),player,player.tourney_win_prob()) for player in Players.select()
        ], key=keys[sort])

class Runs(BaseModel):
    player = CharField(32)
    time = FloatField()
    id = IntegerField()
    date = DateField()
    flags = IntegerField()
    phase = IntegerField()
    event = IntegerField()

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

app = Flask(__name__)

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

@app.route("/stats")
def page_stats():
    sort = request.args.get("sort", default="avg")

    leaderboard = Players.stats_leaderboard(sort)

    return render_template("stats.html", **globals(), leaderboard=leaderboard, sort=sort)

@app.route('/static/<path:path>')
def page_static(path):
    return send_from_directory('static', path)

if __name__ == "__main__":
    app.run(debug=True, port=7140)
