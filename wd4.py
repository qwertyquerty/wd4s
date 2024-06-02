from flask import Flask, render_template, jsonify, send_from_directory
from datetime import timedelta, date
import numpy as np
from peewee import *

RUN_FLAG_DNF = 1 << 0
RUN_FLAG_PB  = 1 << 1

PHASE_SEEDING = 0
PHASE_POOLING = 1
PHASE_BRACKET = 2

POOL_SIZE = 4

db = SqliteDatabase("data.sqlite3")
db.connect()

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
            p = Players()
            p.id = "TBD"
            pools[i % len(pools)].players.append(p)
        
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
        runs = list(self.runs(finished=True))
        return {
            "mean": sum([run.time for run in runs])/len(runs) if len(runs) else None,
            "std": np.std([run.time for run in runs]) if len(runs) else None,
            "completion": len(runs)/self.runs().count() if self.runs().count() else None
        }
    
    @classmethod
    def stats_leaderboard(cls):
        return sorted([(player.stats(),player) for player in Players.select()], key=lambda p: p[0]["mean"] or float('infinity'))

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
    return render_template("runs.html", **globals())

@app.route("/stats")
def page_stats():
    return render_template("stats.html", **globals())

@app.route('/static/<path:path>')
def page_static(path):
    return send_from_directory('static', path)

if __name__ == "__main__":
    app.run(debug=True, port=7140)
