from flask import Flask, render_template, jsonify, send_from_directory
from datetime import timedelta, date

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
            pools[i % len(pools)].players.append(player)
        
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
        return str(timedelta(seconds=self.time))

    def dnf(self):
        return self.flags & RUN_FLAG_DNF

app = Flask(__name__)

@app.route("/")
def page_index():
    return render_template("index.html", **globals())

@app.route('/static/<path:path>')
def page_static(path):
    return send_from_directory('static', path)

if __name__ == "__main__":
    app.run(debug=True, port=7140)
