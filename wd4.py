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
    

class Pools(BaseModel):
    id = IntegerField()
    players = CharField()

    def players_list(self):
        return [Players.get_by_id(player) for player in self.players.split(",")]

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
            "mean": int(sum([run.time for run in runs])/len(runs)) if len(runs) else None,
            "std": int(np.std([run.time for run in runs])) if (len(runs) > 1) else None,
            "completion": len(runs)/self.runs().count() if self.runs().count() else None,
            "mean_zelda": sum([run.zelda() for run in runs if run.zelda()]) / len([run.zelda() for run in runs if run.zelda()]) if len([run.zelda() for run in runs if run.zelda()]) else None
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
    
    def all_match_win_prob(self):
        if self.eliminated:
            return 0
        
        key = ("amwp", self.id)

        if key in cache: return cache[key]
        
        p = 1

        s = self.stats()

        for other in Players.select().where(Players.id != self.id, Players.eliminated != 1):
            o = other.stats()
            pm = p_a_beats_b((s["mean"] if s["mean"] else 100000, s["std"] or 60), (o["mean"] if o["mean"] else 100000, o["std"] or 60))

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
            "odds": lambda p: (-(p[2] or float('-infinity')), not p[1].eliminated or float('infinity')),
            "completion": lambda p: (-(p[0]["completion"] if p[0]["completion"] is not None else float('-infinity')), p[1].pb or float('infinity')),
            "pb": lambda p: p[1].pb or float('infinity'),
            "std": lambda p: (p[0]["std"] or float('infinity'), p[1].pb or float('infinity')),
            "pbdiff": lambda p: (p[0]["pbdiff"] if p[0]["pbdiff"] is not None else float('infinity'), p[1].pb or float('infinity')),
            "zelda": lambda p: (p[0]["mean_zelda"] if p[0]["mean_zelda"] is not None else float('infinity'))
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
    zelda_swoops = IntegerField()
    zelda_triangles = IntegerField()

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
        return self.zelda_triangles + self.zelda_swoops + 3 if (self.zelda_triangles is not None and self.zelda_swoops is not None) else None

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

@app.route("/zelda")
def page_zelda():
    runs = Runs.select().where(Runs.zelda_triangles != None).order_by((Runs.zelda_triangles+Runs.zelda_swoops).desc(), Runs.zelda_triangles.desc(), Runs.time.asc())
    return render_template("zelda.html", **globals(), runs=runs)

@app.route("/players")
def page_players():
    sort = request.args.get("sort", default="avg")

    leaderboard = Players.stats_leaderboard(sort)

    return render_template("players.html", **globals(), leaderboard=leaderboard, sort=sort)

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
    app.run("localhost", debug=True, port=7140)
